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

// --- Remarcação de ponta a ponta. Organização, remetente e telefone próprios.
export const RESCHEDULE_SENDER = "9999900000002";
export const RESCHEDULE_PHONE = "+5500900000003";

export async function seedReschedule(db, org, now) {
  // Um dia útil a pelo menos três dias daqui, às 10:00 em Brasília: fora da
  // antecedência mínima e com horários livres antes dele.
  const start = new Date(Date.parse(now) + 3 * 86_400_000);
  while ([0, 6].includes(start.getUTCDay())) start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(13, 0, 0, 0);
  const startsAt = start.toISOString();
  const endsAt = new Date(start.getTime() + 50 * 60_000).toISOString();

  await db.doc(paths.organization(org)).set({
    id: org,
    name: "Consultório do Sandbox",
    primaryProfession: "PSYCHOLOGIST",
    ownerId: "sandbox",
    timezone: "America/Sao_Paulo",
    settings: {
      agenda: {
        reschedule: {
          enabled: true,
          minimumNoticeHours: 24,
          maxReschedulesPerAppointment: 1,
          offeredSlots: 3,
          allowProfessionalChange: false,
          searchWindowDays: 14,
        },
      },
      notifications: {
        enabled: true,
        verifiedSenderChannels: ["WHATSAPP"],
        rules: ["RESCHEDULE_OFFERED", "RESCHEDULE_CONFIRMED", "RESCHEDULE_HANDED_OFF"].map((event) => ({
          id: `${event}:WHATSAPP`,
          event,
          channel: "WHATSAPP",
          enabled: true,
          leadMinutes: 0,
          customTemplate: null,
        })),
      },
    },
  });
  await db.doc(paths.document(org, "messagingSenders", "WHATSAPP")).set({
    organizationId: org,
    channel: "WHATSAPP",
    providerId: "N8N_BRIDGE",
    providerSenderId: RESCHEDULE_SENDER,
    status: "APPROVED",
    mode: "TEST",
    testRecipients: [RESCHEDULE_PHONE],
  });
  await db.doc(paths.document(org, "clients", "client")).set({
    organizationId: org,
    fullName: "Contato fictício da remarcação",
    phone: RESCHEDULE_PHONE,
    appointmentNotificationsEnabled: true,
    notificationConsent: {
      formatVersion: 2,
      channels: {
        WHATSAPP: [
          {
            granted: { at: now, recordedBy: { kind: "STAFF", userId: "sandbox" }, medium: "FORM" },
            textVersion: "sandbox",
            subjectIsMinor: false,
            legalGuardian: null,
            withdrawn: null,
          },
        ],
      },
      legacy: null,
    },
  });
  await db.doc(paths.document(org, "appointments", "appointment")).set(
    toStored("appointments", {
      id: "appointment",
      organizationId: org,
      clientId: "client",
      clientName: "Contato fictício da remarcação",
      professionalId: "professional",
      professionalName: "Profissional fictício",
      startsAt,
      endsAt,
      durationMinutes: 50,
      modality: "IN_PERSON",
      status: "SCHEDULED",
      priceInCents: 20000,
      origin: "MANUAL",
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      rescheduledFromId: null,
      externalCalendar: null,
      createdAt: now,
      createdBy: "sandbox",
      updatedAt: now,
      updatedBy: "sandbox",
    }),
  );
  return { phone: RESCHEDULE_PHONE, sender: RESCHEDULE_SENDER };
}

function rescheduleEvent(message, { phone, sender }) {
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
              metadata: { phone_number_id: sender },
              messages: [
                { from: phone.replace(/^\+/, ""), timestamp: String(Math.floor(Date.now() / 1000)), ...message },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** O botão "Remarcar" do lembrete, como a Meta o entrega. */
export function rescheduleButton(id, target) {
  return rescheduleEvent(
    { id, type: "button", button: { payload: "Remarcar", text: "Remarcar" }, context: { id: "wamid.lembrete" } },
    target,
  );
}

export function rescheduleText(id, text, target) {
  return rescheduleEvent({ id, type: "text", text: { body: text } }, target);
}
