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
import { toFirestoreData } from "@/lib/firebase/converters";
import { plannedReminder } from "@/lib/automation/fixtures";
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
  it("fila paginada preserva datas, histórico e isolamento da organização", async () => {
    const { task } = plannedReminder();
    for (let index = 1; index <= 3; index += 1) {
      await setDoc(doc(db, paths.document(ORG, "automationTasks", `queue-${index}`)), toFirestoreData("automationTasks", {
        ...task, organizationId: ORG, createdAt: `2026-09-2${index}T12:00:00.000Z`,
      }));
    }
    await setDoc(doc(db, paths.document("other-queue-org", "automationTasks", "foreign")), toFirestoreData("automationTasks", {
      ...task, organizationId: "other-queue-org", createdAt: "2026-09-30T12:00:00.000Z",
    }));
    const paged = new FirestoreWorkspaceRepository(db, ORG, "PSYCHOLOGIST", { pageSizes: { automationTasks: 2 } });
    try {
      const first = await nextSnapshot((snapshot) => snapshot.automationTasks.length === 2, paged);
      expect(first.automationTasks.map((item) => item.id)).toEqual(["queue-3", "queue-2"]);
      expect(first.pagination?.automationTasks?.hasMore).toBe(true);
      expect(first.automationTasks[0].expiresAt).toBe(task.expiresAt);
      expect(first.automationTasks[0].history).toEqual(task.history);
      await paged.loadMore("automationTasks");
      const full = await nextSnapshot((snapshot) => snapshot.automationTasks.length === 3, paged);
      expect(full.automationTasks.every((item) => item.organizationId === ORG)).toBe(true);
      expect(full.pagination?.automationTasks?.hasMore ?? false).toBe(false);
    } finally {
      paged.dispose();
    }
  });
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

  it("servico do catalogo vai e volta, e o atendimento guarda o nome", async () => {
    const id = await repository.createService({
      name: "Limpeza de pele",
      description: null,
      durationMinutes: 60,
      priceInCents: 12000,
      enabled: true,
      returnIntervalDays: 30,
    });

    const raw = await getDoc(doc(db, paths.document(ORG, "services", id)));
    // Dinheiro inteiro (regra 7) e ordem propria, gravados como estao.
    expect(raw.get("priceInCents")).toBe(12000);
    expect(raw.get("position")).toBe(0);

    const client = repository.getSnapshot()!.clients[0];
    const appointmentId = await repository.createAppointment({
      clientId: client.id,
      professionalId: PROFESSIONAL,
      startsAt: "2027-04-05T13:00:00.000Z",
      durationMinutes: 60,
      serviceId: id,
      serviceName: "Limpeza de pele",
      modality: "IN_PERSON",
      status: "SCHEDULED",
      priceInCents: 12000,
      administrativeNotes: null,
    });

    // Renomear o servico depois nao reescreve o atendimento ja registrado.
    await repository.updateService(id, { name: "Limpeza de pele profunda" });

    const snapshot = await nextSnapshot((current) =>
      current.services.some((service) => service.name === "Limpeza de pele profunda"),
    );
    expect(
      snapshot.appointments.find((item) => item.id === appointmentId)?.serviceName,
    ).toBe("Limpeza de pele");

    // Ja usado: apagar deixaria o atendimento apontando para o nada.
    await expect(repository.deleteService(id)).rejects.toThrow(/Arquive/);
    await repository.archiveService(id);
    const arquivado = await nextSnapshot((current) =>
      current.services.every((service) => service.archivedAt !== null),
    );
    expect(arquivado.services.find((service) => service.id === id)?.enabled).toBe(false);
  });

  it("a profissao sem sinal recusa o valor: a flag decide, e ela vale no servidor", async () => {
    const client = repository.getSnapshot()!.clients[0];

    await expect(
      repository.createAppointment({
        clientId: client.id,
        professionalId: PROFESSIONAL,
        startsAt: "2027-05-10T13:00:00.000Z",
        durationMinutes: 50,
        modality: "ONLINE",
        status: "SCHEDULED",
        priceInCents: 20000,
        depositInCents: 5000,
        administrativeNotes: null,
      }),
    ).rejects.toThrow(/sinal antecipado/);
  });

  it("sinal antecipado grava dois lancamentos, e cancelar retem o que foi pago", async () => {
    // Organizacao propria, de Estetica: o sinal existe pela profissao dela.
    const ORG_ESTETICA = "org-estetica";
    const stamp = {
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: null,
      updatedBy: null,
    };
    await setDoc(doc(db, paths.organization(ORG_ESTETICA)), {
      id: ORG_ESTETICA,
      name: "Estudio de Integracao",
      primaryProfession: "AESTHETICS",
      ownerId: "user-2",
      ...stamp,
    });
    await setDoc(doc(db, paths.document(ORG_ESTETICA, "professionals", "prof-2")), {
      id: "prof-2",
      organizationId: ORG_ESTETICA,
      userId: "user-2",
      displayName: "Esteticista Dois",
      email: "esteticista@exemplo.test",
      phone: null,
      profession: "AESTHETICS",
      licenseNumber: null,
      specialties: [],
      avatarUrl: null,
      active: true,
      ...stamp,
    });

    const estudio = new FirestoreWorkspaceRepository(db, ORG_ESTETICA, "AESTHETICS");
    estudio.setActor({
      userId: "user-2",
      name: "Esteticista Dois",
      role: "PROFESSIONAL",
      permissions: permissionsForRole("PROFESSIONAL"),
    });

    try {
      await nextSnapshot((snapshot) => snapshot.professionals.length === 1, estudio);
      const clientId = await estudio.createClient({
        fullName: "Cliente do Estudio",
        preferredName: null,
        email: null,
        phone: null,
        status: "ACTIVE",
        preferredModality: "IN_PERSON",
        assignedProfessionalId: "prof-2",
        acquisitionChannel: "OTHER",
        tags: [],
        administrativeNotes: null,
      });
      await nextSnapshot((snapshot) => snapshot.clients.some((item) => item.id === clientId), estudio);

      const id = await estudio.createAppointment({
        clientId,
        professionalId: "prof-2",
        startsAt: "2027-05-10T13:00:00.000Z",
        durationMinutes: 60,
        modality: "IN_PERSON",
        status: "SCHEDULED",
        priceInCents: 20000,
        depositInCents: 5000,
        administrativeNotes: null,
      });

      const comOsDois = await nextSnapshot(
        (snapshot) => snapshot.transactions.filter((item) => item.appointmentId === id).length === 2,
        estudio,
      );
      const ligados = comOsDois.transactions.filter((item) => item.appointmentId === id);
      const sinal = ligados.find((item) => item.appointmentPart === "DEPOSIT")!;
      const servico = ligados.find((item) => item.appointmentPart === "SERVICE")!;

      // Centavos inteiros (regra 7), e os dois somam o valor cobrado.
      expect(sinal.amountInCents).toBe(5000);
      expect(servico.amountInCents).toBe(15000);
      const bruto = await getDoc(doc(db, paths.document(ORG_ESTETICA, "transactions", sinal.id)));
      expect(bruto.get("appointmentPart")).toBe("DEPOSIT");
      expect(bruto.get("dueDate")).toBeInstanceOf(Timestamp);

      await estudio.updateTransaction(sinal.id, { status: "PAID" });
      await nextSnapshot(
        (snapshot) => snapshot.transactions.some((item) => item.id === sinal.id && item.status === "PAID"),
        estudio,
      );

      // Cancelar retem o sinal pago e derruba so o que ficou a pagar.
      await estudio.setAppointmentStatus(id, "CANCELLED", undefined, { deposit: "KEEP" });
      const depois = await nextSnapshot(
        (snapshot) => snapshot.transactions.some((item) => item.id === servico.id && item.status === "CANCELLED"),
        estudio,
      );

      expect(depois.transactions.find((item) => item.id === sinal.id)?.status).toBe("PAID");
      expect(depois.appointments.find((item) => item.id === id)?.depositOutcome).toBe("KEPT");
    } finally {
      estudio.dispose();
    }
  });
  it("revisão da decisão vai e volta sem tocar na decisão, e corrigir preserva a primeira", async () => {
    const decisionId = "decisao-revisada";
    const decidedAt = "2026-09-20T12:00:00.000Z";
    const decision = {
      id: decisionId, organizationId: ORG, conversationId: CONVERSATION, messageId: "m-rev",
      clientId: CLIENT, professionalId: PROFESSIONAL, inputPreview: "", classification: "ADMINISTRATIVE",
      confidence: 0.9, appliedRules: [], action: "AUTO_RESPONSE", responseText: null, reason: "",
      attention: "NORMAL", escalated: false, engineVersion: "1", decidedAt, latencyMs: 5,
      createdAt: decidedAt, updatedAt: decidedAt, createdBy: null, updatedBy: null,
    };
    await setDoc(doc(db, paths.document(ORG, "aiDecisions", decisionId)), toFirestoreData("aiDecisions", decision));

    const owner = new FirestoreWorkspaceRepository(db, ORG, "PSYCHOLOGIST");
    try {
      owner.setActor({ userId: "user-owner", name: "Titular", role: "OWNER", permissions: permissionsForRole("OWNER") });
      await nextSnapshot((snapshot) => snapshot.decisions.some((item) => item.id === decisionId), owner);

      await owner.reviewDecision(decisionId, { verdict: "CORRECT", expectedClassification: null });
      const first = (await nextSnapshot((s) => s.decisionReviews?.some((r) => r.decisionId === decisionId) ?? false, owner))
        .decisionReviews!.find((r) => r.decisionId === decisionId)!;
      const stored = await getDoc(doc(db, paths.document(ORG, "aiDecisionReviews", decisionId)));
      expect(stored.get("createdAt")).toBeInstanceOf(Timestamp);

      await owner.reviewDecision(decisionId, { verdict: "INCORRECT", expectedClassification: "CLINICAL" });
      const corrected = (await nextSnapshot((s) => s.decisionReviews?.some((r) => r.verdict === "INCORRECT") ?? false, owner))
        .decisionReviews!.find((r) => r.decisionId === decisionId)!;
      expect(corrected).toMatchObject({ expectedClassification: "CLINICAL", createdAt: first.createdAt, createdBy: "user-owner" });

      const untouched = await getDoc(doc(db, paths.document(ORG, "aiDecisions", decisionId)));
      expect(untouched.get("classification")).toBe("ADMINISTRATIVE");
      expect(untouched.get("updatedAt")).toEqual(Timestamp.fromDate(new Date(decidedAt)));
    } finally {
      owner.dispose();
    }
  });
});
