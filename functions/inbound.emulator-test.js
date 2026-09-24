import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyInboundEvent } from "./inbound.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { messagePath, paths } from "./generated/paths.js";

const ORG = `inbound-emulator-${Date.now()}`;
const OTHER = `${ORG}-other`;
const PHONE = "+5500900000001";
const SENDER = `sender-${ORG}`;
const NOW = "2026-09-23T12:00:00.000Z";
let app;
let db;
const ref = (collection, id, org = ORG) =>
  db.doc(paths.document(org, collection, id));
const event = (id, text, extra = {}) => ({
  kind: "TEXT",
  providerSenderId: SENDER,
  from: PHONE,
  providerMessageId: id,
  text,
  sentAt: NOW,
  ...extra,
});
const apply = (value) => applyInboundEvent(value, { clock: () => NOW });

beforeAll(async () => {
  // Este teste nunca pode usar credenciais para alcançar um banco real.
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Use o emulador do Firestore.");
  app = initializeApp({ projectId: "demo-atendara" });
  db = getFirestore(app);
  const record = {
    granted: {
      at: NOW,
      recordedBy: { kind: "STAFF", userId: "owner" },
      medium: "FORM",
    },
    textVersion: "test",
    subjectIsMinor: false,
    legalGuardian: null,
    withdrawn: null,
  };
  await db
    .doc(paths.organization(ORG))
    .set({ id: ORG, primaryProfession: "PSYCHOLOGIST", ownerId: "owner" });
  await ref("messagingSenders", "WHATSAPP").set({
    organizationId: ORG,
    channel: "WHATSAPP",
    providerId: "N8N_BRIDGE",
    providerSenderId: SENDER,
    status: "APPROVED",
    mode: "TEST",
    testRecipients: [PHONE],
  });
  for (const org of [ORG, OTHER])
    await ref("clients", "client", org).set({
      organizationId: org,
      fullName: "Contato fictício",
      phone: PHONE,
      administrativeNotes: "Preservar cadastro",
      notificationConsent: {
        formatVersion: 2,
        channels: { WHATSAPP: [record], EMAIL: [] },
        legacy: null,
      },
    });
});

afterAll(async () => {
  if (db)
    for (const org of [ORG, OTHER])
      await db.recursiveDelete(db.doc(paths.organization(org)));
  if (app) await deleteApp(app);
});

describe("entrada do WhatsApp no Firestore", () => {
  it("duas entregas concorrentes criam uma única mensagem, decisão e alerta", async () => {
    const results = await Promise.all([
      apply(event("wamid.concurrent", "não consigo mais, penso em me matar")),
      apply(event("wamid.concurrent", "não consigo mais, penso em me matar")),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual([
      "CLASSIFIED",
      "DUPLICATE",
    ]);
    const message = await db
      .doc(messagePath(ORG, "wa-client", "wa-wamid.concurrent"))
      .get();
    expect(message.data()).toMatchObject({
      classification: "POSSIBLE_RISK",
      aiDecisionId: "wa-wamid.concurrent-decision",
      readAt: null,
    });
    const decisions = await db
      .collection(paths.collection(ORG, "aiDecisions"))
      .get();
    expect(decisions.size).toBe(1);
    expect(decisions.docs[0].data()).toMatchObject({
      inputPreview: "",
      responseText: null,
    });
    const alert = (
      await ref("notifications", "wa-wamid.concurrent-alerta").get()
    ).data();
    expect(alert).toMatchObject({
      type: "POSSIBLE_RISK_DETECTED",
      priority: "CRITICAL",
      channels: ["DASHBOARD"],
    });
    expect(
      (await ref("conversations", "wa-client").get()).data().unreadCount,
    ).toBe(1);
    expect(
      (await db.collection(paths.collection(OTHER, "conversations")).get())
        .empty,
    ).toBe(true);
  });

  it("SAIR revoga só no tenant destinatário e mantém os demais dados", async () => {
    expect(await apply(event("wamid.optout", "SAIR"))).toMatchObject({
      outcome: "OPT_OUT",
    });
    const client = (await ref("clients", "client").get()).data();
    expect(client.administrativeNotes).toBe("Preservar cadastro");
    expect(client.notificationConsent.channels.EMAIL).toEqual([]);
    expect(
      client.notificationConsent.channels.WHATSAPP[0].withdrawn,
    ).toMatchObject({
      recordedBy: { kind: "SUBJECT", userId: null },
      medium: "MESSAGE",
    });
    const other = (await ref("clients", "client", OTHER).get()).data();
    expect(other.notificationConsent.channels.WHATSAPP[0].withdrawn).toBeNull();
    const audit = await ref("auditLogs", "wa-wamid.optout-consent").get();
    expect(fromStored("auditLogs", audit.id, audit.data()).occurredAt).toBe(
      NOW,
    );
  });

  it("botão de remarcação persiste sem leitura após escrita e alerta a equipe", async () => {
    await ref("appointments", "appointment").set(
      toStored("appointments", {
        organizationId: ORG,
        clientId: "client",
        professionalId: "professional",
        startsAt: "2026-09-25T12:00:00.000Z",
        endsAt: "2026-09-25T13:00:00.000Z",
        status: "SCHEDULED",
      }),
    );
    expect(
      await apply(
        event("wamid.reschedule", undefined, {
          kind: "BUTTON",
          button: "RESCHEDULE",
          repliedTo: null,
        }),
      ),
    ).toMatchObject({
      outcome: "RESCHEDULE_ESCALATED",
      reason: "POLICY_DISABLED",
    });
    expect(
      (
        await ref("notifications", "wa-wamid.reschedule-remarcacao").get()
      ).data(),
    ).toMatchObject({
      type: "CLIENT_WAITING",
      priority: "HIGH",
      target: { type: "conversation", id: "wa-client" },
    });
  });
});
