import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAutomationTask } from "./automation.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { paths } from "./generated/paths.js";
import { applyInboundEvent } from "./inbound.js";

/**
 * A resposta da assistente de ponta a ponta no backend, contra o Firestore
 * emulado: o pedido chega pelo webhook, a resposta é planejada na mesma
 * transação, e o despachante real a recompõe e entrega a um provedor fictício.
 * Nenhuma rede, nenhuma mensagem real.
 */

const ORG = `reply-emulator-${Date.now()}`;
const PHONE = "+5500900000002";
const SENDER = `sender-${ORG}`;
// Quarta-feira, 09:00 em Brasília.
const NOW = "2026-09-23T12:00:00.000Z";
const plus = (iso, seconds) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

let db;
const ref = (collection, id) => db.doc(paths.document(ORG, collection, id));
const read = async (collection, id) => {
  const snapshot = await ref(collection, id).get();
  return snapshot.exists ? fromStored(collection, snapshot.id, snapshot.data()) : null;
};

/** Provedor fictício: guarda o que recebeu e aceita na hora. */
function fakeProvider() {
  const sent = [];
  return {
    sent,
    providers: () => ({
      id: "FICTICIO",
      simulated: true,
      handoff: false,
      send: async (request) => {
        sent.push(request);
        return { outcome: "ACCEPTED", providerMessageId: `wamid.saida-${sent.length}`, failureCode: null };
      },
    }),
  };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Use o emulador do Firestore.");
  // O app padrão: é o que o backend enxerga ao chamar getFirestore().
  initializeApp({ projectId: "demo-atendara" });
  db = getFirestore();

  await db.doc(paths.organization(ORG)).set({
    id: ORG,
    name: "Consultório Fictício",
    primaryProfession: "PSYCHOLOGIST",
    ownerId: "owner",
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
  await ref("messagingSenders", "WHATSAPP").set({
    organizationId: ORG,
    channel: "WHATSAPP",
    providerId: "N8N_BRIDGE",
    providerSenderId: SENDER,
    status: "APPROVED",
    mode: "TEST",
    testRecipients: [PHONE],
  });
  await ref("clients", "client").set({
    organizationId: ORG,
    fullName: "Alex Fictício",
    phone: PHONE,
    appointmentNotificationsEnabled: true,
    notificationConsent: {
      formatVersion: 2,
      channels: {
        WHATSAPP: [
          {
            granted: { at: NOW, recordedBy: { kind: "STAFF", userId: "owner" }, medium: "FORM" },
            textVersion: "2026-09-24-rascunho",
            subjectIsMinor: false,
            legalGuardian: null,
            withdrawn: null,
          },
        ],
      },
      legacy: null,
    },
  });
  await ref("appointments", "appointment").set(
    toStored("appointments", {
      id: "appointment",
      organizationId: ORG,
      clientId: "client",
      clientName: "Alex Fictício",
      professionalId: "professional",
      professionalName: "Sam Fictício",
      // Segunda-feira seguinte, 10:00 em Brasília.
      startsAt: "2026-09-28T13:00:00.000Z",
      endsAt: "2026-09-28T13:50:00.000Z",
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
      createdAt: "2026-09-01T12:00:00.000Z",
      createdBy: "owner",
      updatedAt: "2026-09-01T12:00:00.000Z",
      updatedBy: "owner",
    }),
  );
});

afterAll(async () => {
  if (db) await db.recursiveDelete(db.doc(paths.organization(ORG)));
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("resposta da assistente no Firestore", () => {
  it("Remarcar → oferta entregue como texto → '1' → confirmação entregue, uma vez cada", async () => {
    const queue = [];
    const enqueue = async (payload, options) => queue.push({ payload, ...options });
    const provider = fakeProvider();
    const dispatch = (payload, at) =>
      runAutomationTask(payload, { clock: () => at, enqueue: async () => {}, providers: provider.providers });

    // 1. O pedido.
    const pedido = await applyInboundEvent(
      {
        kind: "BUTTON",
        providerSenderId: SENDER,
        from: PHONE.slice(1),
        providerMessageId: "wamid.pedido",
        button: "RESCHEDULE",
        repliedTo: "wamid.lembrete",
        sentAt: NOW,
      },
      { clock: () => NOW, enqueue },
    );
    expect(pedido).toMatchObject({ outcome: "RESCHEDULE_OFFERED", reply: "PLANNED" });
    expect(queue).toHaveLength(1);

    // 2. A oferta sai, e a reentrega do mesmo ponteiro não a repete.
    expect((await dispatch(queue[0].payload, plus(NOW, 5))).outcome).toBe("SUCCEEDED");
    expect((await dispatch(queue[0].payload, plus(NOW, 6))).outcome).toBe("TERMINAL");
    expect(provider.sent).toHaveLength(1);
    const oferta = provider.sent[0];
    expect(oferta).toMatchObject({ channel: "WHATSAPP", destination: PHONE, freeText: true });
    expect(oferta.template ?? null).toBeNull();
    expect(oferta.body).toContain("assistente virtual de Consultório Fictício");
    expect(oferta.body).toMatch(/^1\. /m);
    expect((await read("notificationDeliveries", "wa-wamid.pedido-resposta")).status).toBe("SENT");

    // 3. A escolha, e a confirmação.
    const escolha = await applyInboundEvent(
      {
        kind: "TEXT",
        providerSenderId: SENDER,
        from: PHONE.slice(1),
        providerMessageId: "wamid.escolha",
        text: "1",
        sentAt: plus(NOW, 60),
      },
      { clock: () => plus(NOW, 60), enqueue },
    );
    expect(escolha).toMatchObject({ outcome: "RESCHEDULE_CONFIRMED", reply: "PLANNED" });
    expect((await dispatch(queue[1].payload, plus(NOW, 65))).outcome).toBe("SUCCEEDED");

    expect(provider.sent).toHaveLength(2);
    const remarcado = await read("appointments", "appointment");
    expect(provider.sent[1].body).toMatch(/^Pronto! Seu atendimento ficou para /);
    expect(remarcado.origin).toBe("CLIENT_SELF_SERVICE");
    // Texto e destino não ficam gravados em lugar nenhum da fila.
    const tarefa = await read("automationTasks", "wa-wamid.escolha-resposta");
    expect(JSON.stringify(tarefa)).not.toContain(PHONE);
    expect(JSON.stringify(tarefa)).not.toContain("Pronto");
  });

  it("oferta respondida antes de sair não é enviada", async () => {
    const queue = [];
    const enqueue = async (payload, options) => queue.push({ payload, ...options });
    const provider = fakeProvider();
    await ref("appointments", "appointment").set(
      toStored("appointments", { startsAt: "2026-10-05T13:00:00.000Z", endsAt: "2026-10-05T13:50:00.000Z", selfServiceReschedules: 0, updatedAt: "2026-09-01T12:00:00.000Z" }),
      { merge: true },
    );

    await applyInboundEvent(
      {
        kind: "BUTTON",
        providerSenderId: SENDER,
        from: PHONE.slice(1),
        providerMessageId: "wamid.pedido-2",
        button: "RESCHEDULE",
        repliedTo: null,
        sentAt: plus(NOW, 120),
      },
      { clock: () => plus(NOW, 120), enqueue },
    );
    // A pessoa escolheu antes de a oferta sair (fila atrasada).
    await ref("rescheduleRequests", "wa-client").set({ status: "CONFIRMED" }, { merge: true });

    const resultado = await runAutomationTask(queue[0].payload, {
      clock: () => plus(NOW, 125),
      enqueue: async () => {},
      providers: provider.providers,
    });

    expect(resultado.outcome).toBe("CANCELLED");
    expect(provider.sent).toHaveLength(0);
    expect((await read("automationTasks", "wa-wamid.pedido-2-resposta")).stopReason).toBe("OFFER_CLOSED");
  });
});
