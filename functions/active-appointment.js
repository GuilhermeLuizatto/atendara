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
/**
 * A leitura que a trava do ADR 0007 precisa, ou `undefined` quando a
 * organizacao nao pediu a trava.
 *
 * A decisao de CONSULTAR mora aqui, e nao em cada chamador, pelo mesmo motivo
 * que a consulta: `inbound.js` e `automation.js` precisam concordar. Enquanto
 * cada um lia a chave por conta propria, um deles lia o documento cru e o outro
 * o documento com os padroes aplicados -- e as duas metades discordariam no dia
 * em que o padrao mudasse. Agora os dois passam a organizacao montada e a
 * resposta e a mesma.
 *
 * `undefined` nao e "nao esta atendendo": e "a trava nao se aplica". Quem
 * recebe esse valor e o portao, que so olha para ele quando a trava esta
 * ligada.
 */
export async function activeAppointmentForReply(
  transaction,
  firestore,
  organization,
  organizationId,
  professionalId,
  now,
) {
  if (!organization?.settings?.ai?.replyOnlyDuringAppointment) return undefined;
  return activeAppointmentOf(
    transaction,
    firestore,
    organizationId,
    professionalId,
    now,
  );
}

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
