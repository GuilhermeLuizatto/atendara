import type { InitialAccessGrant } from "./platform";
import type { ProfessionId } from "./profession";

export const APP_MODULES = ["dashboard", "agenda", "clientes", "mensagens", "financeiro", "agente", "configuracoes"] as const;
export type AppModule = (typeof APP_MODULES)[number];

export interface AccountAccess {
  userId: string;
  email: string;
  displayName: string;
  platformRole: "PLATFORM_ADMIN" | "PROFESSIONAL";
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
  createdAt: string;
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
