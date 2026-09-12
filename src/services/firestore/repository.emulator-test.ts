import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  Timestamp,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  terminate,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/permissions";
import { messagePath, paths } from "@/lib/firebase/paths";
import type { WorkspaceSnapshot } from "@/services/types";

import { FirestoreWorkspaceRepository } from "./firestore-repository";

/**
 * Integracao real contra o emulador.
 *
 * Os planos de escrita ja sao verificados sem emulador, e as Security Rules
 * tem a propria suite. O que sobra — e o que quebra em silencio — e a fiacao:
 * conversao Timestamp <-> ISO, lote atomico, transacao e listeners. E isso que
 * este arquivo exercita, com regras abertas (ver `scripts/emulator-open.rules`).
 *
 * Rodar com: npm run test:repository
 */

const ORG = "org-integracao";
const PROFESSIONAL = "prof-1";
const CLIENT = "client-1";
const CONVERSATION = "conv-1";

let app: FirebaseApp;
let db: Firestore;
let repository: FirestoreWorkspaceRepository;

/** Espera a proxima fotografia que satisfaca a condicao. */
function nextSnapshot(
  predicate: (snapshot: WorkspaceSnapshot) => boolean,
  target: FirestoreWorkspaceRepository = repository,
): Promise<WorkspaceSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("A fotografia esperada nao chegou."));
    }, 10_000);

    const unsubscribe = target.subscribe((snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      // O unsubscribe ainda nao existe quando o repositorio emite de imediato.
      queueMicrotask(() => unsubscribe());
      resolve(snapshot);
    });
  });
}

beforeAll(async () => {
  app = initializeApp({ projectId: "demo-atendara" }, "emulator-tests");
  db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8086);

  const stamp = {
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: null,
    updatedBy: null,
  };

  // Semente minima: o que `registerProfessional` cria no cadastro real.
  await setDoc(doc(db, paths.organization(ORG)), {
    id: ORG,
    name: "Consultorio de Integracao",
    primaryProfession: "PSYCHOLOGIST",
    ownerId: "user-1",
    ...stamp,
  });
  await setDoc(doc(db, paths.document(ORG, "professionals", PROFESSIONAL)), {
    id: PROFESSIONAL,
    organizationId: ORG,
    userId: "user-1",
    displayName: "Profissional Um",
    email: "profissional@exemplo.test",
    phone: null,
    profession: "PSYCHOLOGIST",
    licenseNumber: null,
    specialties: [],
    avatarUrl: null,
    active: true,
    ...stamp,
  });
  await setDoc(doc(db, paths.document(ORG, "conversations", CONVERSATION)), {
    id: CONVERSATION,
    organizationId: ORG,
    clientId: CLIENT,
    clientName: "Cliente Um",
    professionalId: PROFESSIONAL,
    channel: "WHATSAPP",
    status: "OPEN",
    attention: "NORMAL",
    lastClassification: null,
    lastMessagePreview: "",
    lastMessageAt: Timestamp.now(),
    unreadCount: 0,
    escalated: false,
    escalationReason: null,
    ...stamp,
  });

  repository = new FirestoreWorkspaceRepository(db, ORG, "PSYCHOLOGIST");
  repository.setActor({
    userId: "user-1",
    name: "Profissional Um",
    role: "PROFESSIONAL",
    permissions: permissionsForRole("PROFESSIONAL"),
  });

  await nextSnapshot((snapshot) => snapshot.professionals.length === 1);
});

afterAll(async () => {
  repository.dispose();
  await terminate(db);
  await deleteApp(app);
});

