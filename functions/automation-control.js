import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fromStored, toStored } from "./firestore-dates.js";
import { hasRequiredSecondFactor } from "./generated/access-gate.js";
import { isTerminalStatus, queueEnqueueAt, transitionTask } from "./generated/automation.js";
import { paths } from "./generated/paths.js";
import { permissionsForMembership } from "./generated/permissions.js";
import { requeueTask } from "./automation.js";
import { ACCOUNT_CALL_OPTIONS, accountOf, masterOf, parse } from "./platform-auth.js";
import { consumeRateLimit } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";

/**
 * Controle da automacao (Fase 3, 13.9): a chave de emergencia e o reenvio.
 *
 * **A chave para a saida, nao a fila.** Tarefa parada continua com estado e
 * tentativa intactos; ao religar, ela sai. Cancelar seria perder aviso que
 * alguem ja consentiu em receber — e a chave existe para o momento em que nao
 * se sabe o que esta errado, quando perder informacao e o pior caminho.
 *
 * Sao duas chaves, e as duas param: a da organizacao, do titular, e a geral, da
 * chave mestra com segundo fator. A geral nao religa quem desligou a propria.
 */

const CALL_OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("automacao") };

const db = () => getFirestore();

const reason = z.string().trim().min(10).max(500);
const switchSchema = z.object({ enabled: z.boolean(), reason }).strict();
const retrySchema = z.object({ taskId: z.string().min(1).max(700) }).strict();

function stored(collection, snapshot) {
  return snapshot?.exists ? fromStored(collection, snapshot.id, snapshot.data()) : null;
}

/** A trilha do tenant: quem mexeu na chave, quando e por que. */
function auditEntry({ organizationId, action, summary, actorId, metadata, now }) {
  const id = randomUUID();
  return {
    id,
    organizationId,
    actorType: "USER",
    actorId,
    actorName: null,
    action,
    resource: { type: "organization", id: organizationId },
    summary,
    metadata,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  };
}

async function membershipOf(request, permission) {
  const account = await accountOf(request);
  const organizationId = account.organizationId;
  if (!organizationId) throw new HttpsError("failed-precondition", "Cadastro sem organização.");

  const organization = (await db().doc(paths.organization(organizationId)).get()).data();
  const member = (await db().doc(paths.document(organizationId, "members", request.auth.uid)).get()).data();
  if (!member || member.status !== "ACTIVE") throw new HttpsError("permission-denied", "Vínculo não está ativo.");

  const permissions = permissionsForMembership(member.role, organization?.ownerId === request.auth.uid);
  if (!permissions.includes(permission)) {
    throw new HttpsError("permission-denied", "Seu papel não permite esta ação.");
  }
  return { account, organizationId };
}

/**
 * A chave da organizacao. Do titular — e nao so de quem administra —, porque
 * quem responde pela clinica precisa conseguir calar o sistema na hora.
 */
