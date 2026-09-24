import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { toStored } from "./firestore-dates.js";
import { permissionsForMembership } from "./generated/permissions.js";
import { paths } from "./generated/paths.js";
import {
  exchangeEmbeddedSignupCode,
  fetchWhatsappBusinessAccount,
  fetchWhatsappPhoneNumbers,
  subscribeWhatsappBusinessAccount,
} from "./meta-graph.js";
import { ACCOUNT_CALL_OPTIONS, accountOf, parse } from "./platform-auth.js";
import { consumeRateLimit } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";

const CALL_OPTIONS = {
  ...ACCOUNT_CALL_OPTIONS,
  secrets: ["META_APP_SECRET"],
  ...runAs("automacao"),
};

const db = () => getFirestore();
const CONNECTION_ID = "WHATSAPP";

const schema = z
  .object({
    code: z.string().trim().min(1).max(4096),
    businessId: z.string().trim().min(1).max(128).nullable().optional().default(null),
    wabaId: z.string().trim().min(1).max(128),
    phoneNumberId: z.string().trim().min(1).max(128),
  })
  .strict();

function auditEntry({ organizationId, actorId, now }) {
  const id = randomUUID();
  return {
    id,
    organizationId,
    actorType: "USER",
    actorId,
    actorName: "Usuário autenticado",
    action: "UPDATE",
    resource: { type: "whatsappConnection", id: CONNECTION_ID },
    summary: "Conexão do WhatsApp Business validada pela Meta; o envio ainda aguarda ativação do remetente.",
    metadata: { channel: "WHATSAPP", provider: "META_CLOUD_API", status: "VALIDATED" },
    occurredAt: now,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  };
}

/** O telefone precisa ser o mesmo que veio no evento do Embedded Signup. */
export function selectWhatsappPhone(phones, phoneNumberId) {
  if (!Array.isArray(phones)) return null;
  return (
    phones.find(
      (phone) =>
        phone &&
        String(phone.id) === phoneNumberId &&
        typeof phone.display_phone_number === "string" &&
        phone.display_phone_number.trim() &&
        typeof phone.verified_name === "string" &&
        phone.verified_name.trim(),
    ) ?? null
  );
}

/** Documento persistido: nenhum token ou payload bruto da Meta entra aqui. */
export function connectionDocument({ organizationId, input, phone, actorId, now, createdAt }) {
  return {
    id: CONNECTION_ID,
    organizationId,
    channel: "WHATSAPP",
    provider: "META_CLOUD_API",
    businessId: input.businessId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayNumber: phone.display_phone_number.trim(),
    displayName: phone.verified_name.trim(),
    status: "VALIDATED",
    webhookSubscribed: true,
    validatedAt: now,
    lastError: null,
    createdAt: createdAt ?? now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  };
}

async function membershipOf(request) {
  const account = await accountOf(request);
  const organizationId = account.organizationId;
  if (!organizationId) throw new HttpsError("failed-precondition", "Cadastro sem organização.");

  const firestore = db();
  const [organizationSnapshot, memberSnapshot] = await Promise.all([
    firestore.doc(paths.organization(organizationId)).get(),
    firestore.doc(paths.document(organizationId, "members", request.auth.uid)).get(),
  ]);
  const organization = organizationSnapshot.data();
  const member = memberSnapshot.data();
  if (!organization || !member || member.status !== "ACTIVE") {
    throw new HttpsError("permission-denied", "Vínculo não está ativo.");
  }

  const permissions = permissionsForMembership(member.role, organization.ownerId === request.auth.uid);
  if (!permissions?.includes("notificationSettings:update")) {
    throw new HttpsError("permission-denied", "Seu papel não permite conectar o WhatsApp.");
  }
  return { organizationId };
}

export const completeWhatsappEmbeddedSignup = onCall(CALL_OPTIONS, async (request) => {
  const { organizationId } = await membershipOf(request);
  await consumeRateLimit(request.auth.uid, "whatsappSignup");
  const input = parse(schema, request.data);

  const appId = process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new HttpsError("failed-precondition", "A conexão com a Meta ainda não está configurada no servidor.");
  }

  const graphVersion = process.env.META_GRAPH_VERSION ?? "v25.0";
  let phone;
  try {
    const exchanged = await exchangeEmbeddedSignupCode({
      code: input.code,
      appId,
      appSecret,
      graphVersion,
    });
    const businessAccount = await fetchWhatsappBusinessAccount({
      wabaId: input.wabaId,
      accessToken: exchanged.accessToken,
      graphVersion,
    });
    if (String(businessAccount?.id) !== input.wabaId) throw new Error("WABA divergente");

    const phones = await fetchWhatsappPhoneNumbers({
      wabaId: input.wabaId,
      accessToken: exchanged.accessToken,
      graphVersion,
    });
    phone = selectWhatsappPhone(phones, input.phoneNumberId);
    if (!phone) throw new Error("Número não encontrado");

    await subscribeWhatsappBusinessAccount({
      wabaId: input.wabaId,
      accessToken: exchanged.accessToken,
      graphVersion,
    });
  } catch (error) {
    logger.warn("whatsapp.signup.validation_failed", {
      organizationId,
      stage: error?.message === "WABA divergente" ? "waba" : "graph",
    });
    throw new HttpsError("failed-precondition", "A Meta não confirmou a conta ou o número informado.");
  }

  const now = new Date().toISOString();
  const firestore = db();
  await firestore.runTransaction(async (transaction) => {
    const connectionRef = firestore.doc(paths.document(organizationId, "whatsappConnections", CONNECTION_ID));
    const existing = (await transaction.get(connectionRef)).data() ?? null;
    const audit = auditEntry({ organizationId, actorId: request.auth.uid, now });
    transaction.set(
      connectionRef,
      toStored(
        "whatsappConnections",
        connectionDocument({ organizationId, input, phone, actorId: request.auth.uid, now, createdAt: existing?.createdAt }),
      ),
    );
    transaction.create(firestore.doc(paths.document(organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
  });

  return {
    status: "VALIDATED",
    displayNumber: phone.display_phone_number.trim(),
    displayName: phone.verified_name.trim(),
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
  };
});
