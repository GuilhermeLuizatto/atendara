import type { AppModule } from "@/types/access";

/**
 * Recorte de produto em vigor (decisão do titular em 16/11/2026): Psicologia de
 * ponta a ponta, para quem atende sozinho. O que sai daqui some da interface e
 * da navegação — rota, Function, Security Rule e dado continuam como estão.
 * Para reativar, remova o item da lista; nada mais precisa mudar.
 *
 * As profissões escondidas não vivem aqui: são o campo `listed` de
 * `src/config/professions/definitions.ts` (regra 1).
 */

/** Áreas do painel fora do menu e das rotas por enquanto. */
export const HIDDEN_APP_MODULES: readonly AppModule[] = [
  // A comunicação do psicólogo acontece pelo WhatsApp; "Primeiro contato" mora
  // dentro de mensagens e some junto.
  "mensagens",
  // Um único profissional usa o aplicativo.
  "equipe",
];

/** Abas de Configurações escondidas; mesmos ids de `features/settings/sections.ts`. */
export const HIDDEN_SETTINGS_SECTIONS: readonly string[] = ["recibos", "fila"];

export function isModuleHidden(module: AppModule): boolean {
  return HIDDEN_APP_MODULES.includes(module);
}

export function isSettingsSectionHidden(section: string): boolean {
  return HIDDEN_SETTINGS_SECTIONS.includes(section);
}
