import {
  doc,
  onSnapshot,
  runTransaction,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
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
  Appointment,
  AppointmentStatus,
  Conversation,
  ID,
  ISODateString,
  ProfessionId,
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
import {
  planCreateRule,
  planDeleteRule,
  planSetRuleEnabled,
  planUpdateRule,
} from "./plans/rules";
import {
  generateId,
  generateMessageId,
  organizationRef,
  snapshotQueries,
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

const COLLECTION_PARTS: Array<[PartName, ConvertedCollection]> = [
  ["professionals", "professionals"],
  ["clients", "clients"],
  ["appointments", "appointments"],
  ["conversations", "conversations"],
  ["messages", "messages"],
  ["transactions", "transactions"],
  ["aiRules", "aiRules"],
  ["aiDecisions", "aiDecisions"],
  ["notifications", "notifications"],
  ["auditLogs", "auditLogs"],
];

/** Limite do Firestore por lote; a folga cobre a escrita de auditoria. */
const BATCH_LIMIT = 450;

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
  private readonly unsubscribes: Array<() => void> = [];
  private actor: RepositoryActor = { userId: null, name: "Sistema" };

  constructor(
    private readonly db: Firestore,
    private readonly organizationId: ID,
    private readonly professionId: ProfessionId,
  ) {
    this.pending.add("organization");
    for (const [part] of COLLECTION_PARTS) this.pending.add(part);
    this.listen();
  }

  // ------------------------------------------------------------- leitura

  private listen(): void {
    this.unsubscribes.push(
      onSnapshot(
        organizationRef(this.db, this.organizationId),
        (document) => {
          if (!document.exists()) {
            // Sem o documento da organizacao nao ha workspace: a conta existe
            // mas nao foi provisionada. Melhor continuar carregando do que
            // publicar uma fotografia inventada.
            console.error(
              `Organizacao ${this.organizationId} nao encontrada no Firestore.`,
            );
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
        (error) => this.onPartError("organization", error),
      ),
    );

    for (const [part, collection] of COLLECTION_PARTS) {
      const build = snapshotQueries[part as keyof typeof snapshotQueries] as (
        db: Firestore,
        organizationId: ID,
      ) => Query;

      this.unsubscribes.push(
        onSnapshot(
          build(this.db, this.organizationId),
          (result) => {
            this.parts = {
              ...this.parts,
              [part]: result.docs.map((document) =>
                fromFirestoreData(
                  collection,
                  document.id,
                  document.data() as DocumentData,
                ),
              ),
            };
            this.settle(part);
          },
          (error) => this.onPartError(part, error),
        ),
      );
    }
  }

  /**
   * Uma colecao negada nao derruba o workspace.
   *
   * `permission-denied` e resultado ESPERADO quando a conta nao tem o modulo
   * (financeiro, mensagens, agente) ou o papel exigido — a trilha de auditoria,
   * por exemplo, so e legivel por administracao. A tela ja esconde o que a
   * matriz de permissoes nao autoriza; aqui a colecao apenas chega vazia.
   */
  private onPartError(part: PartName, error: unknown): void {
    const code = (error as { code?: string })?.code;
    if (code !== "permission-denied") {
      console.error(`Falha ao carregar "${part}" do Firestore.`, error);
    }
    this.settle(part);
  }

  private settle(part: PartName): void {
    this.pending.delete(part);
    if (this.pending.size > 0) return;
    this.publish();
  }

  private publish(): void {
    const next = assembleSnapshot(
      this.parts,
      this.organizationId,
      this.professionId,
      this.now(),
    );
    if (!next) return;

    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
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

  setActor(actor: RepositoryActor): void {
    this.actor = actor;
  }

  /** Encerra os listeners. Chamado quando a sessao ou a organizacao muda. */
  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.listeners.clear();
  }

  // ------------------------------------------------------------- escrita

  private now(): ISODateString {
    return new Date().toISOString();
  }

  private context(snapshot?: WorkspaceSnapshot): PlanContext {
    const current = snapshot ?? this.snapshot;
    if (!current) {
      throw new RepositoryError("Os dados ainda estao carregando.");
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
          throw new RepositoryError("Atendimento nao encontrado.");
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
      "Restaurar dados existe apenas na demonstracao local.",
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
      "O servidor recusou esta acao. Confira suas permissoes e a validade do acesso.",
    );
  }
  if (code === "unavailable") {
    return new RepositoryError(
      "Sem conexao com o servidor. Tente novamente em instantes.",
    );
  }

  console.error("Falha na escrita do Firestore.", error);
  return error instanceof Error ? error : new Error(String(error));
}
