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
  subscriptionStatus: "ACTIVE" | "PENDING" | "CANCELLED";
  accessUntil: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface ProfessionalRegistration {
  displayName: string;
  email: string;
  professionId: ProfessionId;
  modules: AppModule[];
  accessUntil: string;
}

export type AccessUpdate = Pick<AccountAccess, "status" | "subscriptionStatus" | "accessUntil" | "modules">;
