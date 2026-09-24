import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { toStored } from "./firestore-dates.js";
import { CHANNEL_META } from "./generated/notifications-config.js";
import { MESSAGING_SENDER_MODES, MESSAGING_SENDER_STATUSES } from "./generated/types-notifications.js";
import { paths } from "./generated/paths.js";
import { ACCOUNT_CALL_OPTIONS, adminOf, parse } from "./platform-auth.js";
import { auditEntry } from "./platform.js";
import { consumeRateLimit } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";

/**
 * Cadastro do remetente de cada canal real (Fase 3, 13.4).
 *
 * **Por que isto nao e configuracao da organizacao.** A organizacao ja diz, em
 * `settings.notifications.verifiedSenderChannels`, que comprovou habilitacao
 * num canal. Isso basta enquanto nada sai do processo. Com canal real, falar
 * pelo numero de uma clinica e falar em nome dela: quem carimba isso e a
 * operadora, depois de ver o numero aprovado no painel da Meta — com segundo
 * fator e com registro na trilha, na mesma transacao.
 *
 * **O que NAO entra aqui:** token, chave ou qualquer credencial. Elas vivem no
 * Secret Manager. Este documento guarda identificador, nome de exibicao e o que
 * o provedor respondeu sobre o remetente.
 */

const OPERADORA_CALL_OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("operadora") };

const db = () => getFirestore();

// Numero internacional, como a Meta o devolve: so digitos, com o pais na
// frente. Testador e numero da propria equipe, nunca de quem e atendido.
const phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use o formato internacional, como +5513999990000.");

const schema = z
  .object({
    organizationId: z.string().min(1).max(128),
    channel: z.enum(Object.keys(CHANNEL_META)),
    providerSenderId: z.string().trim().min(1).max(128),
    displayNumber: phone,
    displayName: z.string().trim().min(2).max(120),
    status: z.enum(MESSAGING_SENDER_STATUSES),
    mode: z.enum(MESSAGING_SENDER_MODES),
    testRecipients: z.array(phone).max(5).default([]),
    reason: z.string().trim().min(10).max(500),
  })
  .strict()
  .refine((value) => value.mode === "TEST" || value.testRecipients.length === 0, {
    message: "Lista de testadores só existe no modo de teste.",
    path: ["testRecipients"],
  });

export function whatsappConnectionMatchesSender(connection, input) {
  if (connection?.status !== "VALIDATED" || connection.phoneNumberId !== input.providerSenderId) return false;
  const connectedNumber = String(connection.displayNumber ?? "").replace(/\D/g, "");
  return connectedNumber.length > 0 && connectedNumber === input.displayNumber.replace(/\D/g, "");
}

/**
 * Grava o remetente e a trilha juntos. Canal simulado e recusado de proposito:
 * cadastrar remetente para canal que nao sai do processo daria a impressao de
 * que algo passou a sair.
 */
export const registerMessagingSender = onCall(OPERADORA_CALL_OPTIONS, async (request) => {
  const admin = await adminOf(request);
  await consumeRateLimit(request.auth.uid, "messagingSenderRegistration");
  const input = parse(schema, request.data);

  const providerId = CHANNEL_META[input.channel].providerId;
  if (providerId === "SIMULATED") {
    throw new HttpsError("failed-precondition", "Este canal ainda usa o provedor simulado: não há remetente real a cadastrar.");
  }

  const firestore = db();
  const ref = firestore.doc(paths.document(input.organizationId, "messagingSenders", input.channel));
  const now = new Date().toISOString();

  await firestore.runTransaction(async (transaction) => {
    const organization = await transaction.get(firestore.doc(paths.organization(input.organizationId)));
    if (!organization.exists) throw new HttpsError("not-found", "Organização não encontrada.");

    if (input.channel === "WHATSAPP") {
      const connectionRef = firestore.doc(paths.document(input.organizationId, "whatsappConnections", "WHATSAPP"));
      const connection = (await transaction.get(connectionRef)).data();
      if (!whatsappConnectionMatchesSender(connection, input)) {
        throw new HttpsError("failed-precondition", "Conecte e valide este número da Meta antes de aprová-lo como remetente.");
      }
    }

    const existing = (await transaction.get(ref)).data() ?? null;
    const audit = auditEntry({
      action: "MESSAGING_SENDER_REGISTERED",
      actorId: admin.id ?? request.auth.uid,
      organizationId: input.organizationId,
      reason: input.reason,
      details: {
        channel: input.channel,
        providerId,
        providerSenderId: input.providerSenderId,
        status: input.status,
        mode: input.mode,
        testRecipientCount: input.testRecipients.length,
        previousStatus: existing?.status ?? null,
      },
      createdAt: now,
    });

    transaction.set(
      ref,
      toStored("messagingSenders", {
        id: input.channel,
        organizationId: input.organizationId,
        channel: input.channel,
        providerId,
        providerSenderId: input.providerSenderId,
        displayNumber: input.displayNumber,
        displayName: input.displayName,
        status: input.status,
        mode: input.mode,
        testRecipients: input.testRecipients,
        lastReason: input.reason,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? (admin.id ?? request.auth.uid),
        updatedAt: now,
        updatedBy: admin.id ?? request.auth.uid,
      }),
    );
    transaction.create(audit.ref, audit.data);
  });

  return { channel: input.channel, status: input.status, mode: input.mode };
});
