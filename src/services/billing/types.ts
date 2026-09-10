import type {
  ID,
  PlatformGatewayEvent,
  PlatformInvoice,
  PlatformSubscription,
} from "@/types";

/**
 * Contrato de leitura da cobranca da plataforma no cliente.
 *
 * Note o que NAO existe aqui: nenhum metodo que ative assinatura, estenda
 * validade ou lance fatura. As unicas escritas expostas ao navegador sao
 * pedidos ao gateway (`startCheckout`, `openPortal`, `requestCancellation`), e
 * os tres devolvem uma URL ou um "pedido registrado" — nunca um estado novo. O
 * estado muda quando o webhook assinado chega ao backend.
 *
 * `WorkspaceRepository` (`src/services/types.ts`) continua intacto e cuidando
 * so dos dados operacionais do assinante. Cobranca da plataforma e outro
 * assunto, com outro dono, e por isso tem outra porta.
 */
export interface PlatformBillingClient {
  /** `false` em modo demonstracao: nao ha cobranca sem projeto real. */
  readonly available: boolean;

  /** A assinatura da propria organizacao. */
  subscription(organizationId: ID): Promise<PlatformSubscription | null>;
  /** As faturas da propria organizacao, da mais recente para a mais antiga. */
  invoices(organizationId: ID): Promise<PlatformInvoice[]>;

  /** Abre o checkout hospedado. Devolve a URL para onde o assinante vai. */
  startCheckout(planId: ID): Promise<string>;
  /** Abre o portal do gateway (trocar cartao, ver recibos). */
  openPortal(): Promise<string>;
  /** Pede o cancelamento ao fim do ciclo. O efeito chega pelo webhook. */
  requestCancellation(): Promise<void>;

  // ------------------------------------------------- somente PLATFORM_ADMIN
  allSubscriptions(): Promise<PlatformSubscription[]>;
  allInvoices(): Promise<PlatformInvoice[]>;
  recentGatewayEvents(): Promise<PlatformGatewayEvent[]>;
}

export class BillingUnavailableError extends Error {
  constructor(message = "A cobranca nao esta disponivel neste ambiente.") {
    super(message);
    this.name = "BillingUnavailableError";
  }
}
