import { paths } from "../functions/generated/paths.js";
import { toStored } from "../functions/firestore-dates.js";

export const PHONE = "+5500900000001";
export const SENDER = "9999900000001";

export async function seedInbound(db, org, other, now) {
  const consent = {
    granted: {
      at: now,
      recordedBy: { kind: "STAFF", userId: "sandbox" },
      medium: "FORM",
    },
    textVersion: "sandbox",
    subjectIsMinor: false,
    legalGuardian: null,
    withdrawn: null,
  };
  for (const id of [org, other]) {
    await db
      .doc(paths.organization(id))
      .set({ id, primaryProfession: "PSYCHOLOGIST", ownerId: "sandbox" });
    await db.doc(paths.document(id, "clients", "client")).set({
      organizationId: id,
      fullName: "Contato fictício do sandbox",
      phone: PHONE,
      administrativeNotes: "Preservar cadastro",
      notificationConsent: {
        formatVersion: 2,
        channels: { WHATSAPP: [consent], EMAIL: [] },
        legacy: null,
      },
    });
  }
  await db.doc(paths.document(org, "messagingSenders", "WHATSAPP")).set({
    organizationId: org,
    channel: "WHATSAPP",
    providerId: "N8N_BRIDGE",
    providerSenderId: SENDER,
    status: "APPROVED",
    mode: "TEST",
    testRecipients: [PHONE],
  });
}

export function metaEvent(id, text, from = PHONE) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "sandbox-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: SENDER },
              messages: [
                {
                  id,
                  from: from.replace(/^\+/, ""),
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export async function seedTask(db, org, id) {
  const now = Date.now();
  const iso = (offset) => new Date(now + offset).toISOString();
  const deliveryId = `${id}-delivery`;
  const base = {
    organizationId: org,
    createdAt: iso(-120000),
    createdBy: null,
    updatedAt: iso(0),
    updatedBy: null,
  };
  await db.doc(paths.document(org, "automationTasks", id)).set(
    toStored("automationTasks", {
      ...base,
      id,
      type: "SEND_REMINDER",
      status: "DISPATCHED",
      attempt: 1,
      maxAttempts: 3,
      scheduledFor: iso(-60000),
      expiresAt: iso(3600000),
      idempotencyKey: id,
      appointmentId: "appointment",
      appointmentStartsAt: iso(7200000),
      clientId: "client",
      professionalId: "professional",
      deliveryId,
      sourceTaskId: null,
      event: "APPOINTMENT_REMINDER",
      channel: "WHATSAPP",
      failureCode: null,
      stopReason: null,
      providerMessageId: null,
      dispatchingSince: null,
      completedAt: null,
      history: [
        {
          from: "DISPATCHING",
          to: "DISPATCHED",
          at: iso(-1000),
          attempt: 1,
          code: null,
        },
      ],
    }),
  );
  await db.doc(paths.document(org, "notificationDeliveries", deliveryId)).set(
    toStored("notificationDeliveries", {
      ...base,
      id: deliveryId,
      audience: "ORGANIZATION_TO_CLIENT",
      event: "APPOINTMENT_REMINDER",
      channel: "WHATSAPP",
      ruleId: "sandbox",
      appointmentId: "appointment",
      clientId: "client",
      professionalId: "professional",
      scheduledFor: iso(-60000),
      status: "SENDING",
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      providerId: "N8N_BRIDGE",
      providerMessageId: null,
      failureCode: null,
      templateId: "sandbox",
      bodyHash: "sandbox",
      bodyLength: 25,
      contactHint: "0001",
      sentAt: null,
      cancelledAt: null,
    }),
  );
  return {
    version: 1,
    taskId: id,
    organizationId: org,
    attempt: 1,
    idempotencyKey: id,
    expiresAt: iso(3600000),
    channel: "WHATSAPP",
    providerSenderId: SENDER,
    deliveryId,
    destination: PHONE,
    body: "Mensagem fictícia de teste",
    template: {
      name: "sandbox_reminder",
      language: "pt_BR",
      parameters: ["Contato fictício"],
      buttons: [],
    },
  };
}
