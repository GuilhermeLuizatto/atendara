import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { z } from "zod";

import { fromStored, toStored } from "./firestore-dates.js";
import {
  completeDispatch,
  decideDispatch,
  dispatchPayloadFor,
  isTerminalStatus,
  planAppointmentChange,
  queueEnqueueAt,
  queueTaskName,
  transitionTask,
} from "./generated/automation.js";
import {
  AUTOMATION_CONTRACT_VERSION,
  DISPATCHER_QUEUE_RETRY,
  DISPATCHER_TIMEOUT_SECONDS,
  PLANNING_EVENT_MAX_AGE_MINUTES,
} from "./generated/automation-config.js";
import { providerFor } from "./generated/notifications-providers.js";
import { withOrganizationDefaults } from "./generated/organization-config.js";
import { paths } from "./generated/paths.js";
import { getProfession, isProfessionId } from "./generated/professions.js";

/**
 * Fila de automacao no backend (Fase 3, 13.2). Fecha o S-05.
 *
 * Tres garantias que este arquivo existe para sustentar:
 *
 * 1. **O navegador nao planeja nem dispara.** O gatilho `planAppointmentNotices`
 *    le cada escrita de atendimento, a Cloud Tasks agenda o horario exato e o
 *    despachante `dispatchAutomationTask` executa. As Security Rules recusam
 *    escrita do cliente em `notificationDeliveries` e `automationTasks`.
 * 2. **As travas sao conferidas de novo imediatamente antes do envio**, na mesma
 *    transacao que adquire a tarefa e contra o estado atual: consentimento
 *    retirado, canal desligado, atendimento cancelado ou remarcado impedem o
 *    envio que ja estava planejado.
 * 3. **Reentrega nao duplica.** Id da tarefa derivado do aviso, nome na Cloud
 *    Tasks derivado da tentativa, estado adquirido em transacao e estado
 *    terminal que nao volta.
 *
 * Toda decisao mora em `src/lib/automation`, em funcoes puras testadas sem
 * emulador; aqui fica ler, gravar e pedir a fila. Trilha e alerta
 * (`WRITE_AUDIT`, `RAISE_ALERT`) sao gravados na mesma transacao da mudanca de
 * estado e nunca saem do Atendara. O provedor continua o simulado.
 *
 * Nenhum log leva contato, texto ou nome: so ids, tipo e resultado.
 */

const REGION = "southamerica-east1";
export const DISPATCHER_NAME = "dispatchAutomationTask";

// `getFirestore()` preguicoso: os modulos sao avaliados antes de
// `initializeApp()` do index.js.
const db = () => getFirestore();

const payloadSchema = z
  .object({
    version: z.literal(AUTOMATION_CONTRACT_VERSION),
    organizationId: z.string().min(1).max(128),
    taskId: z.string().min(1).max(700),
    attempt: z.number().int().min(1).max(10),
  })
  .strict();

// ---------------------------------------------------------------- leitura

function stored(collection, snapshot) {
  return snapshot?.exists ? fromStored(collection, snapshot.id, snapshot.data()) : null;
}

/**
 * A organizacao completa pelos mesmos padroes da tela. `null` quando nao ha o
 * que planejar: documento ausente, exclusao em andamento ou profissao
 * desconhecida — sem profissao nao ha politica de aviso para conferir.
 */
function organizationFrom(snapshot, now) {
  const raw = stored("organizations", snapshot);
  if (!raw || raw.deletion || !isProfessionId(raw.primaryProfession)) return null;
  return withOrganizationDefaults(raw, snapshot.id, raw.primaryProfession, now);
}

function tenant(firestore, organizationId) {
  return {
    doc: (collection, id) => firestore.doc(paths.document(organizationId, collection, id)),
    ofAppointment: (collection, appointmentId) =>
      firestore.collection(paths.collection(organizationId, collection)).where("appointmentId", "==", appointmentId),
  };
}

