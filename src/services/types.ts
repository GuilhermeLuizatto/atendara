import type { DepositChoice } from "@/config/deposit";
import type { DecisionReviewInput } from "@/lib/ai/decision-review";
import type { RecurringChargeInput } from "@/lib/finance/recurring";
import type { ReceiptIssuerInput } from "@/lib/finance/receipts";
import type { DispatchSummary } from "@/lib/notifications";
import type { CalendarBusySnapshot } from "@/types/calendar";
import type {
  AgendaSettings,
  AIAgentSettings,
  AIDecision,
  AIDecisionReview,
  AIRule,
  Appointment,
  AppointmentStatus,
  AuditAction,
  AuditLog,
  AutomationTask,
  Client,
  Conversation,
  ID,
  ISODateString,
  Membership,
  Message,
  Notification,
  NotificationDelivery,
  Organization,
  OrganizationNotificationSettings,
  Professional,
  PaymentLink,
  PaymentProof,
  Receipt,
  ReceiptSettings,
  RecurringCharge,
  RecurringChargeStatus,
  Service,
  ServiceInput,
  StoredNotificationConsent,
  Transaction,
} from "@/types";

/** Colecoes do snapshot que podem chegar por partes. */
export type WorkspaceCollection =
  | "professionals"
  | "clients"
  | "services"
  | "appointments"
  | "conversations"
  | "messages"
  | "transactions"
  | "recurringCharges"
  | "paymentLinks"
  | "paymentProofs"
  | "receipts"
  | "receiptSettings"
  | "rules"
  | "decisions"
  | "decisionReviews"
  | "notifications"
  | "notificationDeliveries"
  | "automationTasks"
  | "calendarBusy"
  | "auditLogs";

export interface CollectionPage {
  /** Existem documentos alem dos carregados, na ordem da consulta. */
  hasMore: boolean;
  /** A proxima pagina foi pedida e ainda nao chegou. */
  loading: boolean;
}

/** Colecao ausente aqui chegou inteira. */
export type WorkspacePagination = Partial<Record<WorkspaceCollection, CollectionPage>>;

/**
 * Onde a carga do workspace esta.
 *
 * Existe para a tela nunca confundir "ainda nao chegou" ou "nao deu para
 * buscar" com "esta vazio" — numa organizacao nova, vazio e o estado normal, e
 * uma lista vazia por falha de rede diria ao profissional que ele perdeu dados.
 */
export type WorkspaceLoadState =
  | { status: "loading"; slow: boolean }
  /** `failed`: colecoes que nao carregaram por falha tecnica. O resto funciona. */
  | { status: "ready"; failed: WorkspaceCollection[] }
  | {
      status: "unavailable";
      reason: "offline" | "organization-missing" | "access-denied" | "failed";
    };

/**
 * Fotografia do espaco de trabalho de UMA organizacao.
 *
 * O repositorio entrega o conjunto carregado de uma vez, e as telas derivam o
 * que precisam com `useMemo`, sem query por tela. As colecoes que crescem vem
 * por paginas (`pagination`), das mais recentes para as mais antigas; pedir a
 * proxima e `loadMore`.
 */
export interface WorkspaceSnapshot {
  organization: Organization;
  professionals: Professional[];
  clients: Client[];
  /**
   * Catalogo de servicos (E2.1). Vazio em profissao sem
   * `features.serviceCatalog` — a colecao nem chega a existir.
   */
  services: Service[];
  appointments: Appointment[];
  conversations: Conversation[];
  messages: Message[];
  transactions: Transaction[];
  /** Mensalidades dos clientes (cobrador, C1). Ausente vale vazia. */
  recurringCharges?: RecurringCharge[];
  /** Links de pagamento e comprovantes (cobrador, C2). Ausentes valem vazios. */
  paymentLinks?: PaymentLink[];
  paymentProofs?: PaymentProof[];
  /** Recibos emitidos e o emissor da organizacao (C3). */
  receipts?: Receipt[];
  receiptSettings?: ReceiptSettings | null;
  rules: AIRule[];
  decisions: AIDecision[];
  /**
   * Revisao humana das decisoes (Fase 4). Opcional como `calendarBusy`: a
   * demonstracao antiga e os fixtures nao a trazem, e ausente vale vazia.
   */
  decisionReviews?: AIDecisionReview[];
  notifications: Notification[];
  /** Fila de saida dos avisos ao cliente. Vazia enquanto nada for configurado. */
  notificationDeliveries: NotificationDelivery[];
  /** Histórico da fila, somente leitura; pode estar paginado. */
  automationTasks: AutomationTask[];
  /**
   * Ocupado do Google por profissional (3C). Ausente na demonstração e para
   * quem não tem o módulo de agenda — as rules negam, e a parte chega vazia.
   */
  calendarBusy?: CalendarBusySnapshot[];
  auditLogs: AuditLog[];
  /**
   * Vinculo de quem usa o painel, lido de `members/{uid}` — o mesmo documento
   * que as rules conferem. Ausente na demonstracao, que nao tem vinculo real.
   */
  membership?: Membership | null;
  pagination?: WorkspacePagination;
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

export type { ServiceInput };

export interface ClientInput {
  /** Aceite geral. Sozinho nao autoriza envio: falta nomear o canal. */
  appointmentNotificationsEnabled?: boolean;
  /**
   * Consentimento por canal, com historico. Mudar exige
   * `notificationConsent:record` e so pode acrescentar ou retirar registro.
   */
  notificationConsent?: StoredNotificationConsent | null;
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
  /** Servico do catalogo (E2.1). Ausente em profissao sem catalogo. */
  serviceId?: ID | null;
  serviceName?: string | null;
  /**
   * Sinal antecipado (E2.2), em centavos. Ausente ou `null` = sem sinal. O
   * sinal abate: o lancamento do servico nasce pelo valor menos o sinal.
   */
  depositInCents?: number | null;
  /**
   * Atendimento a domicilio (E2.3). O endereco e dado pessoal e so existe em
   * modalidade `HOME_VISIT`, na profissao que registra domicilio.
   */
  visitAddress?: string | null;
  travelFeeInCents?: number | null;
}

/** O que muda numa mensalidade: vale dos proximos meses em diante. */
export type RecurringChargeUpdate = Partial<Pick<RecurringChargeInput, "description" | "amountInCents" | "method" | "dueDay">>;

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
  clientId: ID | null;
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
  /** Mesma referencia enquanto nada mudar, para `useSyncExternalStore`. */
  getLoadState(): WorkspaceLoadState;
  subscribeLoadState(listener: () => void): () => void;
  /** Descarta as leituras abertas e comeca a carga de novo. */
  retry(): void;
  /**
   * Pede a proxima pagina de uma colecao. Resolve quando ela chega; sem efeito
   * quando nao ha mais nada.
   */
  loadMore(collection: WorkspaceCollection): Promise<void>;
  setActor(actor: RepositoryActor): void;

