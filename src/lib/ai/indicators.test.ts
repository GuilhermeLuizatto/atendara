import { describe, expect, it } from "vitest";

import { classificationsFor } from "@/config/professions";
import type { AIDecision, AIDecisionReview, NotificationDelivery } from "@/types";

import {
  summarizeClassifier,
  summarizeReplyDeliveries,
  summarizeReviews,
} from "./analytics";
import {
  buildDecisionReview,
  decisionReviewAuditSummary,
  validateDecisionReview,
} from "./decision-review";

/**
 * Indicadores da Fase 4: acerto so sobre o que foi revisado, uso do Gemini e
 * entrega das respostas da Dara em degraus separados.
 */

const filter = {
  organizationId: "org",
  from: new Date("2026-09-01T00:00:00Z"),
  until: new Date("2026-09-30T00:00:00Z"),
};

const decision = (id: string, patch: Partial<AIDecision> = {}): AIDecision => ({
  id,
  organizationId: "org",
  conversationId: "c",
  messageId: `m-${id}`,
  clientId: null,
  professionalId: "p1",
  inputPreview: "",
  classification: "ADMINISTRATIVE",
  confidence: 0.9,
  appliedRules: [],
  action: "AUTO_RESPONSE",
  responseText: null,
  reason: "",
  attention: "NORMAL",
  escalated: false,
  engineVersion: "1",
  decidedAt: "2026-09-10T10:00:00Z",
  latencyMs: 10,
  createdAt: "2026-09-10T10:00:00Z",
  updatedAt: "2026-09-10T10:00:00Z",
  createdBy: null,
  updatedBy: null,
  ...patch,
});

const gemini = (patch: Partial<NonNullable<AIDecision["classifier"]>> = {}): NonNullable<AIDecision["classifier"]> => ({
  provider: "GEMINI",
  status: "SUCCEEDED",
  model: "gemini-3.1-flash-lite",
  promptVersion: "v1",
  inputTokens: 100,
  outputTokens: 20,
  thinkingTokens: 5,
  latencyMs: 300,
  ...patch,
});

const review = (decisionId: string, patch: Partial<AIDecisionReview> = {}): AIDecisionReview => ({
  id: decisionId,
  organizationId: "org",
  decisionId,
  verdict: "CORRECT",
  expectedClassification: null,
  createdAt: "2026-09-11T10:00:00Z",
  updatedAt: "2026-09-11T10:00:00Z",
  createdBy: "owner",
  updatedBy: "owner",
  ...patch,
});

const delivery = (id: string, patch: Partial<NotificationDelivery> = {}): NotificationDelivery => ({
  id,
  organizationId: "org",
  audience: "ORGANIZATION_TO_CLIENT",
  event: "RESCHEDULE_OFFERED",
  channel: "WHATSAPP",
  ruleId: "r",
  appointmentId: "a",
  clientId: "cl",
  professionalId: "p1",
  scheduledFor: "2026-09-10T10:00:00Z",
  status: "SENT",
  attempts: 1,
  lastAttemptAt: null,
  nextAttemptAt: null,
  providerId: "N8N_BRIDGE",
  providerMessageId: "wamid",
  failureCode: null,
  templateId: "t",
  bodyHash: "abcdef12",
  bodyLength: 10,
  contactHint: "***0000",
  sentAt: "2026-09-10T10:00:01Z",
  deliveredAt: null,
  readAt: null,
  cancelledAt: null,
  createdAt: "2026-09-10T10:00:00Z",
  updatedAt: "2026-09-10T10:00:00Z",
  createdBy: null,
  updatedBy: null,
  ...patch,
});

describe("validação da revisão", () => {
  const classifications = classificationsFor("PSYCHOLOGIST");

  it("correta zera a classificação esperada", () => {
    expect(
      validateDecisionReview(decision("d"), { verdict: "CORRECT", expectedClassification: "CLINICAL" }, classifications),
    ).toEqual({ ok: true, value: { verdict: "CORRECT", expectedClassification: null } });
  });

  it("errada exige outra classificação, da profissão", () => {
    const d = decision("d");
    expect(validateDecisionReview(d, { verdict: "INCORRECT", expectedClassification: null }, classifications).ok).toBe(false);
    expect(validateDecisionReview(d, { verdict: "INCORRECT", expectedClassification: "ADMINISTRATIVE" }, classifications).ok).toBe(false);
    expect(validateDecisionReview(d, { verdict: "INCORRECT", expectedClassification: "CLINICAL" }, ["ADMINISTRATIVE", "UNKNOWN"]).ok).toBe(false);
    expect(validateDecisionReview(d, { verdict: "INCORRECT", expectedClassification: "UNKNOWN" }, classifications).ok).toBe(true);
  });

  it("recusa veredito fora da lista", () => {
    expect(
      validateDecisionReview(decision("d"), { verdict: "TALVEZ" as never, expectedClassification: null }, classifications).ok,
    ).toBe(false);
  });

  it("corrigir preserva a primeira revisão e o texto da trilha nomeia a classificação", () => {
    const first = review("d");
    const built = buildDecisionReview(decision("d"), { verdict: "INCORRECT", expectedClassification: "UNKNOWN" }, first, {
      now: "2026-09-12T10:00:00Z",
      userId: "admin",
    });
    expect(built).toMatchObject({ createdAt: first.createdAt, createdBy: "owner", updatedAt: "2026-09-12T10:00:00Z", updatedBy: "admin" });
    expect(decisionReviewAuditSummary(built)).toContain("errada");
  });
});

