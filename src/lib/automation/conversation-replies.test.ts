import { describe, expect, it } from "vitest";

import { getProfession } from "@/config/professions";

import { renderReply } from "@/lib/notifications/replies";
import { hashBody } from "@/lib/notifications/templates";
import { ANCHOR, FICTITIOUS, client, organization } from "@/lib/notifications/fixtures";
import type { MessagingSender, NotificationRule } from "@/types";

import { conversationReplyId, planConversationReply } from "./conversation-replies";

/** A resposta planejada: o que vira entrega e tarefa, e quando nada vira. */

const JANELA = "2026-09-11T12:00:00.000Z";
const RESERVA = "2026-09-10T12:10:00.000Z";
const HORARIOS = [{ startsAt: "2026-09-14T11:00:00.000Z" }, { startsAt: "2026-09-14T11:30:00.000Z" }];
const ATENDIMENTO = { id: "atendimento-1", startsAt: "2026-09-15T13:00:00.000Z", professionalId: "prof-1" };

function regras(): NotificationRule[] {
  return (["RESCHEDULE_OFFERED", "RESCHEDULE_CONFIRMED", "RESCHEDULE_HANDED_OFF"] as const).map((event) => ({
    id: `${event}:WHATSAPP`,
    event,
    channel: "WHATSAPP",
    enabled: true,
    leadMinutes: 0,
    customTemplate: null,
  }));
}

const REMETENTE: MessagingSender = {
  id: "WHATSAPP",
  organizationId: "org-teste",
  channel: "WHATSAPP",
  providerId: "N8N_BRIDGE",
  providerSenderId: "1236644296208358",
  displayNumber: "+5513999990000",
  displayName: "Estúdio Exemplo",
  status: "APPROVED",
  mode: "TEST",
  testRecipients: [FICTITIOUS.phone],
  lastReason: "Remetente de teste autorizado.",
  createdAt: ANCHOR,
  createdBy: "operadora",
  updatedAt: ANCHOR,
  updatedBy: "operadora",
};

function entrada(overrides: Partial<Parameters<typeof planConversationReply>[0]> = {}) {
  const org = organization({ verifiedSenderChannels: ["WHATSAPP"], rules: regras() });
  return {
    organization: org,
    profession: getProfession(org.primaryProfession),
    client: client(),
    sender: REMETENTE,
    event: "RESCHEDULE_OFFERED" as const,
    stage: "REQUEST" as const,
    channel: "WHATSAPP" as const,
    conversation: { escalated: false, attention: "NORMAL" as const, inboundWindowEndsAt: JANELA },
    now: ANCHOR,
    validUntil: RESERVA,
    details: { slots: HORARIOS },
    inboundMessageId: "wa-wamid.remarcar",
    appointment: ATENDIMENTO,
    ...overrides,
  };
}

describe("a resposta planejada", () => {
  it("vira entrega e tarefa com o mesmo id, derivado da mensagem recebida", () => {
    const plano = planConversationReply(entrada());
    if (plano.kind !== "PLANNED") throw new Error(plano.reason);

    const id = conversationReplyId("wa-wamid.remarcar");
    expect(id).toBe("wa-wamid.remarcar-resposta");
    expect(plano.task).toMatchObject({
      id,
      deliveryId: id,
      idempotencyKey: id,
      type: "SEND_CONVERSATION_REPLY",
      status: "PLANNED",
      event: "RESCHEDULE_OFFERED",
      channel: "WHATSAPP",
      replyStage: "REQUEST",
      appointmentId: "atendimento-1",
      clientId: "cliente-1",
      scheduledFor: ANCHOR,
    });
    expect(plano.delivery).toMatchObject({ id, status: "PLANNED", ruleId: "RESCHEDULE_OFFERED:WHATSAPP" });
  });

  it("a entrega guarda a impressão do texto, e não o texto nem o destino", () => {
    const plano = planConversationReply(entrada());
    if (plano.kind !== "PLANNED") throw new Error(plano.reason);

    const texto = renderReply("RESCHEDULE_OFFERED", "REQUEST", {
      clientName: "Alex",
      organizationName: "Estúdio Exemplo",
      slots: HORARIOS,
    });
    if (!texto.ok) throw new Error(texto.error);
    expect(plano.delivery.bodyHash).toBe(hashBody(texto.value));
    expect(plano.delivery.bodyLength).toBe(texto.value.length);
    const gravado = JSON.stringify(plano);
    expect(gravado).not.toContain(FICTITIOUS.phone);
    expect(gravado).not.toContain("Alex");
    // A conversa não vai na tarefa: o id dela carrega o do cadastro.
    expect(gravado).not.toContain("wa-cliente-1");
  });

  it("a oferta vence com a reserva; as demais em 30 minutos; nenhuma passa da janela", () => {
    const oferta = planConversationReply(entrada());
    const confirmacao = planConversationReply(
      entrada({ event: "RESCHEDULE_CONFIRMED", stage: "CHOICE", validUntil: null, details: { startsAt: HORARIOS[0].startsAt } }),
    );
    const noFimDaJanela = planConversationReply(
      entrada({
        event: "RESCHEDULE_HANDED_OFF",
        validUntil: null,
        details: {},
        conversation: { escalated: false, attention: "NORMAL", inboundWindowEndsAt: "2026-09-10T12:05:00.000Z" },
      }),
    );

    expect(oferta.kind === "PLANNED" && oferta.task.expiresAt).toBe(RESERVA);
    expect(confirmacao.kind === "PLANNED" && confirmacao.task.expiresAt).toBe("2026-09-10T12:30:00.000Z");
    expect(noFimDaJanela.kind === "PLANNED" && noFimDaJanela.task.expiresAt).toBe("2026-09-10T12:05:00.000Z");
  });
});

describe("quando a resposta não é planejada", () => {
  it("pedido sem atendimento futuro fica só no alerta da equipe", () => {
    expect(planConversationReply(entrada({ event: "RESCHEDULE_HANDED_OFF", appointment: null }))).toEqual({
      kind: "SKIPPED",
      reason: "NO_APPOINTMENT",
    });
  });

  it("número sem cadastro único não recebe resposta", () => {
    expect(planConversationReply(entrada({ client: null }))).toEqual({
      kind: "SKIPPED",
      reason: "CLIENT_NOT_IDENTIFIED",
    });
  });

  it("qualquer trava do portão impede o planejamento, com o motivo dela", () => {
    expect(planConversationReply(entrada({ client: client({ appointmentNotificationsEnabled: false }) }))).toEqual({
      kind: "SKIPPED",
      reason: "MISSING_CONSENT",
    });
    expect(
      planConversationReply(
        entrada({ conversation: { escalated: true, attention: "CRITICAL", inboundWindowEndsAt: JANELA } }),
      ),
    ).toEqual({ kind: "SKIPPED", reason: "CONVERSATION_WITH_HUMAN" });
  });

  it("regra da resposta desligada: nada é planejado", () => {
    const org = organization({
      verifiedSenderChannels: ["WHATSAPP"],
      rules: regras().map((regra) => ({ ...regra, enabled: false })),
    });
    expect(planConversationReply(entrada({ organization: org }))).toEqual({ kind: "SKIPPED", reason: "RULE_DISABLED" });
  });
});
