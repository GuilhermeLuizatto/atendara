import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

import { nextSeal } from "./audit-seal-chain.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { paths } from "./generated/paths.js";
import { runAs } from "./service-accounts.js";

/**
 * Selo da trilha: o gatilho (secao 4 do plano das trilhas, decidido em 17/11).
 *
 * Toda entrada criada em `auditLogs` ganha um registro em `auditSeals`, numa
 * colecao que o navegador nao le nem escreve. O calculo vive em
 * `audit-seal-chain.js`, que explica o que o selo prova e o que ele nao prova —
 * em resumo: remocao, reordenacao e alteracao dos campos protegidos ficam
 * detectaveis; entrada inventada em nome proprio continua possivel e e risco
 * aceito por escrito pelo titular.
 *
 * **Horario do servidor.** O selo usa `createTime` do documento da trilha, nao
 * `occurredAt` nem `createdAt`, que o cliente escolhe. `createTime` tambem e o
 * mesmo valor em toda reentrega do evento, entao o resumo de uma entrada nunca
 * depende de quando o gatilho rodou.
 *
 * **Concorrencia e reentrega.** Indice e elo nascem numa transacao que le a
 * cabeca da corrente (`auditSealChains/organization`) e a reescreve: duas
 * entradas simultaneas disputam o mesmo documento e saem com indices
 * diferentes, nunca com o mesmo. A reentrega do mesmo evento e inofensiva
 * porque o selo tem o id da entrada: se ele ja existe, a transacao nao faz
 * nada.
 *
 * **Conta de servico.** Roda com `fn-automacao`, que ja e a identidade dos
 * gatilhos de Firestore deste tenant. Uma conta propria exigiria cria-la no
 * Google Cloud antes de publicar, e o selo nao precisa de papel nenhum alem do
 * Firestore que aquele grupo ja tem.
 */

const REGION = "southamerica-east1";
const db = () => getFirestore();

/** A cabeca da corrente: um documento por organizacao, como `receiptCounters`. */
export const CHAIN_DOCUMENT_ID = "organization";

/**
 * Sela uma entrada. Devolve o que aconteceu, para o log do gatilho e para os
 * testes; nunca lanca por entrada ja selada.
 */
export async function sealAuditEntry({ organizationId, logId, entry, writtenAt }) {
  const sealRef = db().doc(paths.document(organizationId, "auditSeals", logId));
  const chainRef = db().doc(paths.document(organizationId, "auditSealChains", CHAIN_DOCUMENT_ID));

  return db().runTransaction(async (transaction) => {
    const [sealed, chain] = await transaction.getAll(sealRef, chainRef);
    // Idempotencia pelo id da entrada: reentrega do evento nao duplica indice
    // nem move a corrente.
    if (sealed.exists) return { sealed: false, reason: "ALREADY_SEALED", index: sealed.data().index };

    const previous = chain.exists ? { index: chain.data().index, sealHash: chain.data().sealHash } : null;
    const seal = nextSeal({ logId, entry, writtenAt, previous });
    const sealedAt = new Date().toISOString();

    transaction.create(sealRef, toStored("auditSeals", { ...seal, id: logId, organizationId, createdAt: sealedAt }));
    // A cabeca e derivada: ela existe para dar o proximo indice numa leitura
    // so, e e reescrita na mesma transacao do selo.
    transaction.set(
      chainRef,
      toStored("auditSealChains", {
        id: CHAIN_DOCUMENT_ID,
        organizationId,
        index: seal.index,
        sealHash: seal.sealHash,
        logId,
        updatedAt: sealedAt,
      }),
    );
    return { sealed: true, index: seal.index, sealHash: seal.sealHash };
  });
}

/** O corpo do gatilho, separado para o teste poder reentregar o mesmo evento. */
export async function handleAuditLogCreated(event) {
  const snapshot = event.data;
  if (!snapshot?.exists) return { sealed: false, reason: "NO_DOCUMENT" };
  const { organizationId, logId } = event.params;
  const result = await sealAuditEntry({
    organizationId,
    logId,
    entry: fromStored("auditLogs", logId, snapshot.data()),
    writtenAt: snapshot.createTime.toDate().toISOString(),
  });
  logger.info("audit.seal", { organizationId, logId, ...result });
  return result;
}

export const sealAuditLog = onDocumentCreated(
  {
    document: paths.document("{organizationId}", "auditLogs", "{logId}"),
    region: REGION,
    ...runAs("automacao"),
    // Repetir e inofensivo (o selo e idempotente pelo id da entrada) e e o que
    // garante que uma falha passageira da transacao nao deixe entrada sem selo.
    retry: true,
    maxInstances: 10,
  },
  handleAuditLogCreated,
);