describe("acerto nas revisadas", () => {
  it("decisão sem revisão fica fora do denominador; vazio não vira 0%", () => {
    const stats = summarizeReviews([decision("a"), decision("b"), decision("c")], [review("a")], filter);
    expect(stats).toMatchObject({ decisions: 3, reviewed: 1, correct: 1, accuracy: 1 });
    expect(summarizeReviews([decision("a")], [], filter).accuracy).toBeNull();
  });

  it("separa Gemini de local e agrupa os erros por par previsto → esperado", () => {
    const stats = summarizeReviews(
      [
        decision("g1", { classifier: gemini() }),
        decision("g2", { classifier: gemini() }),
        decision("l1", { classifier: gemini({ status: "UNAVAILABLE" }) }),
        decision("l2"),
      ],
      [
        review("g1"),
        review("g2", { verdict: "INCORRECT", expectedClassification: "CLINICAL" }),
        review("l1", { verdict: "INCORRECT", expectedClassification: "CLINICAL" }),
        review("l2"),
      ],
      filter,
    );
    expect(stats.accuracy).toBe(0.5);
    expect(stats.bySource.GEMINI).toEqual({ reviewed: 2, correct: 1, accuracy: 0.5 });
    // Gemini indisponível: a classificação que valeu foi a local.
    expect(stats.bySource.LOCAL).toEqual({ reviewed: 2, correct: 1, accuracy: 0.5 });
    expect(stats.mistakes).toEqual([{ predicted: "ADMINISTRATIVE", expected: "CLINICAL", count: 2 }]);
  });

  it("respeita tenant, período e profissional da decisão", () => {
    const stats = summarizeReviews(
      [
        decision("fora", { decidedAt: "2026-08-01T00:00:00Z" }),
        decision("outro", { organizationId: "x" }),
        decision("p2", { professionalId: "p2" }),
      ],
      [review("fora"), review("outro", { organizationId: "x" }), review("p2")],
      { ...filter, professionalId: "p1" },
    );
    expect(stats.reviewed).toBe(0);
  });
});

describe("uso do Gemini", () => {
  it("conta por situação e soma tokens só do Gemini", () => {
    const stats = summarizeClassifier(
      [
        decision("a", { classifier: gemini() }),
        decision("b", { classifier: gemini({ status: "UNAVAILABLE", model: null, inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }) }),
        decision("c", { classifier: { ...gemini(), provider: "LOCAL", status: "DISABLED", model: null } }),
        decision("d"),
      ],
      filter,
    );
    expect(stats.statuses).toEqual({ SUCCEEDED: 1, UNAVAILABLE: 1, DISABLED: 1, NOT_RECORDED: 1 });
    expect(stats.tokens).toEqual({ input: 100, output: 20, thinking: 5 });
    expect(stats.models).toEqual(["gemini-3.1-flash-lite"]);
  });
});

describe("entrega das respostas da Dara", () => {
  it("ignora lembretes da agenda e separa aceito, entregue, lido e simulado", () => {
    const stats = summarizeReplyDeliveries(
      [
        delivery("lembrete", { event: "APPOINTMENT_REMINDER" }),
        delivery("aceito"),
        delivery("entregue", { deliveredAt: "2026-09-10T10:00:02Z" }),
        delivery("lido", { event: "RESCHEDULE_CONFIRMED", deliveredAt: "2026-09-10T10:00:02Z", readAt: "2026-09-10T10:05:00Z" }),
        delivery("simulado", { providerId: "SIMULATED", deliveredAt: "2026-09-10T10:00:02Z" }),
        delivery("falhou", { status: "FAILED", failureCode: "OUTSIDE_REPLY_WINDOW", sentAt: null }),
        delivery("pendente", { status: "PLANNED", sentAt: null }),
        delivery("cancelado", { status: "CANCELLED", sentAt: null }),
      ],
      filter,
    );
    expect(stats).toMatchObject({
      total: 7,
      sent: 4,
      accepted: 3,
      simulated: 1,
      delivered: 2,
      read: 1,
      failed: 1,
      pending: 1,
      cancelled: 1,
      failures: { OUTSIDE_REPLY_WINDOW: 1 },
      events: { RESCHEDULE_OFFERED: 6, RESCHEDULE_CONFIRMED: 1 },
    });
  });

  it("respeita tenant, período, profissional e duplicata", () => {
    const d = delivery("a");
    const stats = summarizeReplyDeliveries(
      [
        d,
        d,
        delivery("outro", { organizationId: "x" }),
        delivery("velho", { scheduledFor: "2026-08-01T00:00:00Z" }),
        delivery("p2", { professionalId: "p2" }),
      ],
      { ...filter, professionalId: "p1" },
    );
    expect(stats.total).toBe(1);
  });
});
