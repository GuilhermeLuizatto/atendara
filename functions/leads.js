import { createHash, randomUUID } from "node:crypto";

import { fromStored, toStored } from "./firestore-dates.js";
import { transitionTask } from "./generated/automation.js";
import { paths } from "./generated/paths.js";

/**
 * Peças do primeiro contato que só o backend tem: o id do lead, a conversa
 * nova e o cancelamento da automação pendente. A política (fila, situação,
 * consentimento) continua em `src/lib/leads/`, transpilada.
 */

/**
 * Id do lead: o mesmo telefone na mesma organização dá sempre o mesmo id, e é
 * isso que impede uma reentrega da Meta de criar um segundo lead. A
 * organização entra no resumo: o mesmo número em outra clínica é outro lead,
 * e um id não revela que a pessoa fala com as duas.
 */
export function leadIdFor(organizationId, phone) {
  const digest = createHash("sha256")
    .update(`${organizationId}:${phone}`)
    .digest("hex");
  return `lead-${digest.slice(0, 32)}`;
}

/**
 * Conversa do lead. Aleatória, e não derivada do telefone: o id da conversa
 * fica para sempre em `aiDecisions.conversationId`, que a pseudonimização não
 * toca (regra 6). Uma repetição da transação sorteia outro id, e só a que
 * grava vale.
 */
export function newLeadConversationId() {
  return `wa-contato-${randomUUID()}`;
}

/**
 * O profissional responsável quando o contexto basta: a organização tem um
 * único profissional ativo. Com dois ou mais, ninguém é escolhido por palpite —
 * o lead fica sem responsável até a equipe decidir.
 */
export async function soleActiveProfessionalId(
  transaction,
  firestore,
  organizationId,
) {
  const found = await transaction.get(
    firestore
      .collection(paths.collection(organizationId, "professionals"))
      .where("active", "==", true)
      .limit(2),
  );
  return found.size === 1 ? found.docs[0].id : null;
}

const WAITING = new Set(["PLANNED", "SCHEDULED"]);

/**
 * Tarefas ainda canceláveis de um titular (`clientId` ou `leadId`), com as
 * entregas. Só leitura: quem chama grava depois, na mesma transação.
 */
export async function pendingAutomationOf(ctx) {
  const { transaction, firestore, scope, organizationId, field, id } = ctx;
  const tasks = (
    await transaction.get(
      firestore
        .collection(paths.collection(organizationId, "automationTasks"))
        .where(field, "==", id)
        .limit(50),
    )
  ).docs
    .map((document) =>
      fromStored("automationTasks", document.id, document.data()),
    )
    .filter((task) => task[field] === id && WAITING.has(task.status));
  const deliveries = [];
  for (const task of tasks) {
    if (!task.deliveryId) continue;
    const snapshot = await transaction.get(
      scope.doc("notificationDeliveries", task.deliveryId),
    );
    if (snapshot.exists)
      deliveries.push(
        fromStored("notificationDeliveries", snapshot.id, snapshot.data()),
      );
  }
  return { tasks, deliveries };
}

/**
 * Cancela o que ainda não saiu. Tarefa em execução (`DISPATCHING`) não é
 * tocada: pode já ter saído, e o despachante confere de novo antes de enviar.
 */
export function cancelPendingAutomation(ctx) {
  const { transaction, scope, tasks, deliveries, now, code } = ctx;
  let cancelled = 0;
  for (const task of tasks) {
    if (!WAITING.has(task.status)) continue;
    transaction.set(
      scope.doc("automationTasks", task.id),
      toStored(
        "automationTasks",
        transitionTask(task, "CANCELLED", {
          at: now,
          code,
          patch: { stopReason: code, completedAt: now },
        }),
      ),
    );
    cancelled += 1;
    const delivery = deliveries.find((item) => item.id === task.deliveryId);
    if (delivery && delivery.status !== "CANCELLED") {
      transaction.set(
        scope.doc("notificationDeliveries", delivery.id),
        toStored("notificationDeliveries", {
          ...delivery,
          status: "CANCELLED",
          cancelledAt: now,
          nextAttemptAt: null,
          updatedAt: now,
          updatedBy: null,
        }),
      );
    }
  }
  return cancelled;
}
