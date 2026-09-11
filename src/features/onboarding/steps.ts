/**
 * Primeira configuracao de uma organizacao que nasceu vazia.
 *
 * Funcao pura: o que esta feito sai dos dados (ha cadastro? ha atendimento?) e
 * das duas confirmacoes que so a pessoa pode dar (a profissao esta certa, o
 * horario serve). Nada aqui grava no banco — o guia nao tem permissao
 * nenhuma alem das que cada passo ja exige.
 */

export const ONBOARDING_STEP_IDS = ["profession", "agenda", "client", "appointment"] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/** Confirmacoes guardadas no navegador, por organizacao e pessoa. */
export interface OnboardingProgress {
  confirmed: OnboardingStepId[];
  dismissed: boolean;
}

export const EMPTY_PROGRESS: OnboardingProgress = { confirmed: [], dismissed: false };

export interface OnboardingInput {
  clients: number;
  appointments: number;
  canCreateClient: boolean;
  canCreateAppointment: boolean;
  progress: OnboardingProgress;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
  /**
   * `false` quando o cadastro da pessoa nao libera o modulo do passo: ele
   * aparece explicado, mas nao conta, porque ela nao tem como concluir.
   */
  available: boolean;
}

export function onboardingSteps(input: OnboardingInput): OnboardingStep[] {
  const confirmed = new Set(input.progress.confirmed);
  // Quem ja agendou esta usando a agenda: pedir para confirmar a profissao ou
  // o horario depois disso seria burocracia.
  const inUse = input.appointments > 0;

  return [
    { id: "profession", done: confirmed.has("profession") || inUse, available: true },
    { id: "agenda", done: confirmed.has("agenda") || inUse, available: true },
    { id: "client", done: input.clients > 0, available: input.canCreateClient },
    {
      id: "appointment",
      done: input.appointments > 0,
      available: input.canCreateAppointment,
    },
  ];
}

export function onboardingSummary(steps: OnboardingStep[]): {
  done: number;
  total: number;
  complete: boolean;
} {
  const counted = steps.filter((step) => step.available);
  const done = counted.filter((step) => step.done).length;
  return { done, total: counted.length, complete: done === counted.length };
}

export function shouldShowOnboarding(input: OnboardingInput): boolean {
  if (input.progress.dismissed) return false;
  return !onboardingSummary(onboardingSteps(input)).complete;
}

export function parseProgress(raw: string): OnboardingProgress | null {
  try {
    const value = JSON.parse(raw) as Partial<OnboardingProgress>;
    const confirmed = Array.isArray(value.confirmed)
      ? value.confirmed.filter((id): id is OnboardingStepId =>
          (ONBOARDING_STEP_IDS as readonly string[]).includes(id),
        )
      : [];
    return { confirmed, dismissed: value.dismissed === true };
  } catch {
    return null;
  }
}