export const setOrganizationAutomationSwitch = onCall(CALL_OPTIONS, async (request) => {
  const { organizationId } = await membershipOf(request, "automationSwitch:manage");
  await consumeRateLimit(request.auth.uid, "automationSwitch");
  const input = parse(switchSchema, request.data);

  const now = new Date().toISOString();
  const firestore = db();
  await firestore.runTransaction(async (transaction) => {
    const audit = auditEntry({
      organizationId,
      action: "ORGANIZATION_UPDATED",
      summary: input.enabled
        ? "Saída de mensagens religada pela organização."
        : "Saída de mensagens suspensa pela organização.",
      actorId: request.auth.uid,
      metadata: { switch: "ORGANIZATION", enabled: input.enabled, reason: input.reason },
      now,
    });

    transaction.set(
      firestore.doc(paths.document(organizationId, "automationSwitches", "organization")),
      toStored("automationSwitches", {
        id: "organization",
        organizationId,
        enabled: input.enabled,
        reason: input.reason,
        changedAt: now,
        changedBy: request.auth.uid,
        createdAt: now,
        createdBy: request.auth.uid,
        updatedAt: now,
        updatedBy: request.auth.uid,
      }),
    );
    transaction.create(firestore.doc(paths.document(organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
  });

  logger.info("automation.switch", { organizationId, enabled: input.enabled, scope: "ORGANIZATION" });
  return { enabled: input.enabled };
});

/**
 * A chave geral. Chave mestra com segundo fator: e o botao que cala a
 * plataforma inteira, e ele nao pode depender de uma senha sozinha.
 */
export const setGlobalAutomationSwitch = onCall(CALL_OPTIONS, async (request) => {
  const master = await masterOf(request);
  if (!hasRequiredSecondFactor(request.auth.token)) {
    throw new HttpsError("permission-denied", "Entre com o segundo fator para usar a chave geral.");
  }
  await consumeRateLimit(request.auth.uid, "automationSwitch");
  const input = parse(switchSchema, request.data);

  const now = new Date().toISOString();
  const firestore = db();
  const auditId = randomUUID();
  await firestore.runTransaction(async (transaction) => {
    transaction.set(
      firestore.doc(paths.platformAutomationSwitch()),
      toStored("platformAutomationSwitch", {
        id: "global",
        enabled: input.enabled,
        reason: input.reason,
        changedAt: now,
        changedBy: master.id ?? request.auth.uid,
        createdAt: now,
        createdBy: master.id ?? request.auth.uid,
        updatedAt: now,
        updatedBy: master.id ?? request.auth.uid,
      }),
    );
    transaction.create(
      firestore.doc(paths.platformAuditLog(auditId)),
      {
        id: auditId,
        action: "ACCOUNT_UPDATED",
        actorId: master.id ?? request.auth.uid,
        organizationId: null,
        targetUserId: null,
        reason: input.reason,
        details: { switch: "GLOBAL", enabled: input.enabled },
        createdAt: now,
      },
    );
  });

  logger.info("plataforma.ato", {
    action: "AUTOMATION_SWITCH",
    actorId: master.id ?? request.auth.uid,
    organizationId: null,
    auditId,
  });
  return { enabled: input.enabled };
});

/**
 * Reenviar uma tarefa que falhou.
 *
 * So tarefa TERMINADA em falha volta — reenviar o que ainda esta na fila seria
 * mandar duas vezes. A tentativa recomeca do zero, com registro de quem pediu:
 * quem ve o problema nao e necessariamente quem decide reenviar.
 */
export const retryAutomationTask = onCall(CALL_OPTIONS, async (request) => {
  const { organizationId } = await membershipOf(request, "automationTask:retry");
  await consumeRateLimit(request.auth.uid, "automationRetry");
  const input = parse(retrySchema, request.data);

  const firestore = db();
  const ref = firestore.doc(paths.document(organizationId, "automationTasks", input.taskId));
  const now = new Date().toISOString();

  const reposta = await firestore.runTransaction(async (transaction) => {
    const task = stored("automationTasks", await transaction.get(ref));
    if (!task) throw new HttpsError("not-found", "Tarefa não encontrada.");
    if (task.status !== "FAILED") {
      throw new HttpsError("failed-precondition", "Só tarefa que falhou pode ser reenviada.");
    }
    if (!isTerminalStatus(task.status)) throw new HttpsError("failed-precondition", "A tarefa ainda está em andamento.");

    // Volta como tarefa nova: estado inicial, tentativa 1 e validade em aberto
    // a partir de agora. O histórico antigo continua no documento.
    const renewed = {
      ...task,
      status: "PLANNED",
      attempt: 1,
      failureCode: null,
      stopReason: null,
      providerMessageId: null,
      dispatchingSince: null,
      completedAt: null,
      scheduledFor: now,
      updatedAt: now,
      updatedBy: request.auth.uid,
      history: [...task.history, { from: task.status, to: "PLANNED", at: now, attempt: 1, code: "MANUAL_RETRY" }],
    };

    const audit = auditEntry({
      organizationId,
      action: "ORGANIZATION_UPDATED",
      summary: "Tarefa de automação reenviada manualmente.",
      actorId: request.auth.uid,
      metadata: { automationTaskId: task.id, previousStatus: task.status },
      now,
    });

    transaction.set(ref, toStored("automationTasks", renewed));
    transaction.create(firestore.doc(paths.document(organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
    return renewed;
  });

  await requeueTask(reposta, queueEnqueueAt(reposta, now));
  return { taskId: reposta.id, status: reposta.status };
});
