import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

import { fromStored, toStored } from "./firestore-dates.js";
import { paths } from "./generated/paths.js";
import { cancelPendingAutomation } from "./leads.js";
import { runAs } from "./service-accounts.js";

/**
 * Resposta humana pelo painel vence a resposta da Dara.
 *
 * O navegador não escreve na fila (`automationTasks` é só do backend), então
 * assumir a conversa no painel marca a conversa, e este gatilho cancela o que
 * ainda esperava a vez. O despachante confere a mesma coisa antes de enviar
 * (`CONVERSATION_WITH_HUMAN`); o gatilho existe para a fila mostrar o
 * cancelamento na hora, e não só quando o prazo da resposta chegar.
 */

const REGION = "southamerica-east1";

function stored(collection, snapshot) {
  return snapshot?.exists
    ? fromStored(collection, snapshot.id, snapshot.data())
    : null;
}

export async function cancelReplyAfterTakeover({
  organizationId,
  conversationId,
  clock = () => new Date().toISOString(),
}) {
  const firestore = getFirestore();
  const now = clock();
  const scope = {
    doc: (collection, id) =>
      firestore.doc(paths.document(organizationId, collection, id)),
  };

  return firestore.runTransaction(async (transaction) => {
    // Relida aqui: o gatilho pode chegar atrasado, depois de a equipe já ter
    // devolvido a conversa à Dara — e aí não há o que cancelar.
    const conversation = stored(
      "conversations",
      await transaction.get(scope.doc("conversations", conversationId)),
    );
    if (!conversation?.escalated || !conversation.pendingAssistantTaskId) {
      return { outcome: "NOTHING_PENDING" };
    }
    const task = stored(
      "automationTasks",
      await transaction.get(
        scope.doc("automationTasks", conversation.pendingAssistantTaskId),
      ),
    );
    const delivery = task?.deliveryId
      ? stored(
          "notificationDeliveries",
          await transaction.get(
            scope.doc("notificationDeliveries", task.deliveryId),
          ),
        )
      : null;

    const cancelled = cancelPendingAutomation({
      transaction,
      scope,
      tasks: task ? [task] : [],
      deliveries: delivery ? [delivery] : [],
      now,
      code: "CONVERSATION_WITH_HUMAN",
    });
    transaction.set(
      scope.doc("conversations", conversationId),
      toStored("conversations", {
        pendingAssistantTaskId: null,
        updatedAt: now,
        updatedBy: null,
      }),
      { merge: true },
    );
    if (cancelled) {
      const auditId = `${task.id}-assumida`;
      transaction.create(
        scope.doc("auditLogs", auditId),
        toStored("auditLogs", {
          id: auditId,
          organizationId,
          actorType: "SYSTEM",
          actorId: null,
          actorName: "Automação do Atendara",
          action: "UPDATE",
          resource: { type: "conversation", id: conversationId },
          summary:
            "Conversa assumida pela equipe no painel; resposta automática pendente cancelada.",
          metadata: { taskId: task.id },
          occurredAt: now,
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        }),
      );
    }
    return { outcome: cancelled ? "CANCELLED" : "NOTHING_PENDING" };
  });
}

export const cancelRepliesOnHumanTakeover = onDocumentUpdated(
  {
    document: paths.document(
      "{organizationId}",
      "conversations",
      "{conversationId}",
    ),
    region: REGION,
    maxInstances: 5,
    ...runAs("automacao"),
    // Repetir é inofensivo: a transação relê a conversa e não acha mais nada.
    retry: true,
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after?.escalated || !after.pendingAssistantTaskId) return;
    const result = await cancelReplyAfterTakeover({
      organizationId: event.params.organizationId,
      conversationId: event.params.conversationId,
    });
    logger.info("automation.handoff", {
      organizationId: event.params.organizationId,
      outcome: result.outcome,
    });
  },
);
