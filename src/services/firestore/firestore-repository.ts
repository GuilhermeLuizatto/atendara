import {
  doc,
  onSnapshot,
  runTransaction,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type UpdateData,
  type WithFieldValue,
} from "firebase/firestore";

import {
  fromFirestoreData,
  toFirestoreData,
  type ConvertedCollection,
} from "@/lib/firebase/converters";
import type { TenantCollection } from "@/lib/firebase/paths";
import type {
  AgendaSettings,
  Appointment,
  AppointmentStatus,
  Conversation,
  ID,
  ISODateString,
  Membership,
  OrganizationNotificationSettings,
  ProfessionId,
} from "@/types";

import type { DispatchSummary } from "@/lib/notifications";
import { planUpdateNotificationSettings } from "./plans/outbound";
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
  type WorkspaceCollection,
  type WorkspaceLoadState,
  type WorkspacePagination,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from "../types";
import { docPath, type PlanContext, type WriteOperation } from "./plan";
import {
  planCreateAppointment,
  planSetAppointmentStatus,
  planUpdateAppointment,
} from "./plans/agenda";
import {
  planCreateClient,
  planDeleteClient,
  planUpdateClient,
} from "./plans/clients";
import {
  planCreateTransaction,
  planDeleteTransaction,
  planUpdateTransaction,
} from "./plans/finance";
import {
  planAcknowledgeNotification,
  planAppendAuditLog,
  planCreateNotification,
  planMarkAllNotificationsRead,
} from "./plans/governance";
import {
  planAppendMessage,
  planReceiveMessage,
  planRecordDecision,
  planReplyToConversation,
  planUpdateConversation,
} from "./plans/messaging";
import { planUpdateAgendaSettings } from "./plans/organization";
import {
  planCreateRule,
  planDeleteRule,
  planSetRuleEnabled,
  planUpdateRule,
} from "./plans/rules";
import {
  SNAPSHOT_PAGE_SIZES,
  generateId,
  generateMessageId,
  membershipRef,
  organizationRef,
  snapshotQueries,
  type PagedPart,
} from "./queries";
import {
  assembleSnapshot,
  emptyParts,
  type SnapshotParts,
} from "./snapshot";

/**
 * Repositorio operacional no Firestore.
 *
 * Expoe exatamente a mesma interface do repositorio em memoria, entao nenhuma
 * tela sabe qual dos dois esta ativo. A divisao de responsabilidade e proposital
 * e estreita:
 *
 * - `plans/` decide O QUE muda — logica de negocio pura, testavel sem emulador;
 * - esta classe decide COMO grava — lote atomico, transacao, conversao de erro;
 * - `firestore.rules` decide SE pode. Nada aqui e barreira de seguranca.
 */

type PartName = keyof SnapshotParts;

/** Parte do snapshot, colecao do conversor e nome publico da colecao. */
const COLLECTION_PARTS: Array<[PagedPart, ConvertedCollection, WorkspaceCollection]> = [
  ["professionals", "professionals", "professionals"],
  ["clients", "clients", "clients"],
  ["appointments", "appointments", "appointments"],
  ["conversations", "conversations", "conversations"],
  ["messages", "messages", "messages"],
  ["transactions", "transactions", "transactions"],
  ["aiRules", "aiRules", "rules"],
  ["aiDecisions", "aiDecisions", "decisions"],
  ["notifications", "notifications", "notifications"],
  ["notificationDeliveries", "notificationDeliveries", "notificationDeliveries"],
  ["auditLogs", "auditLogs", "auditLogs"],
];

/** Limite do Firestore por lote; a folga cobre a escrita de auditoria. */
const BATCH_LIMIT = 450;

/**
 * Depois disto a tela passa a dizer que esta demorando, em vez de mostrar um
 * esqueleto para sempre. Nao cancela nada: o SDK continua tentando.
 */
const SLOW_LOAD_MS = 12_000;

export interface FirestoreRepositoryOptions {
  /** Quem usa o painel. Sem ele, o vinculo nao e lido e o papel fica o padrao. */
  userId?: ID | null;
  /** Tamanho de pagina por colecao. Os testes usam paginas pequenas. */
  pageSizes?: Partial<Record<PagedPart, number>>;
  slowLoadMs?: number;
}