/** Tarefas internas e o que elas gravam, na transacao de quem as originou. */
function writeEffects(transaction, scope, effects) {
  for (const effect of effects) {
    transaction.create(scope.doc("automationTasks", effect.task.id), toStored("automationTasks", effect.task));
    if (effect.kind === "WRITE_AUDIT") {
      transaction.create(scope.doc("auditLogs", effect.audit.id), toStored("auditLogs", effect.audit));
    } else {
      transaction.create(scope.doc("notifications", effect.alert.id), toStored("notifications", effect.alert));
    }
  }
}

// ------------------------------------------------------------------- fila

async function enqueueDispatch(payload, { at, name }) {
  const queue = getFunctions().taskQueue(`locations/${REGION}/functions/${DISPATCHER_NAME}`);
  try {
    await queue.enqueue(payload, {
      id: name,
      scheduleTime: new Date(at),
      dispatchDeadlineSeconds: DISPATCHER_TIMEOUT_SECONDS + 30,
    });
  } catch (error) {
    // Nome repetido: esta tentativa ja esta na fila. E o caso da reentrega.
    if (error?.code === "functions/task-already-exists") return;
    throw error;
  }
}

async function scheduleTask(task, { enqueue, clock }) {
  const now = clock();
  const at = queueEnqueueAt(task, now);
  await enqueue(dispatchPayloadFor(task), { at, name: queueTaskName(task, at) });

  const firestore = db();
  const ref = tenant(firestore, task.organizationId).doc("automationTasks", task.id);
  await firestore.runTransaction(async (transaction) => {
    const current = stored("automationTasks", await transaction.get(ref));
    // So a tentativa que acabou de ir para a fila muda de estado. Se o
    // despachante ja a pegou, o estado dele prevalece.
    if (!current || current.status !== "PLANNED" || current.attempt !== task.attempt) return;
    transaction.set(ref, toStored("automationTasks", transitionTask(current, "SCHEDULED", { at: now })));
  });
}

// ------------------------------------------------------------ planejamento

/**
 * Planeja, cancela e replaneja os avisos de um atendimento a partir de uma
 * escrita. Uma transacao le organizacao, atendimento atual, cadastro, fila e
 * entregas; grava tarefas, entregas, trilha e alertas juntos. Depois pede a
 * Cloud Tasks para toda tarefa ainda sem fila — inclusive a de uma entrega
 * anterior que falhou nesse passo.
 */
export async function planAppointmentAutomation(change, deps = {}) {
  const { enqueue = enqueueDispatch, clock = () => new Date().toISOString() } = deps;
  const { organizationId, appointmentId, before, after, changedAt } = change;
  const firestore = db();
  const scope = tenant(firestore, organizationId);

  const waiting = await firestore.runTransaction(async (transaction) => {
    const organizationSnapshot = await transaction.get(firestore.doc(paths.organization(organizationId)));
    const current = stored("appointments", await transaction.get(scope.doc("appointments", appointmentId)));
    const tasks = (await transaction.get(scope.ofAppointment("automationTasks", appointmentId))).docs.map((document) =>
      stored("automationTasks", document),
    );
    const deliveries = (await transaction.get(scope.ofAppointment("notificationDeliveries", appointmentId))).docs.map(
      (document) => stored("notificationDeliveries", document),
    );
    const client = current ? stored("clients", await transaction.get(scope.doc("clients", current.clientId))) : null;
    const professional = current
      ? stored("professionals", await transaction.get(scope.doc("professionals", current.professionalId)))
      : null;

    const organization = organizationFrom(organizationSnapshot, changedAt);
    const plan = planAppointmentChange({
      organization,
      profession: organization ? getProfession(organization.primaryProfession) : null,
      before,
      after,
      current,
      client,
      professionalName: professional?.displayName ?? current?.professionalName ?? null,
      tasks,
      deliveries,
      changedAt,
    });

    for (const { task, delivery } of plan.created) {
      transaction.create(scope.doc("automationTasks", task.id), toStored("automationTasks", task));
      transaction.set(scope.doc("notificationDeliveries", delivery.id), toStored("notificationDeliveries", delivery));
    }
    for (const { task, delivery } of plan.stopped) {
      transaction.set(scope.doc("automationTasks", task.id), toStored("automationTasks", task));
      if (delivery) {
        transaction.set(scope.doc("notificationDeliveries", delivery.id), toStored("notificationDeliveries", delivery));
      }
    }
    writeEffects(transaction, scope, plan.effects);

    const stopped = new Set(plan.stopped.map(({ task }) => task.id));
    return [
      ...plan.created.map(({ task }) => task),
      ...tasks.filter((task) => task.status === "PLANNED" && task.deliveryId !== null && !stopped.has(task.id)),
    ];
  });

  for (const task of waiting) await scheduleTask(task, { enqueue, clock });
  return { queued: waiting.map((task) => task.id) };
}

