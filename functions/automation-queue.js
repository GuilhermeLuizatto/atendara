import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";

import { fromStored, toStored } from "./firestore-dates.js";
import {
  dispatchPayloadFor,
  queueEnqueueAt,
  queueTaskName,
  transitionTask,
} from "./generated/automation.js";
import { DISPATCHER_TIMEOUT_SECONDS } from "./generated/automation-config.js";
import { paths } from "./generated/paths.js";

/**
 * A fila da Cloud Tasks, separada dos gatilhos que a usam.
 *
 * Existe à parte para que quem planeja fora da agenda — o webhook de mensagens,
 * que planeja a resposta da assistente — ponha tarefa na fila sem carregar os
 * gatilhos do Firestore, do Google e do despachante.
 */

const REGION = "southamerica-east1";
export const DISPATCHER_NAME = "dispatchAutomationTask";

const db = () => getFirestore();

export async function enqueueDispatch(payload, { at, name }) {
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

/**
 * Repor uma tentativa na Cloud Tasks a partir de fora do despachante — hoje so
 * o retorno da ponte do n8n (13.3), que decide a nova tentativa noutra function.
 */
export async function requeueTask(task, at) {
  await enqueueDispatch(dispatchPayloadFor(task), { at, name: queueTaskName(task, at) });
}

/**
 * Pede a fila e marca a tarefa como agendada. Chamado DEPOIS da transacao que a
 * criou: rede dentro de transacao seria refeita a cada repeticao do Firestore.
 */
export async function scheduleTask(task, { enqueue = enqueueDispatch, clock = () => new Date().toISOString() } = {}) {
  const now = clock();
  const at = queueEnqueueAt(task, now);
  await enqueue(dispatchPayloadFor(task), { at, name: queueTaskName(task, at) });

  const firestore = db();
  const ref = firestore.doc(paths.document(task.organizationId, "automationTasks", task.id));
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot?.exists ? fromStored("automationTasks", snapshot.id, snapshot.data()) : null;
    // So a tentativa que acabou de ir para a fila muda de estado. Se o
    // despachante ja a pegou, o estado dele prevalece.
    if (!current || current.status !== "PLANNED" || current.attempt !== task.attempt) return;
    transaction.set(ref, toStored("automationTasks", transitionTask(current, "SCHEDULED", { at: now })));
  });
}
