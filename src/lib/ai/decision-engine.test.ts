import { describe, expect, it } from "vitest";
import { permissionsForRole } from "@/config/permissions";
import { getProfession } from "@/config/professions";
import { buildMockDataset } from "@/mocks";
import type { AIRule, ProfessionId } from "@/types";
import { classifyMessage } from "./classify";
import { decide, type DecisionRequest } from "./decision-engine";

const now = new Date("2026-09-09T15:00:00Z");
function request(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  const data = buildMockDataset("PSYCHOLOGIST", now);
  return {
    text: "Qual o valor da consulta?",
    profession: getProfession("PSYCHOLOGIST"),
    organization: data.organization,
    rules: data.rules,
    channel: "WEB_CHAT",
    client: null,
    now,
    professionalId: "prof-owner",
    permissions: permissionsForRole("OWNER"),
    ...overrides,
  };
}
function priceRule(overrides: Partial<AIRule> = {}): AIRule {
  return {
    ...request().rules.find((r) => r.id === "rule-pricing")!,
    ...overrides,
  };
}

describe("motor de decisao", () => {
  it("responde pergunta administrativa autorizada e registra regras fundamentais", () => {
    const result = decide(request());
    expect(result.action).toBe("AUTO_RESPONSE");
    expect(result.responseText).toContain("assistente virtual");
    expect(result.appliedRules.some((rule) => rule.level === "SECURITY")).toBe(
      true,
    );
  });
  it.each([
    "PSYCHOLOGIST",
    "PSYCHIATRIST",
    "DOCTOR",
    "DENTIST",
    "NUTRITIONIST",
    "PHYSIOTHERAPIST",
    "THERAPIST",
    "PERSONAL_TRAINER",
  ] as ProfessionId[])(
    "escala risco e conteudo sensivel em %s",
    (professionId) => {
      const data = buildMockDataset(professionId, now);
      const base = request({
        profession: getProfession(professionId),
        organization: data.organization,
        rules: data.rules,
      });
      const risk = decide({
        ...base,
        text: "Qual o valor? Nao aguento mais, quero me machucar.",
      });
      expect(risk.action).toBe("ESCALATE_TO_PROFESSIONAL");
      expect(risk.attention).toBe("CRITICAL");
      expect(risk.responseText).toBeNull();
      expect(
        decide({
          ...base,
          text: "Qual o valor? Posso mudar a dose da medicacao?",
        }).action,
      ).toBe("ESCALATE_TO_PROFESSIONAL");
    },
  );
  it("escala texto desconhecido", () => {
    const result = decide(request({ text: "Quero falar de outro assunto." }));
    expect(result.classification).toBe("UNKNOWN");
    expect(result.escalated).toBe(true);
  });
  it.each(["Quero remarcar minha consulta.", "Quero reagendar o horario."])(
    "reconhece remarcacao em %s",
    (text) => {
      expect(classifyMessage(text, getProfession("PSYCHOLOGIST")).intent).toBe(
        "RESCHEDULING",
      );
    },
  );
  it("recusa regra de outro tenant ou outro profissional", () => {
    for (const rule of [
      priceRule({ organizationId: "outro-tenant" }),
      priceRule({ professionalId: "outro-profissional" }),
    ]) {
      expect(decide(request({ rules: [rule] })).escalated).toBe(true);
    }
  });
  it("nao deixa regra inferior liberar assunto proibido", () => {
    const deny = priceRule({
      id: "deny",
      level: "PROFESSION",
      actions: [{ type: "DENY_TOPIC", payload: { topic: "PRICING" } }],
    });
    const result = decide(request({ rules: [deny, priceRule()] }));
    expect(result.escalated).toBe(true);
    expect(
      result.appliedRules.find((r) => r.ruleId === "rule-pricing")?.outcome,
    ).toBe("BLOCKED_BY_HIGHER_LEVEL");
  });
  it("usa preco e duracao estruturados da regra", () => {
    const result = decide(
      request({
        rules: [
          priceRule({
            actions: [
              {
                type: "ALLOW_TOPIC",
                payload: {
                  topic: "PRICING",
                  priceInCents: 18000,
                  durationMinutes: 50,
                },
              },
            ],
          }),
        ],
      }),
    );
    expect(result.responseText).toMatch(/180,00/);
    expect(result.responseText).toContain("50 minutos");
  });
  it("exige permissao e preserva atendimento humano", () => {
    expect(
      decide(request({ permissions: permissionsForRole("VIEWER") })).escalated,
    ).toBe(true);
    expect(decide(request({ humanHandoff: true })).escalated).toBe(true);
  });
  it("agente desligado, baixa confianca ou autorizacao ausente nao respondem", () => {
    const base = request();
    expect(decide({ ...base, rules: [] }).escalated).toBe(true);
    base.organization.settings.ai.enabled = false;
    expect(decide(base).escalated).toBe(true);
    base.organization.settings.ai.enabled = true;
    base.organization.settings.ai.autoResponseConfidenceThreshold = 0.99;
    expect(decide(base).escalated).toBe(true);
  });
  it("sugere sem enviar quando envio autonomo esta desligado", () => {
    const base = request();
    base.organization.settings.ai.allowAutonomousReplies = false;
    expect(decide(base).action).toBe("SUGGEST_RESPONSE");
  });
  it("respeita minutos e fuso na janela de silencio", () => {
    const base = request();
    base.organization.settings.ai.quietHoursStart = "21:30";
    base.organization.settings.ai.quietHoursEnd = "07:15";
    expect(
      decide({ ...base, now: new Date("2026-09-10T00:29:00Z") }).action,
    ).toBe("AUTO_RESPONSE");
    expect(
      decide({ ...base, now: new Date("2026-09-10T00:30:00Z") }).escalated,
    ).toBe(true);
    expect(
      decide({ ...base, now: new Date("2026-09-10T10:14:00Z") }).escalated,
    ).toBe(true);
    expect(
      decide({ ...base, now: new Date("2026-09-10T10:15:00Z") }).action,
    ).toBe("AUTO_RESPONSE");
  });
  it("avalia domingo pelo fuso da organizacao", () => {
    const base = request({ now: new Date("2026-09-14T01:00:00Z") });
    base.organization.settings.ai.quietHoursStart = null;
    base.rules = [
      priceRule(),
      priceRule({
        id: "domingo",
        actions: [{ type: "DENY_TOPIC", payload: null }],
        conditions: {
          combinator: "AND",
          conditions: [
            { field: "context.dayOfWeek", operator: "EQUALS", value: 0 },
          ],
        },
      }),
    ];
    expect(decide(base).escalated).toBe(true);
  });
  it("nao afirma confirmar atendimento nem inventa formas de pagamento", () => {
    const result = decide(request({ text: "Quero confirmar a consulta." }));
    expect(result.responseText).not.toContain("esta confirmado");
    const base = request({ text: "Posso pagar por pix?" });
    base.rules = base.rules.map((rule) => ({ ...rule, enabled: true }));
    expect(decide(base).responseText).toBeNull();
  });
});
