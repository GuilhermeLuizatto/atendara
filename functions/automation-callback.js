import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";

import { fromStored, toStored } from "./firestore-dates.js";
import { applyDispatchResult } from "./generated/automation.js";
import {
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_TIMESTAMP_HEADER,
  decideCallback,
  isWithinSignatureWindow,
  parseCallbackPayload,
  progressFields,
} from "./generated/automation-bridge.js";
import { requeueTask } from "./automation.js";
import { paths } from "./generated/paths.js";
import { verifyBridgeSignature } from "./n8n-bridge.js";
import { runAs } from "./service-accounts.js";

/**
 * A volta da ponte com o n8n (Fase 3, 13.3).
 *
 * O n8n executou o canal e relata o resultado. Esta rota e publica por
 * necessidade — quem chama esta numa VPS, fora do Google Cloud —, entao a
 * defesa e em camadas, nesta ordem:
 *
 * 1. assinatura HMAC com o segredo B, sobre horario **e** corpo bruto;
 * 2. janela de 5 minutos, para retorno capturado nao valer para sempre;
 * 3. formato conferido campo a campo (`parseCallbackPayload`);
 * 4. a tarefa lida do banco manda: organizacao, tentativa, estado e prazo
 *    (`decideCallback`). Nada do corpo vira verdade alem do resultado do envio.
 *
 * O resultado entra pelo MESMO caminho do provedor simulado
 * (`applyDispatchResult`), na mesma transacao que grava trilha e alerta. O n8n
 * nao escreve na trilha, nao apaga nada e nao alcanca outra organizacao.
 */

const REGION = "southamerica-east1";
const SECRETS = ["N8N_CALLBACK_SECRET"];

const db = () => getFirestore();

function stored(collection, snapshot) {
  return snapshot?.exists ? fromStored(collection, snapshot.id, snapshot.data()) : null;
}

/** Recusa sem pista: quem nao assina corretamente nao aprende o porque. */
function refuse(response, status, outcome, detail) {
  logger.warn("automation.callback.refused", { outcome, ...detail });
  response.status(status).send(status === 401 ? "Assinatura inválida." : "Retorno recusado.");
}

export async function applyCallback(payload, deps = {}) {
  const { clock = () => new Date().toISOString(), enqueue = requeueTask } = deps;
  const firestore = db();
  const now = clock();
  const taskRef = firestore.doc(paths.document(payload.organizationId, "automationTasks", payload.taskId));

  const applied = await firestore.runTransaction(async (transaction) => {
    const task = stored("automationTasks", await transaction.get(taskRef));
    const delivery = task?.deliveryId
      ? stored(
          "notificationDeliveries",
          await transaction.get(firestore.doc(paths.document(payload.organizationId, "notificationDeliveries", task.deliveryId))),
        )
      : null;

    const decision = decideCallback({ payload, task, delivery, now });

    // Entregue e lida nao mexem na tarefa: ela ja terminou quando o provedor
    // aceitou. Carimbam a entrega, e so na primeira vez que chegam.
    if (decision.kind === "PROGRESS") {
      const campos = progressFields(decision.delivery, decision.state, now);
      if (Object.keys(campos).length > 0) {
        transaction.set(
          firestore.doc(paths.document(payload.organizationId, "notificationDeliveries", decision.delivery.id)),
          toStored("notificationDeliveries", { ...decision.delivery, ...campos, updatedAt: now, updatedBy: null }),
        );
      }
      return { kind: "PROGRESS", state: decision.state };
    }

    if (decision.kind !== "APPLY") return decision;

    const done = applyDispatchResult({
      task: decision.task,
      delivery: decision.delivery,
      result: {
        outcome: payload.outcome,
        providerMessageId: payload.providerMessageId,
        failureCode: payload.failureCode,
      },
      now,
    });

    transaction.set(taskRef, toStored("automationTasks", done.task));
    transaction.set(
      firestore.doc(paths.document(payload.organizationId, "notificationDeliveries", done.delivery.id)),
      toStored("notificationDeliveries", done.delivery),
    );
    for (const effect of done.effects) {
      transaction.create(
        firestore.doc(paths.document(payload.organizationId, "automationTasks", effect.task.id)),
        toStored("automationTasks", effect.task),
      );
      const [collection, entity] = effect.kind === "WRITE_AUDIT" ? ["auditLogs", effect.audit] : ["notifications", effect.alert];
      transaction.create(
        firestore.doc(paths.document(payload.organizationId, collection, entity.id)),
        toStored(collection, entity),
      );
    }
    return { kind: "APPLIED", task: done.task, requeueAt: done.requeueAt };
  });

  // Nova tentativa volta para a Cloud Tasks FORA da transacao, como no
  // despachante: pedir fila dentro dela repetiria o pedido a cada retentativa.
  if (applied.kind === "APPLIED" && applied.requeueAt && enqueue) {
    await enqueue(applied.task, applied.requeueAt);
  }
  return applied;
}

export const automationCallback = onRequest(
  { region: REGION, maxInstances: 5, secrets: SECRETS, ...runAs("automacao") },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Método não suportado.");
      return;
    }

    const secret = process.env.N8N_CALLBACK_SECRET;
    if (!secret) {
      logger.error("automation.callback.no_secret");
      response.status(503).send("Ponte de automação não configurada.");
      return;
    }

    const timestamp = request.get(BRIDGE_TIMESTAMP_HEADER);
    const signature = request.get(BRIDGE_SIGNATURE_HEADER);
    const body = request.rawBody?.toString("utf8") ?? "";
    const now = new Date().toISOString();

    if (!timestamp || !isWithinSignatureWindow(timestamp, now)) {
      refuse(response, 401, "STALE_TIMESTAMP", {});
      return;
    }
    if (!verifyBridgeSignature(secret, timestamp, body, signature)) {
      refuse(response, 401, "BAD_SIGNATURE", {});
      return;
    }

    let parsed = null;
    try {
      parsed = parseCallbackPayload(JSON.parse(body));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      refuse(response, 400, "BAD_PAYLOAD", {});
      return;
    }

    try {
      const applied = await applyCallback(parsed);
      if (applied.kind === "REJECT") {
        refuse(response, 409, applied.why, { taskId: parsed.taskId, organizationId: parsed.organizationId });
        return;
      }
      // Ignorado tambem responde 200: e retorno repetido, e repetir a recusa so
      // faria o n8n insistir.
      logger.info("automation.callback", {
        organizationId: parsed.organizationId,
        taskId: parsed.taskId,
        attempt: parsed.attempt,
        outcome: applied.kind === "APPLIED" ? applied.task.status : (applied.state ?? applied.why),
      });
      response.status(200).json({ outcome: applied.kind === "APPLIED" ? applied.task.status : (applied.state ?? applied.why) });
    } catch (error) {
      // 500 faz o n8n tentar de novo; a idempotencia torna repetir seguro.
      logger.error("automation.callback.failed", { taskId: parsed.taskId, message: String(error) });
      response.status(500).send("Falha ao aplicar o retorno.");
    }
  },
);
