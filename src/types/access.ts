import type { InitialAccessGrant } from "./platform";
import type { ProfessionId } from "./profession";

export const APP_MODULES = [
  "dashboard",
  "agenda",
  "clientes",
  "mensagens",
  "financeiro",
  "agente",
  "configuracoes",
  "equipe",
  "importacao",
  "suporte",
] as const;
export type AppModule = (typeof APP_MODULES)[number];

/**
 * Como a conta nasceu. Ausente nas criadas antes do autocadastro existir, que
 * sao todas da operadora — por isso o campo e opcional em vez de exigir
 * migracao de dado.
 */
export type AccountOrigin = "OPERATOR" | "SELF_SERVICE" | "INVITATION";

/** Versao dos textos legais aceita no cadastro, e quando. */
export interface LegalAcceptance {
  version: string;
  acceptedAt: string;
}

export interface AccountAccess {
  userId: string;
  email: string;
  displayName: string;
  platformRole: "PLATFORM_ADMIN" | "PROFESSIONAL";
  /**
   * Chave mestra da operadora: so ela cria, suspende e reativa administradores.
   * Gravada pelo bootstrap, nunca por callable nem pela tela.
   */
  platformMaster?: boolean;
  organizationId: string | null;
  professionId: ProfessionId | null;
  modules: AppModule[];
  status: "ACTIVE" | "SUSPENDED";
  /**
   * Portao de acesso. Escrito so pelo backend: webhook do gateway ou concessao
   * registrada da operadora. Ausente na conta da operadora, que nao tem
   * validade porque nao alcanca tenant nenhum.
   */
  subscriptionStatus: "ACTIVE" | "PENDING" | "CANCELLED";
  accessUntil: string | null;
  mustChangePassword: boolean;
  origin?: AccountOrigin;
  /**
   * Quando o teste venceu e a conta passou a so pagar, exportar e apagar.
   *
   * Escrito pela rotina diaria, nunca pelo cliente. Nao e um portao — quem
   * fecha o painel e `accessUntil`, pela data — e sim o inicio do prazo de
   * retencao que a A.5 usa.
   */
  blockedSince?: string | null;
  /**
   * Quando uma assinatura PAGA abriu o acesso pela primeira vez. Escrito so pelo
   * webhook, uma unica vez.
   *
   * E o que tira a conta do ciclo do teste: a partir dele nao ha aviso de fim de
   * teste, nem bloqueio marcado pela rotina, nem apagamento aos 30 dias. O que
   * acontece com quem pagou e depois cancelou ainda nao foi decidido — ate la,
   * nada e apagado automaticamente.
   */
  subscribedAt?: string | null;
  /**
   * So existe em cadastro aberto: o aceite acontece na tela de cadastro. Quem a
   * operadora cadastrou aceitou fora do produto, e inventar um registro aqui
   * seria afirmar um consentimento que ninguem deu.
   */
  legal?: LegalAcceptance | null;
  createdAt: string;
}

/**
 * O que a tela de autocadastro envia. Sem modulos e sem validade: o teste abre
 * tudo, e a validade so nasce da concessao registrada na confirmacao do e-mail.
 */
export interface SelfServiceRegistration {
  displayName: string;
  email: string;
  /** Ausente em quem entra pelo Google: nao ha senha a escolher. */
  password?: string;
  professionId: ProfessionId;
  /** So para profissao com conselho; o formato e conferido, a veracidade nao. */
  councilRegistration?: string;
  businessName: string;
  acceptedLegalVersion: string;
}

/**
 * Cadastro pela operadora. Nao existe campo de validade: a conta nasce
 * pendente, e a concessao inicial opcional passa pelo mesmo registro de uma
 * concessao posterior.
 */
export interface ProfessionalRegistration {
  displayName: string;
  email: string;
  professionId: ProfessionId;
  modules: AppModule[];
  initialGrant?: InitialAccessGrant;
}

export type AccessUpdate = Pick<AccountAccess, "status" | "modules">;

/** Cadastro de administrador pela chave mestra. Nasce sem chave mestra. */
export interface PlatformAdminRegistration {
  displayName: string;
  email: string;
}
