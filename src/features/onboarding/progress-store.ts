import { createPreferenceStore, type PreferenceStore } from "@/lib/storage/preference-store";

import { EMPTY_PROGRESS, parseProgress, type OnboardingProgress } from "./steps";

/**
 * Progresso do guia, por organizacao e pessoa, no navegador.
 *
 * Fica fora do banco de proposito: marcar "a profissao esta certa" nao e dado
 * da organizacao, e grava-lo exigiria abrir escrita que o titular sem papel
 * administrativo nao tem. O custo aceito e o guia reaparecer em outro
 * navegador ate a primeira consulta ser agendada.
 */
const stores = new Map<string, PreferenceStore<OnboardingProgress>>();

export function onboardingProgressStore(
  organizationId: string,
  userId: string,
): PreferenceStore<OnboardingProgress> {
  const key = `atendo:onboarding:${organizationId}:${userId}`;
  let store = stores.get(key);
  if (!store) {
    store = createPreferenceStore(key, EMPTY_PROGRESS, parseProgress, (value) =>
      JSON.stringify(value),
    );
    stores.set(key, store);
  }
  return store;
}