/**
 * O que `WriteBatch` e `Transaction` tem em comum. Tipar o minimo necessario
 * deixa `applyWrite` servir aos dois sem cast.
 */
interface WriteTarget {
  set(
    reference: DocumentReference<DocumentData>,
    data: WithFieldValue<DocumentData>,
  ): unknown;
  update(
    reference: DocumentReference<DocumentData>,
    data: UpdateData<DocumentData>,
  ): unknown;
  delete(reference: DocumentReference<DocumentData>): unknown;
}

export class FirestoreWorkspaceRepository implements WorkspaceRepository {
  readonly mode = "firestore" as const;

  private snapshot: WorkspaceSnapshot | null = null;
  private parts: SnapshotParts = emptyParts();
  private readonly pending = new Set<PartName>();
  private readonly listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  private readonly loadListeners = new Set<() => void>();
  private readonly unsubscribes = new Map<PartName, () => void>();
  private actor: RepositoryActor = { userId: null, name: "Sistema" };

  private readonly userId: ID | null;
  private readonly pageSizes: Record<PagedPart, number>;
  private readonly slowLoadMs: number;
  /** Quantos documentos cada colecao pediu ate agora. */
  private readonly limits: Record<PagedPart, number>;
  private readonly hasMore = new Set<PagedPart>();
  private readonly loadingMore = new Set<PagedPart>();
  private readonly failed = new Set<PagedPart>();
  /**
   * Resposta de um listener ja substituido e ignorada: sem isto, a pagina menor
   * que ainda estava a caminho sobrescreveria a maior que acabou de chegar.
   */
  private readonly generations = new Map<PartName, number>();
  private readonly pageWaiters = new Map<PagedPart, Array<() => void>>();
  private loadState: WorkspaceLoadState = { status: "loading", slow: false };
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly db: Firestore,
    private readonly organizationId: ID,
    private readonly professionId: ProfessionId,
    options: FirestoreRepositoryOptions = {},
  ) {
    this.userId = options.userId ?? null;
    this.pageSizes = { ...SNAPSHOT_PAGE_SIZES, ...options.pageSizes };
    this.limits = { ...this.pageSizes };
    this.slowLoadMs = options.slowLoadMs ?? SLOW_LOAD_MS;
    this.listen();
  }

  // ------------------------------------------------------------- leitura

  private listen(): void {
    this.pending.clear();
    this.pending.add("organization");
    if (this.userId) this.pending.add("membership");
    for (const [part] of COLLECTION_PARTS) this.pending.add(part);

    this.startSlowTimer();
    this.watchOrganization();
    if (this.userId) this.watchMembership(this.userId);
    for (const [part, collection] of COLLECTION_PARTS) {
      this.watchCollection(part, collection);
    }
  }

  private nextGeneration(part: PartName): number {
    const generation = (this.generations.get(part) ?? 0) + 1;
    this.generations.set(part, generation);
    return generation;
  }

  private replaceListener(part: PartName, unsubscribe: () => void): void {
    const previous = this.unsubscribes.get(part);
    this.unsubscribes.set(part, unsubscribe);
    previous?.();
  }

  private watchOrganization(): void {
    const generation = this.nextGeneration("organization");
    this.replaceListener(
      "organization",
      onSnapshot(
        organizationRef(this.db, this.organizationId),
        (document) => {
          if (generation !== this.generations.get("organization")) return;
          if (!document.exists()) {
            // Sem o documento nao ha workspace. Vindo do cache, e falta de
            // conexao; vindo do servidor, a conta existe mas a organizacao nao
            // foi provisionada. Nenhum dos dois vira fotografia inventada.
            this.parts = { ...this.parts, organization: null };
            this.snapshot = null;
            this.setLoadState({
              status: "unavailable",
              reason: document.metadata.fromCache ? "offline" : "organization-missing",
            });
            return;
          }
          this.parts = {
            ...this.parts,
            organization: fromFirestoreData(
              "organizations",
              document.id,
              document.data(),
            ),
          };
          this.settle("organization");
        },
        (error) => this.onOrganizationError(error),
      ),
    );
  }

  private watchMembership(userId: ID): void {
    const generation = this.nextGeneration("membership");
    this.replaceListener(
      "membership",
      onSnapshot(
        membershipRef(this.db, this.organizationId, userId),
        (document) => {
          if (generation !== this.generations.get("membership")) return;
          this.parts = {
            ...this.parts,
            membership: document.exists()
              ? fromFirestoreData<Membership>("members", document.id, document.data())
              : null,
          };
          this.settle("membership");
        },
        // Vinculo ilegivel nao derruba o painel: o papel fica o padrao e as
        // rules continuam decidindo cada leitura e escrita.
        () => {
          if (generation !== this.generations.get("membership")) return;
          this.settle("membership");
        },
      ),
    );
  }

  private watchCollection(part: PagedPart, collection: ConvertedCollection): void {
    const generation = this.nextGeneration(part);
    const count = this.limits[part];

    this.replaceListener(
      part,
      onSnapshot(
        snapshotQueries[part](this.db, this.organizationId, count + 1),
        (result) => {
          if (generation !== this.generations.get(part)) return;
          const documents = result.docs.slice(0, count);
          if (result.docs.length > count) this.hasMore.add(part);
          else this.hasMore.delete(part);
          this.loadingMore.delete(part);
          this.failed.delete(part);

          this.parts = {
            ...this.parts,
            [part]: documents.map((document) =>
              fromFirestoreData(collection, document.id, document.data() as DocumentData),
            ),
          };
          this.releasePageWaiters(part);
          this.settle(part);
        },
        (error) => {
          if (generation !== this.generations.get(part)) return;
          this.onCollectionError(part, error);
        },
      ),
    );
  }

  private onOrganizationError(error: unknown): void {
    const code = (error as { code?: string })?.code;
    if (code !== "permission-denied") {
      console.error("Falha ao carregar a organização do Firestore.", error);
    }
    // Sem limpar a parte, a proxima colecao que chegasse remontaria o painel
    // com a organizacao antiga — justamente depois de o acesso ter sido negado.
    this.parts = { ...this.parts, organization: null };
    this.snapshot = null;
    this.setLoadState({
      status: "unavailable",
      reason:
        code === "permission-denied"
          ? "access-denied"
          : code === "unavailable"
            ? "offline"
            : "failed",
    });
  }

  /**
   * Uma colecao negada nao derruba o workspace.
   *
   * `permission-denied` e resultado ESPERADO quando a conta nao tem o modulo
   * (financeiro, mensagens, agente) ou o papel exigido — a trilha de auditoria,
   * por exemplo, so e legivel por administracao. A tela ja esconde o que a
   * matriz de permissoes nao autoriza; aqui a colecao apenas chega vazia.
   * Qualquer outra falha fica registrada em `failed`, para a tela nao dizer
   * "nada cadastrado" quando o que houve foi erro.
   */
  private onCollectionError(part: PagedPart, error: unknown): void {
    const code = (error as { code?: string })?.code;
    if (code !== "permission-denied") {
      console.error(`Falha ao carregar "${part}" do Firestore.`, error);
      this.failed.add(part);
    }
    this.hasMore.delete(part);
    this.loadingMore.delete(part);
    this.releasePageWaiters(part);
    this.settle(part);
  }

  private settle(part: PartName): void {
    this.pending.delete(part);
    if (this.pending.size > 0) return;
    this.publish();
  }

  private pagination(): WorkspacePagination {
    const pagination: WorkspacePagination = {};
    for (const [part, , collection] of COLLECTION_PARTS) {
      if (this.hasMore.has(part) || this.loadingMore.has(part)) {
        pagination[collection] = {
          hasMore: this.hasMore.has(part),
          loading: this.loadingMore.has(part),
        };
      }
    }
    return pagination;
  }

  private publish(): void {
    const next = assembleSnapshot(
      this.parts,
      this.organizationId,
      this.professionId,
      this.now(),
      this.pagination(),
    );
    if (!next) return;

    this.snapshot = next;
    this.setLoadState({
      status: "ready",
      failed: COLLECTION_PARTS.filter(([part]) => this.failed.has(part)).map(
        ([, , collection]) => collection,
      ),
    });
    for (const listener of this.listeners) listener(next);
  }

  private setLoadState(next: WorkspaceLoadState): void {
    if (JSON.stringify(next) === JSON.stringify(this.loadState)) return;
    this.loadState = next;
    if (next.status !== "loading") this.clearSlowTimer();
    for (const listener of this.loadListeners) listener();
  }

  private startSlowTimer(): void {
    this.clearSlowTimer();
    this.slowTimer = setTimeout(() => {
      if (this.loadState.status === "loading") {
        this.setLoadState({ status: "loading", slow: true });
      }
    }, this.slowLoadMs);
  }

  private clearSlowTimer(): void {
    if (this.slowTimer !== null) clearTimeout(this.slowTimer);
    this.slowTimer = null;
  }

  private releasePageWaiters(part: PagedPart): void {
    const waiters = this.pageWaiters.get(part);
    this.pageWaiters.delete(part);
    for (const resolve of waiters ?? []) resolve();
  }

  subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): WorkspaceSnapshot | null {
    return this.snapshot;
  }

  getLoadState(): WorkspaceLoadState {
    return this.loadState;
  }

  subscribeLoadState(listener: () => void): () => void {
    this.loadListeners.add(listener);
    return () => {
      this.loadListeners.delete(listener);
    };
  }

  /**
   * Pede a proxima pagina aumentando o limite do listener daquela colecao.
   *
   * Custo assumido: o Firestore cobra de novo os documentos que ja estavam na
   * tela, porque um listener com limite maior e outra consulta. Em troca a
   * colecao continua em tempo real inteira — com cursor e paginas estaticas,
   * editar um registro da segunda pagina nao apareceria ate recarregar.
   */
  loadMore(collection: WorkspaceCollection): Promise<void> {
    const entry = COLLECTION_PARTS.find(([, , name]) => name === collection);
    if (!entry) return Promise.resolve();
    const [part, converted] = entry;
    if (!this.hasMore.has(part)) return Promise.resolve();

    const arrived = new Promise<void>((resolve) => {
      this.pageWaiters.set(part, [...(this.pageWaiters.get(part) ?? []), resolve]);
    });
    if (this.loadingMore.has(part)) return arrived;

    this.limits[part] += this.pageSizes[part];
    this.loadingMore.add(part);
    this.publish();
    this.watchCollection(part, converted);
    return arrived;
  }

  retry(): void {
    for (const unsubscribe of this.unsubscribes.values()) unsubscribe();
    this.unsubscribes.clear();
    this.generations.clear();
    this.failed.clear();
    this.loadingMore.clear();
    this.setLoadState({ status: "loading", slow: false });
    this.listen();
  }

  setActor(actor: RepositoryActor): void {
    this.actor = actor;
  }

  /** Encerra os listeners. Chamado quando a sessao ou a organizacao muda. */
  dispose(): void {
    for (const unsubscribe of this.unsubscribes.values()) unsubscribe();
    this.unsubscribes.clear();
    this.listeners.clear();
    this.loadListeners.clear();
    this.clearSlowTimer();
    for (const part of [...this.pageWaiters.keys()]) this.releasePageWaiters(part);
  }

  // ------------------------------------------------------------- escrita

  private now(): ISODateString {
    return new Date().toISOString();
  }

  private context(snapshot?: WorkspaceSnapshot): PlanContext {
    const current = snapshot ?? this.snapshot;
    if (!current) {
      throw new RepositoryError("Os dados ainda estão carregando.");
    }

    return {
      organizationId: this.organizationId,
      snapshot: current,
      actor: this.actor,
      now: this.now(),
      newId: (collection: TenantCollection) =>
        generateId(this.db, this.organizationId, collection),
      newMessageId: (conversationId: ID) =>
        generateMessageId(this.db, this.organizationId, conversationId),
    };
  }

  private applyWrite(target: WriteTarget, write: WriteOperation): void {
    const ref = doc(this.db, write.path);
    if (write.op === "delete") {
      target.delete(ref);
      return;
    }
    const data = toFirestoreData(write.collection, write.data);
    if (write.op === "set") target.set(ref, data);
    else target.update(ref, data);
  }

  /**
   * As escritas de um plano vao em lote atomico: ou a mensagem e a decisao que
   * a explica entram juntas, ou nenhuma entra. O fatiamento so existe para o
   * caso extremo de um plano passar do limite do Firestore.
   */
  private async commit(writes: WriteOperation[]): Promise<void> {
    if (writes.length === 0) return;

    try {
      for (let index = 0; index < writes.length; index += BATCH_LIMIT) {
        const batch = writeBatch(this.db);
        for (const write of writes.slice(index, index + BATCH_LIMIT)) {
          this.applyWrite(batch, write);
        }
        await batch.commit();
      }
    } catch (error) {
      throw toRepositoryError(error);
    }
  }

  // ---------------------------------------------------------- clientes

  async createClient(input: ClientInput): Promise<ID> {
    const plan = planCreateClient(this.context(), input);
    await this.commit(plan.writes);
    return plan.result;
  }

  async updateClient(id: ID, input: Partial<ClientInput>): Promise<void> {
    await this.commit(planUpdateClient(this.context(), id, input).writes);
  }

  async deleteClient(id: ID): Promise<void> {
    await this.commit(planDeleteClient(this.context(), id).writes);
  }

  // ------------------------------------------------------- atendimentos

  async createAppointment(input: AppointmentInput): Promise<ID> {
    const plan = planCreateAppointment(this.context(), input);
    await this.commit(plan.writes);
    return plan.result;
  }

  async updateAppointment(
    id: ID,
    input: Partial<AppointmentInput>,
  ): Promise<void> {
    await this.commit(planUpdateAppointment(this.context(), id, input).writes);
  }

  /**
   * Confirmar, cancelar e concluir sao as acoes que duas pessoas disputam de
   * verdade (o profissional pelo celular, a secretaria pelo balcao). Por isso
   * esta e a unica escrita que re-le o atendimento e as receitas ligadas a ele
   * dentro de uma transacao: o plano e recalculado sobre o estado do servidor,
   * nao sobre o snapshot que a tela tinha em maos.
   */
  async setAppointmentStatus(
    id: ID,
    status: AppointmentStatus,
    reason?: string,
  ): Promise<void> {
    const base = this.context();
    const appointmentRef = doc(this.db, docPath(base, "appointments", id));
    const linkedIds = base.snapshot.transactions
      .filter((transaction) => transaction.appointmentId === id)
      .map((transaction) => transaction.id);

    try {
      await runTransaction(this.db, async (transaction) => {
        const current = await transaction.get(appointmentRef);
        if (!current.exists()) {
          throw new RepositoryError("Atendimento não encontrado.");
        }

        const linked = await Promise.all(
          linkedIds.map((transactionId) =>
            transaction.get(doc(this.db, docPath(base, "transactions", transactionId))),
          ),
        );

        const fresh = fromFirestoreData<Appointment>(
          "appointments",
          current.id,
          current.data(),
        );

        const ctx = this.context({
          ...base.snapshot,
          appointments: base.snapshot.appointments.map((appointment) =>
            appointment.id === id ? fresh : appointment,
          ),
          transactions: base.snapshot.transactions.map((stale) => {
            const document = linked.find((item) => item.id === stale.id);
            return document?.exists()
              ? fromFirestoreData<(typeof base.snapshot.transactions)[number]>(
                  "transactions",
                  document.id,
                  document.data(),
                )
              : stale;
          }),
        });

        for (const write of planSetAppointmentStatus(ctx, id, status, reason)
          .writes) {
          this.applyWrite(transaction, write);
        }
      });
    } catch (error) {
      throw toRepositoryError(error);
    }
  }

  // ---------------------------------------------------------- financeiro

  async createTransaction(input: TransactionInput): Promise<ID> {
    const plan = planCreateTransaction(this.context(), input);
    await this.commit(plan.writes);
    return plan.result;
  }

  async updateTransaction(
    id: ID,
    input: Partial<TransactionInput>,
  ): Promise<void> {
    await this.commit(planUpdateTransaction(this.context(), id, input).writes);
  }

  async deleteTransaction(id: ID): Promise<void> {
    await this.commit(planDeleteTransaction(this.context(), id).writes);
  }

  // --------------------------------------------------------------- regras

  async createRule(input: RuleInput): Promise<ID> {
    const plan = planCreateRule(this.context(), input);
    await this.commit(plan.writes);
    return plan.result;
  }

  async updateRule(id: ID, input: Partial<RuleInput>): Promise<void> {
    await this.commit(planUpdateRule(this.context(), id, input).writes);
  }

  async deleteRule(id: ID): Promise<void> {
    await this.commit(planDeleteRule(this.context(), id).writes);
  }

  async setRuleEnabled(id: ID, enabled: boolean): Promise<void> {
    await this.commit(planSetRuleEnabled(this.context(), id, enabled).writes);
  }

  // ------------------------------------------------------------ conversas

  async appendMessage(input: MessageInput): Promise<ID> {
    const plan = planAppendMessage(this.context(), input);
    await this.commit(plan.writes);
    return plan.result;
  }

  async receiveMessage(
    conversationId: ID,
    text: string,
    evaluatedAt?: string,
  ): Promise<ID> {
    const plan = planReceiveMessage(
      this.context(),
      conversationId,
      text,
      evaluatedAt,
    );
    await this.commit(plan.writes);
    return plan.result;
  }

  async replyToConversation(conversationId: ID, text: string): Promise<void> {
    await this.commit(
      planReplyToConversation(this.context(), conversationId, text).writes,
    );
  }

  async recordDecision(input: DecisionInput): Promise<ID> {
    const plan = planRecordDecision(this.context(), input);
    await this.commit(plan.writes);
    return plan.result;
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
    await this.commit(planUpdateConversation(this.context(), id, patch).writes);
  }

  // ------------------------------------------------ avisos ao cliente

  async updateNotificationSettings(
    settings: OrganizationNotificationSettings,
  ): Promise<void> {
    await this.commit(
      planUpdateNotificationSettings(this.context(), settings).writes,
    );
  }

  async updateAgendaSettings(settings: AgendaSettings): Promise<void> {
    await this.commit(planUpdateAgendaSettings(this.context(), settings).writes);
  }

  /**
   * Nao ha disparo pelo navegador numa organizacao real. O gatilho da agenda
   * planeja, a Cloud Tasks agenda e o despachante envia depois de conferir as
   * travas de novo (`functions/automation.js`); as Security Rules recusam
   * escrita do cliente na fila (S-05).
   */
  async dispatchDueNotifications(): Promise<DispatchSummary> {
    throw new RepositoryError(
      "Os avisos são enviados pelo servidor no horário planejado. Não há disparo manual.",
    );
  }

  // -------------------------------------------------------- notificacoes

  async createNotification(input: NotificationInput): Promise<ID> {
    const plan = planCreateNotification(this.context(), input);
    await this.commit(plan.writes);
    return plan.result;
  }

  async acknowledgeNotification(id: ID): Promise<void> {
    await this.commit(planAcknowledgeNotification(this.context(), id).writes);
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.commit(planMarkAllNotificationsRead(this.context()).writes);
  }

  async appendAuditLog(input: AuditInput): Promise<ID> {
    const plan = planAppendAuditLog(this.context(), input);
    await this.commit(plan.writes);
    return plan.result;
  }

  async reset(): Promise<void> {
    throw new RepositoryError(
      "Restaurar dados existe apenas na demonstração local.",
    );
  }
}

/**
 * Erro do SDK vira mensagem util. `permission-denied` aqui significa que as
 * Security Rules recusaram algo que a interface julgou permitido — vale dizer
 * ao usuario o que checar, sem expor detalhe interno.
 */
function toRepositoryError(error: unknown): Error {
  if (error instanceof RepositoryError) return error;

  const code = (error as { code?: string })?.code;
  if (code === "permission-denied") {
    return new RepositoryError(
      "O servidor recusou esta ação. Confira suas permissões e a validade do acesso.",
    );
  }
  if (code === "unavailable") {
    return new RepositoryError(
      "Sem conexão com o servidor. Tente novamente em instantes.",
    );
  }

  console.error("Falha na escrita do Firestore.", error);
  return error instanceof Error ? error : new Error(String(error));
}