export const planAppointmentNotices = onDocumentWritten(
  {
    document: paths.document("{organizationId}", "appointments", "{appointmentId}"),
    region: REGION,
    maxInstances: 5,
    // Repetir e inofensivo — id do aviso e nome na fila sao deterministicos — e
    // cobre falha passageira da transacao ou da Cloud Tasks.
    retry: true,
  },
  async (event) => {
    if (Date.now() - Date.parse(event.time) > PLANNING_EVENT_MAX_AGE_MINUTES * 60_000) {
      logger.warn("automation.plan.stale_event", { eventId: event.id });
      return;
    }
    const { organizationId, appointmentId } = event.params;
    // Horario da escrita no servidor: o mesmo em toda reentrega do evento, e
    // sem depender de campo que o navegador envia.
    const changedAt = event.data?.after?.exists
      ? event.data.after.updateTime.toDate().toISOString()
      : new Date(event.time).toISOString();
    const result = await planAppointmentAutomation({
      organizationId,
      appointmentId,
      before: stored("appointments", event.data?.before),
      after: stored("appointments", event.data?.after),
      changedAt,
    });
    logger.info("automation.plan", { organizationId, appointmentId, queued: result.queued.length });
  },
);

// ------------------------------------------------------------ despachante

async function send(step, scope, { enqueue, clock, providers }) {
  let result;
  try {
    result = await providers(step.request.channel).send(step.request);
  } catch {
    // Excecao do provedor e falha temporaria: a politica de tentativas decide.
    result = { outcome: "TEMPORARY_FAILURE", providerMessageId: null, failureCode: "PROVIDER_UNAVAILABLE" };
  }

  const firestore = db();
  const taskRef = scope.doc("automationTasks", step.task.id);
  const completion = await firestore.runTransaction(async (transaction) => {
    const current = stored("automationTasks", await transaction.get(taskRef));
    // Esta execucao perdeu a tarefa (passou do prazo e outra a encerrou): o
    // resultado nao sobrescreve o que ja foi decidido.
    if (
      !current ||
      current.status !== "DISPATCHING" ||
      current.attempt !== step.task.attempt ||
      current.dispatchingSince !== step.task.dispatchingSince
    ) {
      return null;
    }
    const delivery = stored("notificationDeliveries", await transaction.get(scope.doc("notificationDeliveries", step.delivery.id)));
    if (!delivery) return null;

    const done = completeDispatch({ task: current, delivery, result, now: clock() });
    transaction.set(taskRef, toStored("automationTasks", done.task));
    transaction.set(scope.doc("notificationDeliveries", done.delivery.id), toStored("notificationDeliveries", done.delivery));
    writeEffects(transaction, scope, done.effects);
    return done;
  });

  if (!completion) return "LEASE_LOST";
  if (completion.requeueAt) {
    await enqueue(dispatchPayloadFor(completion.task), {
      at: completion.requeueAt,
      name: queueTaskName(completion.task, completion.requeueAt),
    });
  }
  return completion.task.status;
}

/**
 * Executa um ponteiro da Cloud Tasks. Le a tarefa e o estado atual na mesma
 * transacao que a adquire; envia fora dela; grava o resultado numa segunda
 * transacao que confere se a tarefa ainda e desta execucao.
 */
