import { AI_ASSISTANT_NAME } from "@/config/app";
import type { Permission, ProfessionTerminology } from "@/types";

/**
 * Nomes de icone em vez dos componentes: mantem a camada de configuracao livre
 * de dependencia de UI. O mapeamento nome -> componente vive em
 * `src/components/layout/nav-icon.tsx`.
 */
export type NavIconName =
  | "dashboard"
  | "calendar"
  | "users"
  | "messages"
  | "finance"
  | "agent"
  | "settings";

/**
 * Rotas da area autenticada. Declaradas como uniao literal para funcionar com
 * `typedRoutes`: `next/link` recusa uma `string` generica.
 */
export type AppRoute =
  | "/dashboard"
  | "/agenda"
  | "/clientes"
  | "/mensagens"
  | "/financeiro"
  | "/agente"
  | "/configuracoes";

export interface NavItem {
  href: AppRoute;
  icon: NavIconName;
  /** Rotulo fixo, usado quando o item nao depende da profissao. */
  label: string;
  /**
   * Quando presente, o rotulo vem da terminologia da profissao ativa —
   * e assim que "Clientes" vira "Pacientes" ou "Alunos".
   */
  terminologyKey?: keyof ProfessionTerminology;
  permission: Permission;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    icon: "dashboard",
    label: "Dashboard",
    permission: "organization:read",
    description: "Visão geral do dia",
  },
  {
    href: "/agenda",
    icon: "calendar",
    label: "Agenda",
    permission: "appointment:read",
    description: "Atendimentos e horários",
  },
  {
    href: "/clientes",
    icon: "users",
    label: "Clientes",
    terminologyKey: "client",
    permission: "client:read",
    description: "Cadastro e relacionamento",
  },
  {
    href: "/mensagens",
    icon: "messages",
    label: "Mensagens",
    permission: "conversation:read",
    description: "Central de atendimento",
  },
  {
    href: "/financeiro",
    icon: "finance",
    label: "Financeiro",
    permission: "transaction:read",
    description: "Receitas e pendências",
  },
  {
    href: "/agente",
    icon: "agent",
    label: AI_ASSISTANT_NAME,
    permission: "rule:read",
    description: "Regras, decisões e simulador",
  },
  {
    href: "/configuracoes",
    icon: "settings",
    label: "Configurações",
    permission: "organization:read",
    description: "Profissão, equipe e privacidade",
  },
];

/** Resolve o rotulo do item conforme a terminologia da profissao ativa. */
export function navLabel(
  item: NavItem,
  terminology: ProfessionTerminology,
): string {
  if (!item.terminologyKey) return item.label;
  return terminology[item.terminologyKey].plural;
}
