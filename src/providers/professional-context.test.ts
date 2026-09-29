import { describe, expect, it } from "vitest";

import type { Professional } from "@/types";
import { buildMockDataset } from "@/mocks";

import {
  availableProfessionalContexts,
  resolveActiveProfessionalId,
  snapshotForProfessional,
} from "./professional-context";

const professionals = [
  { id: "a", active: true },
  { id: "b", active: true },
  { id: "c", active: false },
] as Professional[];

describe("contexto profissional", () => {
  it("oferece todos os perfis ativos para escopo organizacional", () => {
    expect(
      availableProfessionalContexts(professionals, {
        organizationWide: true,
        professionalIds: [],
      }).map((item) => item.id),
    ).toEqual(["a", "b"]);
  });

  it("oferece somente vínculos ativos no escopo restrito", () => {
    expect(
      availableProfessionalContexts(professionals, {
        organizationWide: false,
        professionalIds: ["b", "c"],
      }).map((item) => item.id),
    ).toEqual(["b"]);
  });

  it("troca imediatamente uma preferência que perdeu o vínculo", () => {
    expect(resolveActiveProfessionalId("a", professionals.slice(1, 2))).toBe("b");
    expect(resolveActiveProfessionalId("a", [])).toBeNull();
  });

  it("não combina coleções operacionais de profissionais diferentes", () => {
    const snapshot = buildMockDataset(
      "PSYCHOLOGIST",
      new Date("2026-09-29T12:00:00.000Z"),
    );
    const active = snapshot.professionals[0].id;
    const scoped = snapshotForProfessional(snapshot, active);

    expect(
      scoped.clients.every((client) =>
        client.assignedProfessionalIds.includes(active),
      ),
    ).toBe(true);
    for (const collection of [
      scoped.appointments,
      scoped.conversations,
      scoped.messages,
      scoped.transactions,
      scoped.decisions,
      scoped.notifications,
      scoped.notificationDeliveries,
      scoped.automationTasks,
    ]) {
      expect(collection.every((item) => item.professionalId === active)).toBe(true);
    }
    expect(
      scoped.rules.every(
        (rule) => rule.professionalId == null || rule.professionalId === active,
      ),
    ).toBe(true);
  });
});
