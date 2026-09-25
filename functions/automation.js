import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { z } from "zod";

import { DISPATCHER_NAME, enqueueDispatch, requeueTask, scheduleTask } from "./automation-queue.js";
import { accessTokenFor, reconcileEvent, syncResultFrom } from "./calendar-google.js";
import { calendarOwnerAllowed } from "./calendar-store.js";
import { fromStored, toStored } from "./firestore-dates.js";
import {
  applyCalendarResult,
  calendarFingerprint,
  calendarSyncKey,
  completeDispatch,
  decideCalendarDispatch,
  decideDispatch,
  decideReplyDispatch,
  dispatchPayloadFor,
  handoffDispatch,
  isTerminalStatus,
  isWaitingStatus,
  newCalendarSyncTask,
  noticeTaskId,
  planAppointmentChange,
  planCalendarSync,
  queueTaskName,
} from "./generated/automation.js";
import {
  AUTOMATION_ACCEPTED_CONTRACT_VERSIONS,
  DISPATCHER_QUEUE_RETRY,
  DISPATCHER_TIMEOUT_SECONDS,
  PLANNING_EVENT_MAX_AGE_MINUTES,
} from "./generated/automation-config.js";
import { providerFor } from "./generated/notifications-providers.js";
import { whatsappConversationId } from "./generated/automation-inbound.js";
import { bridgeProviderFrom } from "./n8n-bridge.js";
import { runAs, SERVICE_ACCOUNTS } from "./service-accounts.js";
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
export { DISPATCHER_NAME };

// `getFirestore()` preguicoso: os modulos sao avaliados antes de
// `initializeApp()` do index.js.
const db = () => getFirestore();

