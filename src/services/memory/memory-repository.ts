import { toDateKey, type DateKey } from "@/lib/utils/datetime";
import { permissionsForRole } from "@/config/permissions";
import { getProfession } from "@/config/professions";
import { ruleInputSchema, validateRuleInput } from "@/lib/rules/validation";
import { decide } from "@/lib/ai/decision-engine";
import { buildMockDataset } from "@/mocks";
import type {
  AIRule,
  Appointment,
  AppointmentStatus,
  AuditLog,
  Client,
  Conversation,
  ID,
  ISODateString,
  Message,
  Notification,
  ProfessionId,
  Transaction,
} from "@/types";

import {
  RepositoryError,
  type AppointmentInput,
  type AuditInput,
  type ClientInput,
  type DecisionInput,
  type MessageInput,
  type NotificationInput,
  type RepositoryActor,
  type RuleInput,
  type TransactionInput,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from "../types";
import { assertPermission, validateMessageBody } from "../guards";
import {
  findConflict,
  markOverdue,
  recomputeClientAggregates,
} from "../aggregates";
import { createStateWriter, loadState } from "./persistence";

/**
 * Repositorio em memoria.
 *
 * Guarda a fotografia do tenant e aplica mutacoes sobre ela, publicando um novo
 * objeto a cada mudanca. Faz de proposito tudo o que a versao do Firestore fara:
 * valida regra de negocio, mantem agregados coerentes, grava trilha de auditoria
 * e dispara notificacao. Assim as telas nao descobrem comportamento novo quando
 * o backend real entrar.
 */
export class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly mode = "memory" as const;

  private snapshot: WorkspaceSnapshot;
  private readonly initial: WorkspaceSnapshot;
  private readonly listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  private actor: RepositoryActor = { userId: null, name: "Sistema" };
  private sequence = 0;
  private readonly dateKey: DateKey;
  private readonly writer: ReturnType<typeof createStateWriter>;

  constructor(professionId: ProfessionId, anchor: Date = new Date(), scope?: string) {
    this.initial = buildMockDataset(professionId, anchor);
    this.dateKey = toDateKey(anchor);
    const storageScope = scope ? `${scope}:${professionId}` : professionId;
    this.writer = createStateWriter(storageScope);

    // Retoma o que o usuario criou nesta sessao (ou em sessoes anteriores do
    // mesmo dia); na falta disso, parte do conjunto gerado.
    const restored = loadState(storageScope, this.dateKey);
    this.sequence = restored?.sequence ?? 0;
    this.snapshot = this.normalize(restored?.snapshot ?? this.initial);
  }

  // ------------------------------------------------------------- infra

  subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): WorkspaceSnapshot {
    return this.snapshot;
  }

  setActor(actor: RepositoryActor): void {
    this.actor = actor;
  }

  private now(): ISODateString {
    return new Date().toISOString();
  }

  private nextId(prefix: string): ID {
    this.sequence += 1;
    return `${prefix}-new-${this.sequence}`;
  }

  private stamp(now: ISODateString) {
    return {
      createdAt: now,
      updatedAt: now,
      createdBy: this.actor.userId,
      updatedBy: this.actor.userId,
    };
  }

  private get organizationId(): ID {
    return this.snapshot.organization.id;
  }

  /** Reaplica invariantes derivados, persiste e publica. */
  private commit(next: WorkspaceSnapshot): void {
    this.snapshot = this.normalize(next);
    this.writer.schedule({
      dateKey: this.dateKey,
      sequence: this.sequence,
      snapshot: this.snapshot,
    });
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private normalize(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
    const now = this.now();
    const transactions = markOverdue(snapshot.transactions, now);
    const clients = recomputeClientAggregates(
      snapshot.clients,
      snapshot.appointments,
      transactions,
      now,
    );

    return { ...snapshot, transactions, clients };
  }

  private audit(input: AuditInput, at: ISODateString): AuditLog {
    return {
      id: this.nextId("audit"),
      organizationId: this.organizationId,
      createdAt: at,
      updatedAt: at,
      createdBy: this.actor.userId,
      updatedBy: this.actor.userId,
      actorType: input.actorType,
      actorId: this.actor.userId,
      actorName: input.actorName ?? this.actor.name,
      action: input.action,
      resource: input.resource,
      summary: input.summary,
      metadata: input.metadata ?? {},
      occurredAt: at,
    };
  }

  private notification(
    input: NotificationInput,
    at: ISODateString,
  ): Notification {
    return {
      id: this.nextId("notif"),
      organizationId: this.organizationId,
      ...this.stamp(at),
      type: input.type,
      priority: input.priority,
      status: "UNREAD",
      title: input.title,
      body: input.body,
      professionalId: input.professionalId,
      target: input.target,
      channels: ["DASHBOARD"],
      aiDecisionId: input.aiDecisionId,
      acknowledgedBy: null,
      acknowledgedAt: null,
    };
  }

  // ---------------------------------------------------------- clientes

  async createClient(input: ClientInput): Promise<ID> {
    this.assertPermission("client:create");
    const now = this.now();
    const id = this.nextId("client");

    const client: Client = {
      id,
      organizationId: this.organizationId,
      ...this.stamp(now),
      ...input,
      lastAppointmentAt: null,
      nextAppointmentAt: null,
      totalAppointments: 0,
      outstandingBalanceInCents: 0,
    };

    this.commit({
      ...this.snapshot,
      clients: [client, ...this.snapshot.clients],
      notifications: [
        this.notification(
          {
            type: "NEW_CLIENT",
            priority: "NORMAL",
            title: "Novo cadastro",
            body: `${client.fullName} foi cadastrado.`,
            professionalId: client.assignedProfessionalId,
            target: { type: "client", id },
            aiDecisionId: null,
          },
          now,
        ),
        ...this.snapshot.notifications,
      ],
      auditLogs: [
        this.audit(
          {
            action: "CREATE",
            actorType: "USER",
            resource: { type: "client", id },
            summary: `Cadastro de ${client.fullName} criado.`,
            metadata: { status: client.status },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });

    return id;
  }

  async updateClient(id: ID, input: Partial<ClientInput>): Promise<void> {
    this.assertPermission("client:update");
    const now = this.now();
    const existing = this.snapshot.clients.find((client) => client.id === id);
    if (!existing) throw new RepositoryError("Cadastro nao encontrado.");

    const updated: Client = {
      ...existing,
      ...input,
      updatedAt: now,
      updatedBy: this.actor.userId,
    };

    this.commit({
      ...this.snapshot,
      clients: this.snapshot.clients.map((client) =>
        client.id === id ? updated : client,
      ),
      // O nome desnormalizado precisa acompanhar; caso contrario a agenda e a
      // caixa de entrada continuariam exibindo o nome antigo.
      appointments: this.snapshot.appointments.map((appointment) =>
        appointment.clientId === id
          ? { ...appointment, clientName: updated.fullName }
          : appointment,
      ),
      conversations: this.snapshot.conversations.map((conversation) =>
        conversation.clientId === id
          ? { ...conversation, clientName: updated.fullName }
          : conversation,
      ),
      auditLogs: [
        this.audit(
          {
            action: "UPDATE",
            actorType: "USER",
            resource: { type: "client", id },
            summary: `Cadastro de ${updated.fullName} atualizado.`,
            metadata: { fields: Object.keys(input).join(", ") },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  async deleteClient(id: ID): Promise<void> {
    this.assertPermission("client:delete");
    const now = this.now();
    const existing = this.snapshot.clients.find((client) => client.id === id);
    if (!existing) throw new RepositoryError("Cadastro nao encontrado.");

    // Excluir alguem com agenda futura apagaria compromissos silenciosamente.
    const future = this.snapshot.appointments.filter(
      (appointment) =>
        appointment.clientId === id &&
        appointment.startsAt > now &&
        appointment.status !== "CANCELLED",
    );
    if (future.length > 0) {
      throw new RepositoryError(
        `Existem ${future.length} atendimento(s) futuros. Cancele-os antes de excluir.`,
      );
    }

    const open = this.snapshot.transactions.filter(
      (transaction) =>
        transaction.clientId === id &&
        (transaction.status === "PENDING" || transaction.status === "OVERDUE"),
    );
    if (open.length > 0) {
      throw new RepositoryError(
        "Ha pendencias financeiras em aberto para este cadastro.",
      );
    }

    this.commit({
      ...this.snapshot,
      clients: this.snapshot.clients.filter((client) => client.id !== id),
      auditLogs: [
        this.audit(
          {
            action: "DELETE",
            actorType: "USER",
            resource: { type: "client", id },
            summary: `Cadastro de ${existing.fullName} excluido.`,
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  // ------------------------------------------------------- atendimentos

  async createAppointment(input: AppointmentInput): Promise<ID> {
    this.assertPermission("appointment:create");
    const now = this.now();
    const client = this.requireClient(input.clientId);
    const professional = this.requireProfessional(input.professionalId);

    const endsAt = addMinutes(input.startsAt, input.durationMinutes);
    const conflict = findConflict(this.snapshot.appointments, {
      professionalId: input.professionalId,
      startsAt: input.startsAt,
      endsAt,
    });
    if (
      conflict &&
      !this.snapshot.organization.settings.agenda.allowDoubleBooking
    ) {
      throw new RepositoryError(
        `Conflito de horario com ${conflict.clientName}.`,
      );
    }

    const id = this.nextId("appt");
    const appointment: Appointment = {
      id,
      organizationId: this.organizationId,
      ...this.stamp(now),
      clientId: client.id,
      clientName: client.fullName,
      professionalId: professional.id,
      professionalName: professional.displayName,
      startsAt: input.startsAt,
      endsAt,
      durationMinutes: input.durationMinutes,
      modality: input.modality,
      status: input.status,
      priceInCents: input.priceInCents,
      administrativeNotes: input.administrativeNotes,
      origin: "MANUAL",
      confirmedAt: input.status === "CONFIRMED" ? now : null,
      cancelledAt: null,
      cancellationReason: null,
      rescheduledFromId: null,
      externalCalendar: null,
    };

    // Todo atendimento cobrado gera a receita correspondente. E o que mantem o
    // financeiro coerente com a agenda sem lancamento manual duplicado.
    const transactions = [...this.snapshot.transactions];
    if (appointment.priceInCents > 0) {
      transactions.unshift({
        id: this.nextId("txn"),
        organizationId: this.organizationId,
        ...this.stamp(now),
        type: "INCOME",
        clientId: client.id,
        clientName: client.fullName,
        professionalId: professional.id,
        appointmentId: id,
        description: `Atendimento de ${client.fullName}`,
        amountInCents: appointment.priceInCents,
        status: "PENDING",
        method: null,
        dueDate: appointment.startsAt,
        paidAt: null,
        gateway: null,
      });
    }

    this.commit({
      ...this.snapshot,
      appointments: [...this.snapshot.appointments, appointment].sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      ),
      transactions,
      auditLogs: [
        this.audit(
          {
            action: "CREATE",
            actorType: "USER",
            resource: { type: "appointment", id },
            summary: `Atendimento de ${client.fullName} agendado.`,
            metadata: { startsAt: appointment.startsAt },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });

    return id;
  }

  async updateAppointment(
    id: ID,
    input: Partial<AppointmentInput>,
  ): Promise<void> {
    this.assertPermission("appointment:update");
    const now = this.now();
    const existing = this.requireAppointment(id);

    const startsAt = input.startsAt ?? existing.startsAt;
    const durationMinutes = input.durationMinutes ?? existing.durationMinutes;
    const professionalId = input.professionalId ?? existing.professionalId;
    const endsAt = addMinutes(startsAt, durationMinutes);

    const conflict = findConflict(this.snapshot.appointments, {
      id,
      professionalId,
      startsAt,
      endsAt,
    });
    if (
      conflict &&
      !this.snapshot.organization.settings.agenda.allowDoubleBooking
    ) {
      throw new RepositoryError(
        `Conflito de horario com ${conflict.clientName}.`,
      );
    }

    const client = input.clientId
      ? this.requireClient(input.clientId)
      : this.snapshot.clients.find((item) => item.id === existing.clientId);
    const professional = this.requireProfessional(professionalId);

    const updated: Appointment = {
      ...existing,
      ...input,
      startsAt,
      endsAt,
      durationMinutes,
      professionalId,
      professionalName: professional.displayName,
      clientId: client?.id ?? existing.clientId,
      clientName: client?.fullName ?? existing.clientName,
      updatedAt: now,
      updatedBy: this.actor.userId,
    };

    this.commit({
      ...this.snapshot,
      appointments: this.snapshot.appointments
        .map((appointment) => (appointment.id === id ? updated : appointment))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      // A receita vinculada acompanha valor e vencimento do atendimento.
      transactions: this.snapshot.transactions.map((transaction) =>
        transaction.appointmentId === id && transaction.status !== "PAID"
          ? {
              ...transaction,
              amountInCents: updated.priceInCents,
              dueDate: updated.startsAt,
              clientName: updated.clientName,
              updatedAt: now,
            }
          : transaction,
      ),
      auditLogs: [
        this.audit(
          {
            action: "UPDATE",
            actorType: "USER",
            resource: { type: "appointment", id },
            summary: `Atendimento de ${updated.clientName} atualizado.`,
            metadata: { startsAt: updated.startsAt },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  async setAppointmentStatus(
    id: ID,
    status: AppointmentStatus,
    reason?: string,
  ): Promise<void> {
    this.assertPermission(status === "CANCELLED" ? "appointment:cancel" : "appointment:update");
    const now = this.now();
    const existing = this.requireAppointment(id);

    const updated: Appointment = {
      ...existing,
      status,
      confirmedAt: status === "CONFIRMED" ? now : existing.confirmedAt,
      cancelledAt: status === "CANCELLED" ? now : existing.cancelledAt,
      cancellationReason:
        status === "CANCELLED"
          ? (reason ?? "Cancelado pelo profissional.")
          : existing.cancellationReason,
      updatedAt: now,
      updatedBy: this.actor.userId,
    };

    const notifications = [...this.snapshot.notifications];
    if (status === "CANCELLED") {
      notifications.unshift(
        this.notification(
          {
            type: "APPOINTMENT_CANCELLED",
            priority: "ATTENTION",
            title: `Atendimento cancelado: ${existing.clientName}`,
            body: updated.cancellationReason ?? "Cancelado.",
            professionalId: existing.professionalId,
            target: { type: "appointment", id },
            aiDecisionId: null,
          },
          now,
        ),
      );
    }

    // Cancelamento nao cobra: a receita pendente e cancelada junto.
    const transactions = this.snapshot.transactions.map((transaction) =>
      transaction.appointmentId === id &&
      status === "CANCELLED" &&
      transaction.status !== "PAID"
        ? { ...transaction, status: "CANCELLED" as const, updatedAt: now }
        : transaction,
    );

    this.commit({
      ...this.snapshot,
      appointments: this.snapshot.appointments.map((appointment) =>
        appointment.id === id ? updated : appointment,
      ),
      transactions,
      notifications,
      auditLogs: [
        this.audit(
          {
            action: "UPDATE",
            actorType: "USER",
            resource: { type: "appointment", id },
            summary: `Atendimento de ${existing.clientName}: ${status}.`,
            metadata: { status },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  // ---------------------------------------------------------- financeiro

  async createTransaction(input: TransactionInput): Promise<ID> {
    this.assertPermission("transaction:create");
    const now = this.now();
    const id = this.nextId("txn");
    const client = input.clientId
      ? this.snapshot.clients.find((item) => item.id === input.clientId)
      : null;

    const transaction: Transaction = {
      id,
      organizationId: this.organizationId,
      ...this.stamp(now),
      ...input,
      clientName: client?.fullName ?? null,
      paidAt: input.status === "PAID" ? now : null,
      gateway: null,
    };

    this.commit({
      ...this.snapshot,
      transactions: [transaction, ...this.snapshot.transactions],
      auditLogs: [
        this.audit(
          {
            action: "CREATE",
            actorType: "USER",
            resource: { type: "transaction", id },
            summary: `Lancamento "${input.description}" criado.`,
            metadata: { amountInCents: input.amountInCents, type: input.type },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });

    return id;
  }

  async updateTransaction(
    id: ID,
    input: Partial<TransactionInput>,
  ): Promise<void> {
    this.assertPermission("transaction:update");
    const now = this.now();
    const existing = this.snapshot.transactions.find(
      (transaction) => transaction.id === id,
    );
    if (!existing) throw new RepositoryError("Lancamento nao encontrado.");

    const status = input.status ?? existing.status;
    const client = input.clientId
      ? this.snapshot.clients.find((item) => item.id === input.clientId)
      : null;

    const updated: Transaction = {
      ...existing,
      ...input,
      clientName: input.clientId
        ? (client?.fullName ?? null)
        : existing.clientName,
      status,
      paidAt:
        status === "PAID"
          ? (existing.paidAt ?? now)
          : status === "PENDING"
            ? null
            : existing.paidAt,
      updatedAt: now,
      updatedBy: this.actor.userId,
    };

    this.commit({
      ...this.snapshot,
      transactions: this.snapshot.transactions.map((transaction) =>
        transaction.id === id ? updated : transaction,
      ),
      auditLogs: [
        this.audit(
          {
            action: "UPDATE",
            actorType: "USER",
            resource: { type: "transaction", id },
            summary: `Lancamento "${updated.description}" atualizado.`,
            metadata: { status },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  async deleteTransaction(id: ID): Promise<void> {
    this.assertPermission("transaction:delete");
    const now = this.now();
    const existing = this.snapshot.transactions.find(
      (transaction) => transaction.id === id,
    );
    if (!existing) throw new RepositoryError("Lancamento nao encontrado.");

    this.commit({
      ...this.snapshot,
      transactions: this.snapshot.transactions.filter(
        (transaction) => transaction.id !== id,
      ),
      auditLogs: [
        this.audit(
          {
            action: "DELETE",
            actorType: "USER",
            resource: { type: "transaction", id },
            summary: `Lancamento "${existing.description}" excluido.`,
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  // --------------------------------------------------------------- regras

  async createRule(input: RuleInput): Promise<ID> {
    this.assertPermission("rule:create");
    input = this.validateRule(input);
    const now = this.now();
    this.assertEditableLevel(input.level);

    const id = this.nextId("rule");
    const rule: AIRule = {
      id,
      organizationId: this.organizationId,
      ...this.stamp(now),
      ...input,
      immutable: false,
      version: 1,
      lastAppliedAt: null,
    };

    this.commit({
      ...this.snapshot,
      rules: [...this.snapshot.rules, rule],
      auditLogs: [
        this.audit(
          {
            action: "CREATE",
            actorType: "USER",
            resource: { type: "aiRule", id },
            summary: `Regra "${rule.name}" criada.`,
            metadata: { level: rule.level, source: rule.source },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });

    return id;
  }

  async updateRule(id: ID, input: Partial<RuleInput>): Promise<void> {
    this.assertPermission("rule:update");
    const now = this.now();
    const existing = this.requireEditableRule(id);
    input = this.validateRule({ ...existing, ...input });
    if (input.level) this.assertEditableLevel(input.level);

    const updated: AIRule = {
      ...existing,
      ...input,
      // Cada alteracao gera uma versao nova: a auditoria cita a versao aplicada,
      // e sem isso uma decisao antiga ficaria impossivel de interpretar.
      version: existing.version + 1,
      updatedAt: now,
      updatedBy: this.actor.userId,
    };

    this.commit({
      ...this.snapshot,
      rules: this.snapshot.rules.map((rule) =>
        rule.id === id ? updated : rule,
      ),
      auditLogs: [
        this.audit(
          {
            action: "UPDATE",
            actorType: "USER",
            resource: { type: "aiRule", id },
            summary: `Regra "${updated.name}" atualizada (v${updated.version}).`,
            metadata: { version: updated.version },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  async deleteRule(id: ID): Promise<void> {
    this.assertPermission("rule:delete");
    const now = this.now();
    const existing = this.requireEditableRule(id);

    this.commit({
      ...this.snapshot,
      rules: this.snapshot.rules.filter((rule) => rule.id !== id),
      auditLogs: [
        this.audit(
          {
            action: "DELETE",
            actorType: "USER",
            resource: { type: "aiRule", id },
            summary: `Regra "${existing.name}" excluida.`,
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  async setRuleEnabled(id: ID, enabled: boolean): Promise<void> {
    this.assertPermission("rule:update");
    const now = this.now();
    const existing = this.requireEditableRule(id);
    this.validateRule({ ...existing, enabled });

    this.commit({
      ...this.snapshot,
      rules: this.snapshot.rules.map((rule) =>
        rule.id === id
          ? {
              ...rule,
              enabled,
              version: rule.version + 1,
              updatedAt: now,
              updatedBy: this.actor.userId,
            }
          : rule,
      ),
      auditLogs: [
        this.audit(
          {
            action: enabled ? "RULE_ENABLED" : "RULE_DISABLED",
            actorType: "USER",
            resource: { type: "aiRule", id },
            summary: `Regra "${existing.name}" ${enabled ? "ativada" : "desativada"}.`,
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
  }

  // ------------------------------------------------------------ conversas

  async receiveMessage(
    conversationId: ID,
    text: string,
    evaluatedAt?: string,
  ): Promise<ID> {
    this.assertPermission("conversation:reply");
    const conversation = this.requireConversation(conversationId);
    const client = this.requireClient(conversation.clientId);
    const body = this.validateMessage(text);
    const started = performance.now();
    const now = this.now();
    const evaluationDate = new Date(evaluatedAt ?? now);
    if (!Number.isFinite(evaluationDate.getTime()))
      throw new RepositoryError("Data de simulacao invalida.");
    const outcome = decide({
      text: body,
      profession: getProfession(this.snapshot.organization.primaryProfession),
      organization: this.snapshot.organization,
      rules: this.snapshot.rules,
      professionalId: conversation.professionalId,
      permissions: this.actor.permissions ?? permissionsForRole(this.actor.role ?? "VIEWER"),
      humanHandoff: conversation.escalated,
      channel: conversation.channel,
      client: {
        modality: client.preferredModality,
        status: client.status,
        hasOutstandingBalance: client.outstandingBalanceInCents > 0,
      },
      now: evaluationDate,
    });
    const messageId = this.nextId("msg");
    const decisionId = this.nextId("decision");
    const { trace, ...decision } = outcome;
    const recorded = {
      ...decision,
      id: decisionId,
      organizationId: this.organizationId,
      ...this.stamp(now),
      conversationId,
      messageId,
      clientId: client.id,
      professionalId: conversation.professionalId,
      inputPreview: body.slice(0, 500),
      decidedAt: now,
      evaluatedAt: evaluationDate.toISOString(),
      latencyMs: Math.round(performance.now() - started),
    };
    const incoming: Message = {
      id: messageId,
      organizationId: this.organizationId,
      ...this.stamp(now),
      conversationId,
      clientId: client.id,
      direction: "INBOUND",
      authorType: "CLIENT",
      authorName: client.fullName,
      channel: conversation.channel,
      body,
      sentAt: now,
      readAt: null,
      classification: decision.classification,
      classificationConfidence: decision.confidence,
      aiDecisionId: decisionId,
    };
    const messages = [...this.snapshot.messages, incoming];
    if (decision.action === "AUTO_RESPONSE" && decision.responseText) {
      messages.push({
        ...incoming,
        id: this.nextId("msg"),
        direction: "OUTBOUND",
        authorType: "AI_AGENT",
        authorName: this.snapshot.organization.settings.ai.displayName,
        body: decision.responseText,
        readAt: now,
      });
    }
    const notifications = [...this.snapshot.notifications];
    if (decision.escalated || decision.action === "SUGGEST_RESPONSE") {
      notifications.unshift(
        this.notification(
          {
            type:
              decision.classification === "POSSIBLE_RISK"
                ? "POSSIBLE_RISK_DETECTED"
                : "CLIENT_WAITING",
            priority: decision.attention,
            title: `${client.fullName} aguarda atencao`,
            body: decision.reason,
            professionalId: conversation.professionalId,
            target: { type: "conversation", id: conversationId },
            aiDecisionId: decisionId,
          },
          now,
        ),
      );
    }
    // Mensagem, decisao, resposta e alerta sao publicados juntos para evitar trilhas parciais.
    this.commit({
      ...this.snapshot,
      messages,
      notifications,
      decisions: [recorded, ...this.snapshot.decisions],
      conversations: this.snapshot.conversations.map((item) =>
        item.id === conversationId
          ? {
              ...item,
              status:
                decision.action === "AUTO_RESPONSE"
                  ? "WAITING_CLIENT"
                  : "WAITING_PROFESSIONAL",
              lastClassification: decision.classification,
              lastMessagePreview: messages[messages.length - 1].body,
              lastMessageAt: now,
              unreadCount: item.unreadCount + 1,
              updatedAt: now,
              attention:
                item.attention === "CRITICAL" && item.escalated
                  ? "CRITICAL"
                  : decision.attention,
              escalated: decision.escalated,
              escalationReason: decision.escalated ? decision.reason : null,
            }
          : item,
      ),
      auditLogs: [
        this.audit(
          {
            action:
              decision.action === "AUTO_RESPONSE"
                ? "AI_AUTO_RESPONSE"
                : "AI_ESCALATION",
            actorType: "AI_AGENT",
            actorName: this.snapshot.organization.settings.ai.displayName,
            resource: { type: "conversation", id: conversationId },
            summary: decision.reason,
            metadata: {
              decisionId,
              classification: decision.classification,
              steps: trace.steps.length,
            },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });
    return decisionId;
  }

  async replyToConversation(conversationId: ID, text: string): Promise<void> {
    this.assertPermission("conversation:reply");
    const conversation = this.requireConversation(conversationId);
    const body = this.validateMessage(text);
    await this.appendMessage({
      conversationId,
      clientId: conversation.clientId,
      body,
      channel: conversation.channel,
      direction: "OUTBOUND",
      authorType: "PROFESSIONAL",
      authorName: this.actor.name,
      classification: null,
      classificationConfidence: null,
      aiDecisionId: null,
    });
    await this.updateConversation(conversationId, {
      status: "WAITING_CLIENT",
      unreadCount: 0,
      escalated: true,
      escalationReason: "Conversa assumida pelo profissional.",
    });
  }

  async appendMessage(input: MessageInput): Promise<ID> {
    const conversation = this.requireConversation(input.conversationId);
    if (conversation.clientId !== input.clientId)
      throw new RepositoryError("Cliente nao pertence a conversa.");
    this.validateMessage(input.body);
    const now = this.now();
    const id = this.nextId("msg");

    const message: Message = {
      id,
      organizationId: this.organizationId,
      ...this.stamp(now),
      ...input,
      sentAt: now,
      readAt: input.direction === "OUTBOUND" ? now : null,
    };

    this.commit({
      ...this.snapshot,
      messages: [...this.snapshot.messages, message],
      conversations: this.snapshot.conversations.map((conversation) =>
        conversation.id === input.conversationId
          ? {
              ...conversation,
              lastMessagePreview: input.body,
              lastMessageAt: now,
              unreadCount:
                input.direction === "OUTBOUND"
                  ? 0
                  : conversation.unreadCount + 1,
              updatedAt: now,
            }
          : conversation,
      ),
    });

    return id;
  }

  async recordDecision(input: DecisionInput): Promise<ID> {
    const now = this.now();
    const id = this.nextId("decision");

    this.commit({
      ...this.snapshot,
      decisions: [
        {
          id,
          organizationId: this.organizationId,
          ...this.stamp(now),
          ...input,
          decidedAt: now,
        },
        ...this.snapshot.decisions,
      ],
      auditLogs: [
        this.audit(
          {
            action:
              input.action === "AUTO_RESPONSE"
                ? "AI_AUTO_RESPONSE"
                : "AI_ESCALATION",
            actorType: "AI_AGENT",
            actorName: this.snapshot.organization.settings.ai.displayName,
            resource: { type: "conversation", id: input.conversationId },
            summary: input.reason,
            metadata: {
              classification: input.classification,
              confidence: input.confidence,
            },
          },
          now,
        ),
        ...this.snapshot.auditLogs,
      ],
    });

    return id;
  }

  async updateConversation(
    id: ID,
    patch: Partial<
      Pick<
        Conversation,
        | "status"
        | "attention"
        | "escalated"
        | "escalationReason"
        | "unreadCount"
      >
    >,
  ): Promise<void> {
    this.assertPermission("conversation:reply");
    this.requireConversation(id);
    const now = this.now();

    this.commit({
      ...this.snapshot,
      conversations: this.snapshot.conversations.map((conversation) =>
        conversation.id === id
          ? { ...conversation, ...patch, updatedAt: now }
          : conversation,
      ),
    });
  }

  // -------------------------------------------------------- notificacoes

  async createNotification(input: NotificationInput): Promise<ID> {
    const now = this.now();
    const notification = this.notification(input, now);

    this.commit({
      ...this.snapshot,
      notifications: [notification, ...this.snapshot.notifications],
    });

    return notification.id;
  }

  async acknowledgeNotification(id: ID): Promise<void> {
    const now = this.now();

    this.commit({
      ...this.snapshot,
      notifications: this.snapshot.notifications.map((notification) =>
        notification.id === id
          ? {
              ...notification,
              status: "ACKNOWLEDGED",
              acknowledgedBy: this.actor.userId,
              acknowledgedAt: now,
              updatedAt: now,
            }
          : notification,
      ),
    });
  }

  async markAllNotificationsRead(): Promise<void> {
    const now = this.now();

    this.commit({
      ...this.snapshot,
      notifications: this.snapshot.notifications.map((notification) =>
        notification.status === "UNREAD"
          ? { ...notification, status: "READ", updatedAt: now }
          : notification,
      ),
    });
  }

  async appendAuditLog(input: AuditInput): Promise<ID> {
    const now = this.now();
    const entry = this.audit(input, now);

    this.commit({
      ...this.snapshot,
      auditLogs: [entry, ...this.snapshot.auditLogs],
    });

    return entry.id;
  }

  async reset(): Promise<void> {
    this.sequence = 0;
    this.writer.clear();
    this.commit(this.initial);
  }

  // ------------------------------------------------------------ guardas

  private assertPermission(permission: import("@/types").Permission): void {
    assertPermission(this.actor, permission);
  }

  private validateRule(input: RuleInput): RuleInput {
    const validation = validateRuleInput(input);
    if (!validation.valid)
      throw new RepositoryError(validation.errors.join(" "));
    const parsed = ruleInputSchema.parse(input);
    if (parsed.professionalId) this.requireProfessional(parsed.professionalId);
    return parsed;
  }

  private validateMessage(text: string): string {
    return validateMessageBody(text);
  }

  private requireConversation(id: ID): Conversation {
    const conversation = this.snapshot.conversations.find(
      (item) => item.id === id,
    );
    if (!conversation) throw new RepositoryError("Conversa nao encontrada.");
    return conversation;
  }

  private requireClient(id: ID): Client {
    const client = this.snapshot.clients.find((item) => item.id === id);
    if (!client) throw new RepositoryError("Cadastro nao encontrado.");
    return client;
  }

  private requireProfessional(id: ID) {
    const professional = this.snapshot.professionals.find(
      (item) => item.id === id,
    );
    if (!professional)
      throw new RepositoryError("Profissional nao encontrado.");
    return professional;
  }

  private requireAppointment(id: ID): Appointment {
    const appointment = this.snapshot.appointments.find(
      (item) => item.id === id,
    );
    if (!appointment) throw new RepositoryError("Atendimento nao encontrado.");
    return appointment;
  }

  /**
   * Regras imutaveis (SECURITY, SYSTEM, PROFESSION) sao recusadas aqui pelo
   * mesmo motivo que as Security Rules as recusam no banco: nao existe caminho,
   * nem para o proprietario, que desative uma regra fundamental.
   */
  private requireEditableRule(id: ID): AIRule {
    const rule = this.snapshot.rules.find((item) => item.id === id);
    if (!rule) throw new RepositoryError("Regra nao encontrada.");
    if (rule.immutable) {
      throw new RepositoryError(
        "Regras fundamentais nao podem ser alteradas nem desativadas.",
      );
    }
    return rule;
  }

  private assertEditableLevel(level: AIRule["level"]): void {
    if (level === "SECURITY" || level === "SYSTEM" || level === "PROFESSION") {
      throw new RepositoryError(
        "Somente regras do profissional, contextuais e de preferencia podem ser criadas.",
      );
    }
  }
}

function addMinutes(iso: ISODateString, minutes: number): ISODateString {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