export async function runAutomationTask(data, deps = {}) {
  const {
    enqueue = enqueueDispatch,
    clock = () => new Date().toISOString(),
    providers = providerFor,
    // Nome da tarefa na Cloud Tasks que trouxe este ponteiro, quando houver.
    currentTaskName = null,
  } = deps;

  const parsed = payloadSchema.safeParse(data);
  if (!parsed.success) {
    // Ponteiro fora do contrato nao tem o que repetir.
    logger.warn("automation.dispatch.invalid_payload");
    return { outcome: "INVALID_PAYLOAD" };
  }
  const payload = parsed.data;
  const firestore = db();
  const scope = tenant(firestore, payload.organizationId);
  const taskRef = scope.doc("automationTasks", payload.taskId);
  const now = clock();

  const step = await firestore.runTransaction(async (transaction) => {
    const task = stored("automationTasks", await transaction.get(taskRef));
    const context = { delivery: null, organization: null, appointment: null, client: null, professional: null };

    if (task && !isTerminalStatus(task.status)) {
      if (task.deliveryId) {
        context.delivery = stored("notificationDeliveries", await transaction.get(scope.doc("notificationDeliveries", task.deliveryId)));
      }
      context.organization = organizationFrom(await transaction.get(firestore.doc(paths.organization(payload.organizationId))), now);
      if (task.appointmentId) {
        context.appointment = stored("appointments", await transaction.get(scope.doc("appointments", task.appointmentId)));
      }
      if (context.appointment) {
        context.client = stored("clients", await transaction.get(scope.doc("clients", context.appointment.clientId)));
        context.professional = stored(
          "professionals",
          await transaction.get(scope.doc("professionals", context.appointment.professionalId)),
        );
      }
    }

    const decided = decideDispatch({
      payload,
      task,
      delivery: context.delivery,
      organization: context.organization,
      profession: context.organization ? getProfession(context.organization.primaryProfession) : null,
      appointment: context.appointment,
      client: context.client,
      professionalName: context.professional?.displayName ?? context.appointment?.professionalName ?? null,
      now,
    });

    if (decided.kind === "STOP" || decided.kind === "SEND") {
      transaction.set(taskRef, toStored("automationTasks", decided.task));
      if (decided.delivery) {
        transaction.set(scope.doc("notificationDeliveries", decided.delivery.id), toStored("notificationDeliveries", decided.delivery));
      }
      if (decided.kind === "STOP") writeEffects(transaction, scope, decided.effects);
    }
    return decided;
  });

  let outcome;
  switch (step.kind) {
    case "BUSY":
      // Erro de proposito: a Cloud Tasks tenta de novo, e ai a outra execucao
      // ja terminou ou passou do prazo.
      throw new Error("automation.dispatch.busy");
    case "IGNORE":
      outcome = step.why;
      break;
    case "REQUEUE": {
      const name = queueTaskName(step.task, step.at);
      // Entregue antes da hora pedida, com o mesmo nome que seria pedido de
      // novo: nao ha o que repor. A Cloud Tasks recusaria o nome repetido e a
      // tarefa se perderia; o emulador aceitaria e entraria em ciclo. Erro faz a
      // fila tentar de novo mais tarde, com espera.
      if (name === currentTaskName) throw new Error("automation.dispatch.early");
      await enqueue(dispatchPayloadFor(step.task), { at: step.at, name });
      outcome = "REQUEUED";
      break;
    }
    case "STOP":
      outcome = step.task.status;
      break;
    case "SEND":
      outcome = await send(step, scope, { enqueue, clock, providers });
      break;
  }

  logger.info("automation.dispatch", {
    organizationId: payload.organizationId,
    taskId: payload.taskId,
    attempt: payload.attempt,
    outcome,
  });
  return { outcome };
}

export const dispatchAutomationTask = onTaskDispatched(
  {
    region: REGION,
    maxInstances: 5,
    timeoutSeconds: DISPATCHER_TIMEOUT_SECONDS,
    retryConfig: { ...DISPATCHER_QUEUE_RETRY },
    rateLimits: { maxConcurrentDispatches: 20 },
  },
  async (request) => {
    await runAutomationTask(request.data, { currentTaskName: request.id ?? null });
  },
);