const payloadSchema = z
  .object({
    // Ponteiro agendado antes da publicacao chega com a versao antiga.
    version: z.number().int().refine((version) => AUTOMATION_ACCEPTED_CONTRACT_VERSIONS.includes(version)),
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

// A fila vive em automation-queue.js; quem ja importava daqui continua igual.
export { requeueTask };

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
    // Mesma conta do despachante: e ela que enfileira, e a tarefa carrega a
    // identidade de quem enfileirou.
    ...runAs("automacao"),
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

// --------------------------------------------------------- agenda Google

/** A conexão sem o token: o planejamento e o despacho não precisam dele. */
function writeConnectionFrom(snapshot) {
  const connection = stored("calendarConnections", snapshot);
  return connection ? { ...connection, scopes: connection.scopes ?? [] } : null;
}

/**
 * Planeja o reflexo de um atendimento na agenda "Atendara" do Google (3C).
 * Lê na mesma transação a organização, as tarefas do atendimento e a conexão
 * de quem atendia e de quem atende; grava só tarefas.
 */
export async function planCalendarChange(change, deps = {}) {
  const { enqueue = enqueueDispatch, clock = () => new Date().toISOString() } = deps;
  const { organizationId, appointmentId, before, after, changedAt } = change;
  const firestore = db();
  const scope = tenant(firestore, organizationId);

  const planned = await firestore.runTransaction(async (transaction) => {
    const organization = organizationFrom(
      await transaction.get(firestore.doc(paths.organization(organizationId))),
      changedAt,
    );
    if (!organization) return [];
    const tasks = (await transaction.get(scope.ofAppointment("automationTasks", appointmentId))).docs.map(
      (document) => stored("automationTasks", document),
    );
    const connections = {};
    for (const professionalId of new Set([before?.professionalId, after?.professionalId])) {
      if (!professionalId) continue;
      connections[professionalId] = writeConnectionFrom(
        await transaction.get(scope.doc("calendarConnections", professionalId)),
      );
    }
    const created = planCalendarSync({
      organizationId,
      appointmentId,
      before,
      after,
      connections,
      tasks,
      at: changedAt,
    });
    for (const task of created) {
      transaction.create(scope.doc("automationTasks", task.id), toStored("automationTasks", task));
    }
    return created;
  });

  for (const task of planned) await scheduleTask(task, { enqueue, clock });
  return { queued: planned.map((task) => task.id) };
}

export const planCalendarEvents = onDocumentWritten(
  {
    document: paths.document("{organizationId}", "appointments", "{appointmentId}"),
    region: REGION,
    maxInstances: 5,
    ...runAs("automacao"),
    // Separado dos avisos: uma falha aqui não segura lembrete, e vice-versa.
    retry: true,
  },
  async (event) => {
    if (Date.now() - Date.parse(event.time) > PLANNING_EVENT_MAX_AGE_MINUTES * 60_000) {
      logger.warn("calendar.plan.stale_event", { eventId: event.id });
      return;
    }
    const { organizationId, appointmentId } = event.params;
    const changedAt = event.data?.after?.exists
      ? event.data.after.updateTime.toDate().toISOString()
      : new Date(event.time).toISOString();
    const result = await planCalendarChange({
      organizationId,
      appointmentId,
      before: stored("appointments", event.data?.before),
      after: stored("appointments", event.data?.after),
      changedAt,
    });
    logger.info("calendar.plan", { organizationId, appointmentId, queued: result.queued.length });
  },
);

/**
 * Lê, na transação que adquire a tarefa de agenda, o que ela precisa conferir.
 * O token cifrado sai daqui só para a memória desta execução.
 */
async function calendarContext(transaction, firestore, scope, payload, task, now) {
  const organization = organizationFrom(
    await transaction.get(firestore.doc(paths.organization(payload.organizationId))),
    now,
  );
  const appointment = task.appointmentId
    ? stored("appointments", await transaction.get(scope.doc("appointments", task.appointmentId)))
    : null;
  const connection = task.professionalId
    ? writeConnectionFrom(await transaction.get(scope.doc("calendarConnections", task.professionalId)))
    : null;
  const professional = task.professionalId
    ? stored("professionals", await transaction.get(scope.doc("professionals", task.professionalId)))
    : null;
  const ownerLinked =
    !!professional?.userId &&
    (await calendarOwnerAllowed(transaction, {
      organizationId: payload.organizationId,
      professionalId: task.professionalId,
      userId: professional.userId,
    }));
  return { organization, appointment, connection, ownerLinked };
}

/**
 * Executa a sincronização fora da transação e grava o resultado numa segunda,
 * que confere se a tarefa ainda é desta execução. Se o atendimento mudou no
 * meio, agenda mais uma rodada: a última escrita no Google nunca fica velha.
 */
async function runCalendarSync(step, scope, { enqueue, clock, google, ciphertext }) {
  let result;
  try {
    const accessToken = await google.accessTokenFor(ciphertext);
    await google.reconcileEvent({
      accessToken,
      calendarId: step.calendarId,
      eventId: step.eventId,
      event: step.event,
    });
    result = { outcome: "SYNCED" };
  } catch (error) {
    result = syncResultFrom(error);
  }

  const firestore = db();
  const taskRef = scope.doc("automationTasks", step.task.id);
  const outcome = await firestore.runTransaction(async (transaction) => {
    const current = stored("automationTasks", await transaction.get(taskRef));
    if (
      !current ||
      current.status !== "DISPATCHING" ||
      current.attempt !== step.task.attempt ||
      current.dispatchingSince !== step.task.dispatchingSince
    ) {
      return null;
    }
    const connectionRef = scope.doc("calendarConnections", current.professionalId);
    const connection = stored("calendarConnections", await transaction.get(connectionRef));
    const appointment = stored("appointments", await transaction.get(scope.doc("appointments", current.appointmentId)));
    const siblings = (await transaction.get(scope.ofAppointment("automationTasks", current.appointmentId))).docs.map(
      (document) => stored("automationTasks", document),
    );

    const now = clock();
    const done = applyCalendarResult({ task: current, result, now });
    transaction.set(taskRef, toStored("automationTasks", done.task));
    writeEffects(transaction, scope, done.effects);

    // Autorização caída: a conexão passa a pedir reconexão — só se ainda for a
    // mesma que esta execução usou; uma desconexão no meio prevalece.
    if (
      result.failureCode === "CALENDAR_RECONNECT_REQUIRED" &&
      connection?.status === "CONNECTED" &&
      connection.generation === step.generation
    ) {
      transaction.set(
        connectionRef,
        toStored("calendarConnections", {
          ...connection,
          status: "ERROR",
          lastError: "RECONNECT_REQUIRED",
          updatedAt: now,
          updatedBy: null,
        }),
      );
    }

    let followUp = null;
    const key = calendarSyncKey(current.appointmentId, current.professionalId);
    if (
      result.outcome === "SYNCED" &&
      calendarFingerprint(appointment, current.professionalId) !== step.fingerprint &&
      !siblings.some((task) => task.idempotencyKey === key && task.id !== current.id && isWaitingStatus(task.status))
    ) {
      followUp = newCalendarSyncTask({
        id: noticeTaskId(key, siblings),
        organizationId: current.organizationId,
        appointmentId: current.appointmentId,
        professionalId: current.professionalId,
        appointmentStartsAt: appointment?.startsAt ?? current.appointmentStartsAt,
        at: now,
      });
      transaction.create(scope.doc("automationTasks", followUp.id), toStored("automationTasks", followUp));
    }
    return { done, followUp };
  });

  if (!outcome) return "LEASE_LOST";
  if (outcome.done.requeueAt) {
    await enqueue(dispatchPayloadFor(outcome.done.task), {
      at: outcome.done.requeueAt,
      name: queueTaskName(outcome.done.task, outcome.done.requeueAt),
    });
  }
  if (outcome.followUp) await scheduleTask(outcome.followUp, { enqueue, clock });
  return outcome.done.task.status;
}

// ------------------------------------------------------------ despachante

/**
 * Provedor de cada canal. Todos os canais estao em `SIMULATED` hoje
 * (`CHANNEL_META`), entao a ponte do n8n so entra se alguem trocar aquela
 * linha — e mesmo assim so existe com `N8N_WEBHOOK_URL` e o segredo A no
 * ambiente. Sem eles, o canal falha dizendo isso, em vez de sair por outro
 * caminho.
 */
function defaultProviders(channel) {
  const bridge = bridgeProviderFrom();
  return providerFor(channel, bridge ? { N8N_BRIDGE: () => bridge } : {});
}

/**
 * Entrega aceita por um executor de fora (13.3): a tarefa fica em `DISPATCHED`
 * e a entrega segue `SENDING` ate o retorno assinado chegar pelo
 * `automationCallback`. Nada de `SENT` aqui — o canal real ainda nem falou.
 */
async function handoff(step, scope, { clock }) {
  const firestore = db();
  const taskRef = scope.doc("automationTasks", step.task.id);
  return firestore.runTransaction(async (transaction) => {
    const current = stored("automationTasks", await transaction.get(taskRef));
    if (
      !current ||
      current.status !== "DISPATCHING" ||
      current.attempt !== step.task.attempt ||
      current.dispatchingSince !== step.task.dispatchingSince
    ) {
      return "LEASE_LOST";
    }
    transaction.set(taskRef, toStored("automationTasks", handoffDispatch(current, clock())));
    return "DISPATCHED";
  });
}

async function send(step, scope, { enqueue, clock, providers }) {
  const provider = providers(step.request.channel);
  let result;
  try {
    result = await provider.send(step.request);
  } catch {
    // Excecao do provedor e falha temporaria: a politica de tentativas decide.
    result = { outcome: "TEMPORARY_FAILURE", providerMessageId: null, failureCode: "PROVIDER_UNAVAILABLE" };
  }

  // Provedor de entrega em duas etapas: aceitar nao e enviar.
  if (provider.handoff && result.outcome === "ACCEPTED") return handoff(step, scope, { clock });

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
    providers = defaultProviders,
    google = { accessTokenFor, reconcileEvent },
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

  let ciphertext = null;
  const step = await firestore.runTransaction(async (transaction) => {
    const task = stored("automationTasks", await transaction.get(taskRef));
    const context = {
      delivery: null,
      organization: null,
      appointment: null,
      client: null,
      professional: null,
      sender: null,
      conversation: null,
      offer: null,
    };
    // As duas chaves, lidas na MESMA transacao que adquire a tarefa: desligar
    // no meio do caminho para o envio que ja estava a caminho.
    const switches = {
      organization: stored("automationSwitches", await transaction.get(scope.doc("automationSwitches", "organization"))),
      global: stored("platformAutomationSwitch", await transaction.get(firestore.doc(paths.platformAutomationSwitch()))),
    };

    if (task?.type === "SYNC_CALENDAR_EVENT") {
      const calendar = isTerminalStatus(task.status)
        ? { organization: null, appointment: null, connection: null, ownerLinked: false }
        : await calendarContext(transaction, firestore, scope, payload, task, now);
      const decided = decideCalendarDispatch({
        payload,
        task,
        organization: calendar.organization,
        profession: calendar.organization ? getProfession(calendar.organization.primaryProfession) : null,
        appointment: calendar.appointment,
        connection: calendar.connection,
        ownerLinked: calendar.ownerLinked,
        switches,
        now,
      });
      if (decided.kind === "STOP" || decided.kind === "SYNC") {
        transaction.set(taskRef, toStored("automationTasks", decided.task));
        if (decided.kind === "STOP") writeEffects(transaction, scope, decided.effects);
      }
      if (decided.kind === "SYNC") ciphertext = calendar.connection?.refreshTokenCiphertext ?? null;
      return decided;
    }

    if (task && !isTerminalStatus(task.status)) {
      if (task.deliveryId) {
        context.delivery = stored("notificationDeliveries", await transaction.get(scope.doc("notificationDeliveries", task.deliveryId)));
      }
      context.organization = organizationFrom(await transaction.get(firestore.doc(paths.organization(payload.organizationId))), now);
      if (task.appointmentId) {
        context.appointment = stored("appointments", await transaction.get(scope.doc("appointments", task.appointmentId)));
      }
      if (task.channel) {
        // Quem pode falar pelo numero da organizacao naquele canal. Lido na
        // MESMA transacao: um remetente revogado entre planejar e enviar para
        // o envio que ja estava planejado.
        context.sender = stored("messagingSenders", await transaction.get(scope.doc("messagingSenders", task.channel)));
      }
      if (context.appointment) {
        context.client = stored("clients", await transaction.get(scope.doc("clients", context.appointment.clientId)));
        context.professional = stored(
          "professionals",
          await transaction.get(scope.doc("professionals", context.appointment.professionalId)),
        );
      }
      if (task.type === "SEND_CONVERSATION_REPLY" && task.clientId) {
        // A conversa e o pedido se deduzem do cadastro, pela regra do webhook:
        // a tarefa nao guarda o id da conversa, que carrega o do cadastro.
        const conversationId = whatsappConversationId(task.clientId, "");
        context.conversation = stored("conversations", await transaction.get(scope.doc("conversations", conversationId)));
        context.offer = stored("rescheduleRequests", await transaction.get(scope.doc("rescheduleRequests", conversationId)));
      }
    }

    const common = {
      payload,
      task,
      delivery: context.delivery,
      organization: context.organization,
      profession: context.organization ? getProfession(context.organization.primaryProfession) : null,
      appointment: context.appointment,
      client: context.client,
      professionalName: context.professional?.displayName ?? context.appointment?.professionalName ?? null,
      sender: context.sender,
      switches,
      now,
    };
    const decided =
      task?.type === "SEND_CONVERSATION_REPLY"
        ? decideReplyDispatch({ ...common, conversation: context.conversation, offer: context.offer })
        : decideDispatch(common);

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
    case "SYNC":
      outcome = await runCalendarSync(step, scope, { enqueue, clock, google, ciphertext });
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
    ...runAs("automacao"),
    // A agenda Google troca a credencial cifrada por token de acesso aqui.
    secrets: ["GOOGLE_OAUTH_CLIENT_SECRET"],
    // Quem pode colocar tarefa nesta fila e chamar este despachante. Com isto a
    // CLI concede as duas permissoes so a conta da automacao, na fila e na
    // function — em vez de um papel no projeto inteiro.
    invoker: [SERVICE_ACCOUNTS.automacao],
    rateLimits: { maxConcurrentDispatches: 20 },
  },
  async (request) => {
    await runAutomationTask(request.data, { currentTaskName: request.id ?? null });
  },
);
