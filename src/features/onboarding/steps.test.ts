import { describe, expect, it } from "vitest";

import {
  EMPTY_PROGRESS,
  onboardingSteps,
  onboardingSummary,
  parseProgress,
  shouldShowOnboarding,
  type OnboardingInput,
} from "./steps";

function input(patch: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    clients: 0,
    appointments: 0,
    canCreateClient: true,
    canCreateAppointment: true,
    progress: EMPTY_PROGRESS,
    ...patch,
  };
}

describe("primeira configuracao", () => {
  it("comeca com os quatro passos pendentes numa organizacao vazia", () => {
    const steps = onboardingSteps(input());
    expect(steps.map((step) => step.id)).toEqual(["profession", "agenda", "client", "appointment"]);
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(shouldShowOnboarding(input())).toBe(true);
  });

  it("conclui cadastro e atendimento pelos dados, e os outros pela confirmacao", () => {
    const partial = input({ clients: 1, progress: { confirmed: ["profession"], dismissed: false } });
    expect(onboardingSummary(onboardingSteps(partial))).toEqual({ done: 2, total: 4, complete: false });

    const all = input({ clients: 1, appointments: 1 });
    expect(onboardingSummary(onboardingSteps(all)).complete).toBe(true);
    expect(shouldShowOnboarding(all)).toBe(false);
  });

  it("nao conta passo de modulo que o cadastro nao libera", () => {
    const withoutClients = input({ canCreateClient: false, canCreateAppointment: false, progress: { confirmed: ["profession", "agenda"], dismissed: false } });
    expect(onboardingSummary(onboardingSteps(withoutClients))).toEqual({ done: 2, total: 2, complete: true });
  });

  it("some quando a pessoa dispensa o guia", () => {
    expect(shouldShowOnboarding(input({ progress: { confirmed: [], dismissed: true } }))).toBe(false);
  });

  it("le progresso salvo sem confiar no formato", () => {
    expect(parseProgress('{"confirmed":["agenda","inventado"],"dismissed":true}')).toEqual({ confirmed: ["agenda"], dismissed: true });
    expect(parseProgress("nao e json")).toBeNull();
    expect(parseProgress("{}")).toEqual(EMPTY_PROGRESS);
  });
});