describe("repositorio do Firestore contra o emulador", () => {
  it("carrega a organizacao completando os padroes do produto", () => {
    const snapshot = repository.getSnapshot()!;

    expect(snapshot.organization.name).toBe("Consultorio de Integracao");
    expect(snapshot.organization.currency).toBe("BRL");
    expect(snapshot.organization.settings.agenda.allowDoubleBooking).toBe(false);
    expect(snapshot.rules.some((rule) => rule.level === "SECURITY")).toBe(true);
  });

  it("cria cadastro publicando alerta e auditoria no mesmo lote", async () => {
    const id = await repository.createClient({
      fullName: "Cliente Um",
      preferredName: null,
      email: null,
      phone: null,
      status: "ACTIVE",
      preferredModality: "ONLINE",
      assignedProfessionalId: PROFESSIONAL,
      acquisitionChannel: "OTHER",
      tags: [],
      administrativeNotes: null,
    });

    const snapshot = await nextSnapshot((current) =>
      current.clients.some((client) => client.id === id),
    );

    expect(snapshot.notifications[0]?.type).toBe("NEW_CLIENT");
    expect(snapshot.auditLogs[0]?.action).toBe("CREATE");
    // A trilha carrega instante, e nao um `Timestamp` vazando para a interface.
    expect(typeof snapshot.auditLogs[0]?.occurredAt).toBe("string");
  });

  it("grava data como Timestamp e devolve ISO, com dinheiro inteiro", async () => {
    const client = repository.getSnapshot()!.clients[0];
    const startsAt = "2027-03-01T13:00:00.000Z";

    const id = await repository.createAppointment({
      clientId: client.id,
      professionalId: PROFESSIONAL,
      startsAt,
      durationMinutes: 50,
      modality: "ONLINE",
      status: "SCHEDULED",
      priceInCents: 18000,
      administrativeNotes: null,
    });

    const raw = await getDoc(doc(db, paths.document(ORG, "appointments", id)));
    expect(raw.get("startsAt")).toBeInstanceOf(Timestamp);
    expect(raw.get("priceInCents")).toBe(18000);

    const snapshot = await nextSnapshot((current) =>
      current.appointments.some((appointment) => appointment.id === id),
    );
    const appointment = snapshot.appointments.find((item) => item.id === id)!;
    expect(appointment.startsAt).toBe(startsAt);
    expect(appointment.endsAt).toBe("2027-03-01T13:50:00.000Z");

    // O atendimento cobrado gerou a receita, e o saldo do cadastro foi
    // recalculado na leitura — sem ninguem reescrever o documento do cliente.
    const revenue = snapshot.transactions.find(
      (transaction) => transaction.appointmentId === id,
    )!;
    expect(revenue.amountInCents).toBe(18000);
    expect(
      snapshot.clients.find((item) => item.id === client.id)!
        .outstandingBalanceInCents,
    ).toBe(18000);
  });

  it("cancelar em transacao baixa a receita ligada ao atendimento", async () => {
    const appointment = repository.getSnapshot()!.appointments[0];

    await repository.setAppointmentStatus(
      appointment.id,
      "CANCELLED",
      "Paciente avisou.",
    );

    const snapshot = await nextSnapshot((current) =>
      current.transactions.every(
        (transaction) =>
          transaction.appointmentId !== appointment.id ||
          transaction.status === "CANCELLED",
      ),
    );

    expect(
      snapshot.appointments.find((item) => item.id === appointment.id)?.status,
    ).toBe("CANCELLED");
    expect(
      snapshot.clients[0].outstandingBalanceInCents,
    ).toBe(0);
  });

  it("mensagem gravada na subcolecao volta pela consulta de grupo", async () => {
    const id = await repository.appendMessage({
      conversationId: CONVERSATION,
      clientId: CLIENT,
      direction: "OUTBOUND",
      authorType: "PROFESSIONAL",
      authorName: "Profissional Um",
      channel: "WHATSAPP",
      body: "Bom dia! Confirmado para quinta.",
      classification: null,
      classificationConfidence: null,
      aiDecisionId: null,
    });

    const raw = await getDoc(doc(db, messagePath(ORG, CONVERSATION, id)));
    expect(raw.exists()).toBe(true);
    expect(raw.get("sentAt")).toBeInstanceOf(Timestamp);

    const snapshot = await nextSnapshot((current) =>
      current.messages.some((message) => message.id === id),
    );
    expect(
      snapshot.conversations.find((item) => item.id === CONVERSATION)
        ?.lastMessagePreview,
    ).toBe("Bom dia! Confirmado para quinta.");
  });

  it("regra fundamental nao pode ser desativada nem existe como documento", async () => {
    const immutable = repository
      .getSnapshot()!
      .rules.find((rule) => rule.immutable)!;

    await expect(
      repository.setRuleEnabled(immutable.id, false),
    ).rejects.toThrow(/fundamentais/);

    const raw = await getDoc(
      doc(db, paths.document(ORG, "aiRules", immutable.id)),
    );
    expect(raw.exists()).toBe(false);
  });

  it("recusa mensagem de cliente que nao pertence a conversa", async () => {
    await expect(
      repository.appendMessage({
        conversationId: CONVERSATION,
        clientId: "outro-cliente",
        direction: "OUTBOUND",
        authorType: "PROFESSIONAL",
        authorName: "Profissional Um",
        channel: "WHATSAPP",
        body: "Mensagem trocada de conversa.",
        classification: null,
        classificationConfidence: null,
        aiDecisionId: null,
      }),
    ).rejects.toThrow(/não pertence à conversa/);
  });

  it("restaurar dados nao existe fora da demonstracao", async () => {
    await expect(repository.reset()).rejects.toThrow(/demonstração/);
  });

  it("le o vinculo de quem usa o painel e pagina a colecao ate o fim", async () => {
    await setDoc(doc(db, paths.document(ORG, "members", "user-1")), {
      id: "user-1",
      organizationId: ORG,
      userId: "user-1",
      role: "ADMIN",
      status: "ACTIVE",
      invitedBy: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: null,
      updatedBy: null,
    });
    for (const name of ["Ana", "Bruno", "Carla", "Diego"]) {
      await repository.createClient({
        fullName: `${name} Paginacao`,
        preferredName: null,
        email: null,
        phone: null,
        status: "ACTIVE",
        preferredModality: "ONLINE",
        assignedProfessionalId: PROFESSIONAL,
        acquisitionChannel: "OTHER",
        tags: [],
        administrativeNotes: null,
      });
    }

    const paged = new FirestoreWorkspaceRepository(db, ORG, "PSYCHOLOGIST", {
      userId: "user-1",
      pageSizes: { clients: 2 },
    });
    try {
      // "Cliente Um", do teste de cadastro, mais os quatro acima.
      const first = await nextSnapshot(
        (snapshot) => snapshot.membership?.role === "ADMIN" && snapshot.clients.length === 2,
        paged,
      );
      expect(first.clients.map((item) => item.fullName)).toEqual(["Ana Paginacao", "Bruno Paginacao"]);
      expect(first.pagination?.clients).toEqual({ hasMore: true, loading: false });

      await paged.loadMore("clients");
      expect(paged.getSnapshot()!.clients).toHaveLength(4);
      expect(paged.getSnapshot()!.pagination?.clients?.hasMore).toBe(true);

      await paged.loadMore("clients");
      const last = paged.getSnapshot()!;
      expect(last.clients).toHaveLength(5);
      expect(last.pagination?.clients).toBeUndefined();
      // Sem proxima pagina, pedir mais nao faz nada.
      await paged.loadMore("clients");
      expect(paged.getSnapshot()!.clients).toHaveLength(5);
      expect(paged.getLoadState()).toEqual({ status: "ready", failed: [] });
    } finally {
      paged.dispose();
    }
  });

  it("diz que a organizacao nao existe em vez de carregar para sempre", async () => {
    const missing = new FirestoreWorkspaceRepository(db, "org-inexistente", "PSYCHOLOGIST");
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("O estado nao mudou.")), 10_000);
        const check = () => {
          if (missing.getLoadState().status !== "unavailable") return;
          clearTimeout(timer);
          resolve();
        };
        missing.subscribeLoadState(check);
        check();
      });
      expect(missing.getLoadState()).toEqual({
        status: "unavailable",
        reason: "organization-missing",
      });
      expect(missing.getSnapshot()).toBeNull();
    } finally {
      missing.dispose();
    }
  });
});
