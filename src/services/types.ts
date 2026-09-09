import type {
  AIDecision,
  AIRule,
  Appointment,
  AppointmentStatus,
  AuditAction,
  AuditLog,
  Client,
  Conversation,
  ID,
  Message,
  Notification,
  Organization,
  Professional,
  Transaction,
} from "@/types";

/**
 * Fotografia completa do espaco de trabalho de UMA organizacao.
 *
 * O repositorio entrega sempre o conjunto inteiro. Para o volume de um
 * consultorio isso e barato e simplifica muito a interface: as telas derivam o
 * que precisam com `useMemo`, sem query por tela. Quando uma organizacao
 * crescer a ponto de isso doer, a troca e paginar por colecao — o contrato de
 * assinatura nao muda.
 */
export interface WorkspaceSnapshot {
  organization: Organization;
  professionals: Professional[];
  clients: Client[];
  appointments: Appointment[];
  conversations: Conversation[];
  messages: Message[];
  transactions: Transaction[];
  rules: AIRule[];
  decisions: AIDecision[];
  notifications: Notification[];
  auditLogs: AuditLog[];
}

export type RepositoryMode = "memory" | "firestore";

/** Quem esta executando a acao. Vai para a trilha de auditoria. */
export interface RepositoryActor {
  permissions?: import("@/types").Permission[];
  userId: ID | null;
  name: string;
  role?: import("@/types").Role;
}

// --------------------------------------------------------------- entradas

export interface ClientInput {
  appointmentNotificationsEnabled?: boolean;
  fullName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  status: Client["status"];
  preferredModality: Client["preferredModality"];
  assignedProfessionalId: ID | null;
  acquisitionChannel: Client["acquisitionChannel"];
  tags: string[];
  administrativeNotes: string | null;
}

export interface AppointmentInput {
  clientId: ID;
  professionalId: ID;
  startsAt: string;
  durationMinutes: number;
  modality: Appointment["modality"];
  status: AppointmentStatus;
  priceInCents: number;
  administrativeNotes: string | null;
}

export interface TransactionInput {
  type: Transaction["type"];
  clientId: ID | null;
  professionalId: ID | null;
  appointmentId: ID | null;
  description: string;
  amountInCents: number;
  status: Transaction["status"];
  method: Transaction["method"];
  dueDate: string;
}

export interface RuleInput {
  name: string;
  description: string;
  level: AIRule["level"];
  category: AIRule["category"];
  enabled: boolean;
  priority: number;
  conditions: AIRule["conditions"];
  actions: AIRule["actions"];
  source: AIRule["source"];
  naturalLanguageInput: string | null;
  professionalId: ID | null;
}

export interface MessageInput {
  conversationId: ID;
  clientId: ID;
  direction: Message["direction"];
  authorType: Message["authorType"];
  authorName: string;
  channel: Message["channel"];
  body: string;
  classification: Message["classification"];
  classificationConfidence: number | null;
  aiDecisionId: ID | null;
}

export interface DecisionInput {
  conversationId: ID;
  messageId: ID;
  clientId: ID;
  professionalId: ID | null;
  inputPreview: string;
  classification: AIDecision["classification"];
  confidence: number;
  appliedRules: AIDecision["appliedRules"];
  action: AIDecision["action"];
  responseText: string | null;
  reason: string;
  attention: AIDecision["attention"];
  escalated: boolean;
  engineVersion: string;
  latencyMs: number;
}

export interface NotificationInput {
  type: Notification["type"];
  priority: Notification["priority"];
  title: string;
  body: string;
  professionalId: ID | null;
  target: Notification["target"];
  aiDecisionId: ID | null;
}

export interface AuditInput {
  action: AuditAction;
  actorType: AuditLog["actorType"];
  actorName?: string;
  resource: AuditLog["resource"];
  summary: string;
  metadata?: AuditLog["metadata"];
}

// ------------------------------------------------------------- repositorio

/**
 * Contrato unico de persistencia.
 *
 * A implementacao em memoria (prototipo) e a do Firestore (producao) expoem
 * exatamente esta interface, entao trocar uma pela outra nao toca em nenhuma
 * tela. Toda mutacao e assincrona mesmo na versao em memoria — assim o codigo
 * de chamada ja lida com latencia e erro desde o comeco.
 */
export interface WorkspaceRepository {
  readonly mode: RepositoryMode;

  /** Emite o estado atual imediatamente e a cada mudanca. */
  subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
  /**
   * Leitura sincrona do ultimo estado conhecido, para `useSyncExternalStore`.
   * `null` enquanto a primeira carga nao chegou (caso do Firestore).
   */
  getSnapshot(): WorkspaceSnapshot | null;
  setActor(actor: RepositoryActor): void;

  createClient(input: ClientInput): Promise<ID>;
  updateClient(id: ID, input: Partial<ClientInput>): Promise<void>;
  deleteClient(id: ID): Promise<void>;

  createAppointment(input: AppointmentInput): Promise<ID>;
  updateAppointment(id: ID, input: Partial<AppointmentInput>): Promise<void>;
  setAppointmentStatus(
    id: ID,
    status: AppointmentStatus,
    reason?: string,
  ): Promise<void>;

  createTransaction(input: TransactionInput): Promise<ID>;
  updateTransaction(id: ID, input: Partial<TransactionInput>): Promise<void>;
  deleteTransaction(id: ID): Promise<void>;

  createRule(input: RuleInput): Promise<ID>;
  updateRule(id: ID, input: Partial<RuleInput>): Promise<void>;
  deleteRule(id: ID): Promise<void>;
  setRuleEnabled(id: ID, enabled: boolean): Promise<void>;

  appendMessage(input: MessageInput): Promise<ID>;
  receiveMessage(
    conversationId: ID,
    text: string,
    evaluatedAt?: string,
  ): Promise<ID>;
  replyToConversation(conversationId: ID, text: string): Promise<void>;
  recordDecision(input: DecisionInput): Promise<ID>;
  updateConversation(
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
  ): Promise<void>;

  createNotification(input: NotificationInput): Promise<ID>;
  acknowledgeNotification(id: ID): Promise<void>;
  markAllNotificationsRead(): Promise<void>;

  appendAuditLog(input: AuditInput): Promise<ID>;

  /** Descarta alteracoes e volta ao estado inicial. Apenas em memoria. */
  reset(): Promise<void>;
}

/**
 * Erro de regra de negocio, distinto de falha tecnica. A interface mostra a
 * mensagem ao usuario; falhas tecnicas viram mensagem generica.
 */
export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}
