import { Timestamp } from "firebase-admin/firestore";

import { fromStored } from "./firestore-dates.js";
import { hasActiveAppointment } from "./generated/automation-assistant-availability.js";
import { paths } from "./generated/paths.js";

/**
 * O profissional esta dentro de um atendimento AGORA?
 *
 * Mora num modulo proprio porque a resposta e lida em dois instantes
 * diferentes -- ao planejar a resposta (`inbound.js`) e ao envia-la
 * (`automation.js`) -- e a pergunta tem de ser a MESMA nos dois. Tres copias da
 * consulta divergiriam com o tempo, e aí a trava do ADR 0007 passaria a
 * significar uma coisa no planejamento e outra no envio, que e exatamente o
 * tipo de diferenca que ninguem percebe antes de uma mensagem sair na hora
 * errada.
 *
 * A consulta pega os atendimentos que ja comecaram, do mais recente para tras;
 * quem decide se algum deles ainda esta em curso e `hasActiveAppointment`, que
 * confere o fim e a situacao. Sem profissional conhecido devolve `false`: nao
 * da para afirmar que alguem esta atendendo.
 */
export async function activeAppointmentOf(
  transaction,
  firestore,
  organizationId,
  professionalId,
  now,
) {
  if (!professionalId) return false;
  const recent = (
    await transaction.get(
      firestore
        .collection(paths.collection(organizationId, "appointments"))
        .where("professionalId", "==", professionalId)
        .where("startsAt", "<=", Timestamp.fromDate(new Date(now)))
        .orderBy("startsAt", "desc")
        .limit(20),
    )
  ).docs.map((document) =>
    fromStored("appointments", document.id, document.data()),
  );
  return hasActiveAppointment(recent, professionalId, now);
}