  createService(input: ServiceInput): Promise<ID>;
  updateService(id: ID, input: Partial<ServiceInput>): Promise<void>;
  /**
   * Arquiva em vez de apagar quando o servico ja foi usado: atendimento
   * passado guarda o id, e apagar o servico deixaria um registro sem nome.
   */
  archiveService(id: ID): Promise<void>;
  deleteService(id: ID): Promise<void>;

  createClient(input: ClientInput): Promise<ID>;
  updateClient(id: ID, input: Partial<ClientInput>): Promise<void>;
  deleteClient(id: ID): Promise<void>;

  createAppointment(input: AppointmentInput): Promise<ID>;
  updateAppointment(id: ID, input: Partial<AppointmentInput>): Promise<void>;
  /**
   * `deposit` e a escolha da tela quando um atendimento com sinal PAGO e
   * cancelado: reter ou devolver. Ausente = reter, que e o padrao do sinal.
   */
  setAppointmentStatus(
    id: ID,
    status: AppointmentStatus,
    reason?: string,
    options?: { deposit?: DepositChoice | null },
  ): Promise<void>;

  createTransaction(input: TransactionInput): Promise<ID>;
  updateTransaction(id: ID, input: Partial<TransactionInput>): Promise<void>;
  deleteTransaction(id: ID): Promise<void>;

  /**
   * Mensalidade do cliente (cobrador, C1). Criar exige `transaction:create` e
   * ja lanca o mes corrente; mudar e pausar, retomar ou encerrar exigem
   * `transaction:update`. Mes ja lancado nunca muda por aqui.
   */
  createRecurringCharge(input: RecurringChargeInput): Promise<ID>;
  updateRecurringCharge(id: ID, patch: RecurringChargeUpdate): Promise<void>;
  setRecurringChargeStatus(id: ID, status: RecurringChargeStatus): Promise<void>;
  /**
   * Conferencia do comprovante (C2). Aprovar marca o mes como pago no mesmo
   * lote; recusar exige motivo, que a pessoa ve no link. `transaction:update`.
   */
  approvePaymentProof(id: ID): Promise<void>;
  rejectPaymentProof(id: ID, reason: string): Promise<void>;
  /** Quem emite os recibos. Exige `receiptSettings:update` (OWNER, ADMIN e o titular). */
  updateReceiptSettings(input: ReceiptIssuerInput): Promise<void>;

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

  /**
   * Configuracao dos avisos que a organizacao envia. E a unica porta para ligar
   * canal, evento, antecedencia e modelo — nao ha caminho implicito.
   */
  updateNotificationSettings(
    settings: OrganizationNotificationSettings,
  ): Promise<void>;
  /** Horario de atendimento e padroes da agenda. Exige `agendaSettings:update` (OWNER, ADMIN e o titular). */
  updateAgendaSettings(settings: AgendaSettings): Promise<void>;
  updateAISettings(settings: AIAgentSettings): Promise<void>;
  /**
   * Marca se a classificacao de uma decisao estava certa. Exige
   * `aiDecision:review` (OWNER e ADMIN); a decisao em si nao muda.
   */
  reviewDecision(decisionId: ID, input: DecisionReviewInput): Promise<void>;
  /**
   * Executa as entregas vencidas com o provedor simulado e grava o resultado.
   *
   * So a demonstracao (`mode: "memory"`) executa: la nao ha servidor. No
   * Firestore planejar e disparar sao atos do backend — gatilho da agenda, Cloud
   * Tasks e despachante — e este metodo recusa com `RepositoryError`, porque as
   * Security Rules recusariam a escrita de qualquer jeito.
   */
  dispatchDueNotifications(now?: ISODateString): Promise<DispatchSummary>;

  createNotification(input: NotificationInput): Promise<ID>;
  acknowledgeNotification(id: ID): Promise<void>;
  markAllNotificationsRead(): Promise<void>;

  appendAuditLog(input: AuditInput): Promise<ID>;

  /** Descarta alteracoes e volta ao estado inicial. Apenas em memoria. */
  reset(): Promise<void>;

  /**
   * Encerra assinaturas abertas. So a implementacao do Firestore precisa —
   * a versao em memoria nao tem nada a liberar — mas quem cria o repositorio
   * chama sempre, para nao ter de saber qual das duas esta ativa.
   */
  dispose?(): void;
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
