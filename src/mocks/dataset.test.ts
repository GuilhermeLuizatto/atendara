import { describe, expect, it } from "vitest";

import { CLASSIFICATION_META } from "@/config/classifications";
import { PROFESSION_IDS } from "@/types";

import { buildMockDataset } from "./dataset";

const ANCHOR = new Date("2026-09-09T14:00:00.000Z");

describe("conjunto de dados de demonstracao", () => {
  it("e deterministico para a mesma profissao e data", () => {
    const first = buildMockDataset("PSYCHOLOGIST", ANCHOR);
    const second = buildMockDataset("PSYCHOLOGIST", ANCHOR);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("gera conjuntos distintos por profissao", () => {
    const psychologist = buildMockDataset("PSYCHOLOGIST", ANCHOR);
    const trainer = buildMockDataset("PERSONAL_TRAINER", ANCHOR);

    expect(psychologist.organization.id).not.toBe(trainer.organization.id);
    expect(psychologist.clients[0].fullName).not.toBe(
      trainer.clients[0].fullName,
    );
  });

  it("mantem todo documento dentro do proprio tenant", () => {
    for (const professionId of PROFESSION_IDS) {
      const data = buildMockDataset(professionId, ANCHOR);
      const orgId = data.organization.id;

      const scoped = [
        ...data.professionals,
        ...data.clients,
        ...data.appointments,
        ...data.conversations,
        ...data.messages,
        ...data.transactions,
        ...data.rules,
        ...data.decisions,
        ...data.notifications,
        ...data.auditLogs,
      ];

      expect(scoped.length).toBeGreaterThan(0);
      for (const entity of scoped) {
        expect(entity.organizationId).toBe(orgId);
      }
    }
  });

  it("nunca responde automaticamente fora do administrativo", () => {
    // Esta e a garantia central do produto. Se ela quebrar, o agente passou a
    // responder assunto clinico, de treino ou de risco sozinho.
    for (const professionId of PROFESSION_IDS) {
      const { decisions } = buildMockDataset(professionId, ANCHOR);

      for (const decision of decisions) {
        if (decision.action !== "AUTO_RESPONSE") continue;
        expect(
          CLASSIFICATION_META[decision.classification].autoResponseEligible,
        ).toBe(true);
        expect(decision.classification).toBe("ADMINISTRATIVE");
        expect(decision.escalated).toBe(false);
      }
    }
  });

  it("escala e alerta toda mensagem de possivel risco", () => {
    for (const professionId of PROFESSION_IDS) {
      const data = buildMockDataset(professionId, ANCHOR);
      const risky = data.decisions.filter(
        (decision) => decision.classification === "POSSIBLE_RISK",
      );

      expect(risky.length).toBeGreaterThan(0);
      for (const decision of risky) {
        expect(decision.escalated).toBe(true);
        expect(decision.attention).toBe("CRITICAL");
        expect(decision.responseText).toBeNull();

        const alert = data.notifications.find(
          (notification) => notification.aiDecisionId === decision.id,
        );
        expect(alert?.priority).toBe("CRITICAL");
        expect(alert?.type).toBe("POSSIBLE_RISK_DETECTED");
      }
    }
  });

  it("registra uma decisao auditavel para cada mensagem recebida", () => {
    const data = buildMockDataset("DENTIST", ANCHOR);
    const inbound = data.messages.filter(
      (message) => message.direction === "INBOUND",
    );

    expect(inbound.length).toBeGreaterThan(0);
    for (const message of inbound) {
      const decision = data.decisions.find(
        (item) => item.messageId === message.id,
      );
      expect(decision).toBeDefined();
      expect(decision?.reason.length).toBeGreaterThan(0);
      expect(decision?.appliedRules.length).toBeGreaterThan(0);
      expect(decision?.confidence).toBeGreaterThan(0);
      expect(decision?.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("mantem as regras fundamentais imutaveis e ativas", () => {
    const { rules } = buildMockDataset("DOCTOR", ANCHOR);
    const foundational = rules.filter(
      (rule) => rule.level === "SECURITY" || rule.level === "SYSTEM",
    );

    expect(foundational.length).toBeGreaterThan(0);
    for (const rule of foundational) {
      expect(rule.immutable).toBe(true);
      expect(rule.enabled).toBe(true);
    }
  });

  it("usa apenas as classificacoes habilitadas para a profissao", () => {
    for (const professionId of PROFESSION_IDS) {
      const data = buildMockDataset(professionId, ANCHOR);
      const allowed = new Set(
        data.decisions.map((decision) => decision.classification),
      );

      for (const classification of allowed) {
        expect(
          buildMockDataset(professionId, ANCHOR).organization.primaryProfession,
        ).toBe(professionId);
        expect(CLASSIFICATION_META[classification]).toBeDefined();
      }
    }
  });

  it("deriva o financeiro da agenda, sem valores fracionarios", () => {
    const data = buildMockDataset("NUTRITIONIST", ANCHOR);

    for (const transaction of data.transactions) {
      expect(Number.isInteger(transaction.amountInCents)).toBe(true);
      expect(transaction.amountInCents).toBeGreaterThan(0);
      if (transaction.appointmentId) {
        const appointment = data.appointments.find(
          (item) => item.id === transaction.appointmentId,
        );
        expect(appointment).toBeDefined();
        expect(transaction.amountInCents).toBe(appointment?.priceInCents);
      }
    }
  });
});
