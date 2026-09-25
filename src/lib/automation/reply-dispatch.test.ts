import { describe, expect, it } from "vitest";

import { getProfession } from "@/config/professions";
import { ANCHOR, FICTITIOUS, appointment, client, consent, consentRecord, organization } from "@/lib/notifications/fixtures";
import type { Conversation, MessagingSender, NotificationRule } from "@/types";

import { planConversationReply } from "./conversation-replies";
import { decideReplyDispatch, type ReplyDispatchInput, type ReplyOffer } from "./dispatch";

/**
 * O envio da resposta da assistente (etapa 4). Tarefa e entrega nascem do
 * próprio planejamento, com a mesma impressão de texto que o webhook grava; o
 * despachante confere tudo de novo contra o estado do instante do envio.
 */

const JANELA = "2026-09-11T12:00:00.000Z";
const RESERVA = "2026-09-10T12:10:00.000Z";
const LOGO_DEPOIS = "2026-09-10T12:00:05.000Z";
const HORARIOS = [
  { startsAt: "2026-09-14T11:00:00.000Z", endsAt: "2026-09-14T11:50:00.000Z" },
  { startsAt: "2026-09-14T11:30:00.000Z", endsAt: "2026-09-14T12:20:00.000Z" },
];

const REGRAS: NotificationRule[] = (["RESCHEDULE_OFFERED", "RESCHEDULE_CONFIRMED", "RESCHEDULE_HANDED_OFF"] as const).map(
  (event) => ({ id: `${event}:WHATSAPP`, event, channel: "WHATSAPP", enabled: true, leadMinutes: 0, customTemplate: null }),
);

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

const ORGANIZACAO = organization({ verifiedSenderChannels: ["WHATSAPP"], rules: REGRAS });
const CONVERSA: Pick<Conversation, "escalated" | "attention" | "inboundWindowEndsAt"> = {
  escalated: false,
  attention: "NORMAL",
  inboundWindowEndsAt: JANELA,
};
const OFERTA: ReplyOffer = { status: "OFFERED", appointmentId: "atendimento-1", slots: HORARIOS, holdEndsAt: RESERVA };

/** Tarefa e entrega como o webhook gravaria. */
function planejado(
  event: "RESCHEDULE_OFFERED" | "RESCHEDULE_CONFIRMED" | "RESCHEDULE_HANDED_OFF" = "RESCHEDULE_OFFERED",
) {
  const atendimento = appointment();
  const plano = planConversationReply({
    organization: ORGANIZACAO,
    profession: getProfession(ORGANIZACAO.primaryProfession),
    client: client(),
    sender: REMETENTE,
    event,
    stage: event === "RESCHEDULE_OFFERED" ? "REQUEST" : "CHOICE",
    channel: "WHATSAPP",
    conversation: CONVERSA,
    now: ANCHOR,
    validUntil: event === "RESCHEDULE_OFFERED" ? RESERVA : null,
    details: event === "RESCHEDULE_OFFERED" ? { slots: HORARIOS } : { startsAt: atendimento.startsAt },
    inboundMessageId: "wa-wamid.pedido",
    appointment: atendimento,
  });
  if (plano.kind !== "PLANNED") throw new Error(plano.reason);
  return plano;
}

function entrada(
  plano: ReturnType<typeof planejado>,
  overrides: Partial<ReplyDispatchInput> = {},
): ReplyDispatchInput {
  return {
    payload: { version: 2, organizationId: "org-teste", taskId: plano.task.id, attempt: 1 },
    task: { ...plano.task, status: "SCHEDULED" },
    delivery: plano.delivery,
    organization: ORGANIZACAO,
    profession: getProfession(ORGANIZACAO.primaryProfession),
    appointment: appointment(),
    client: client(),
    professionalName: "Sam Fictício",
    sender: REMETENTE,
    switches: { organization: null, global: null },
    now: LOGO_DEPOIS,
    conversation: CONVERSA,
    offer: OFERTA,
    ...overrides,
  };
}

function parouPor(passo: ReturnType<typeof decideReplyDispatch>) {
  if (passo.kind !== "STOP") return passo.kind;
  return passo.task.stopReason ?? passo.task.status;
}

describe("a resposta sai", () => {
  it("a oferta sai como texto, para o contato do cadastro, com o texto planejado", () => {
    const plano = planejado();
    const passo = decideReplyDispatch(entrada(plano));

    if (passo.kind !== "SEND") throw new Error(passo.kind);
    expect(passo.task.status).toBe("DISPATCHING");
    expect(passo.delivery.status).toBe("SENDING");
    expect(passo.request).toMatchObject({
      freeText: true,
      destination: FICTITIOUS.phone,
      channel: "WHATSAPP",
      providerSenderId: "1236644296208358",
      taskId: plano.task.id,
    });
    expect(passo.request.template).toBeUndefined();
    expect(passo.request.body).toContain("1. segunda-feira, 14 de setembro, às 08:00");
  });

  it("a confirmação e o encaminhamento também saem", () => {
    expect(decideReplyDispatch(entrada(planejado("RESCHEDULE_CONFIRMED"))).kind).toBe("SEND");
    expect(decideReplyDispatch(entrada(planejado("RESCHEDULE_HANDED_OFF"))).kind).toBe("SEND");
  });
});

describe("o que mudou entre planejar e enviar para a resposta", () => {
  it("oferta já respondida, substituída ou de outro atendimento", () => {
    const plano = planejado();
    expect(parouPor(decideReplyDispatch(entrada(plano, { offer: { ...OFERTA, status: "CONFIRMED" } })))).toBe(
      "OFFER_CLOSED",
    );
    expect(parouPor(decideReplyDispatch(entrada(plano, { offer: null })))).toBe("OFFER_CLOSED");
    expect(
      parouPor(decideReplyDispatch(entrada(plano, { offer: { ...OFERTA, appointmentId: "outro-atendimento" } }))),
    ).toBe("OFFER_CLOSED");
  });

  it("oferta com horários diferentes dos planejados não sai com o texto novo", () => {
    const outros = [{ startsAt: "2026-09-15T11:00:00.000Z", endsAt: "2026-09-15T11:50:00.000Z" }];
    expect(parouPor(decideReplyDispatch(entrada(planejado(), { offer: { ...OFERTA, slots: outros } })))).toBe(
      "BODY_CHANGED",
    );
  });

  it("reserva vencida: a tarefa vence junto", () => {
    const passo = decideReplyDispatch(entrada(planejado(), { now: "2026-09-10T12:10:01.000Z" }));
    expect(passo.kind === "STOP" && passo.task.status).toBe("EXPIRED");
  });

  it("consentimento retirado depois do pedido", () => {
    const retirado = client({
      notificationConsent: consent({
        WHATSAPP: [
          consentRecord({ withdrawn: { at: ANCHOR, recordedBy: { kind: "SUBJECT", userId: null }, medium: "MESSAGE" } }),
        ],
      }),
    });
    expect(parouPor(decideReplyDispatch(entrada(planejado(), { client: retirado })))).toBe("CONSENT_REVOKED");
  });

  it("conversa assumida pela equipe, ou marcada como crítica, depois do pedido", () => {
    const plano = planejado();
    expect(parouPor(decideReplyDispatch(entrada(plano, { conversation: { ...CONVERSA, escalated: true } })))).toBe(
      "CONVERSATION_WITH_HUMAN",
    );
    expect(
      parouPor(decideReplyDispatch(entrada(plano, { conversation: { ...CONVERSA, attention: "CRITICAL" } }))),
    ).toBe("CONVERSATION_WITH_HUMAN");
  });

  it("sem conversa não há janela conhecida", () => {
    expect(parouPor(decideReplyDispatch(entrada(planejado(), { conversation: null })))).toBe("REPLY_WINDOW_CLOSED");
  });

  it("confirmação de um horário que a equipe mudou depois da escolha", () => {
    const passo = decideReplyDispatch(
      entrada(planejado("RESCHEDULE_CONFIRMED"), {
        appointment: appointment({ startsAt: "2026-09-16T13:00:00.000Z", endsAt: "2026-09-16T13:50:00.000Z" }),
      }),
    );
    expect(parouPor(passo)).toBe("BODY_CHANGED");
  });

  it("cadastro trocado ou atendimento sumido", () => {
    const plano = planejado();
    expect(parouPor(decideReplyDispatch(entrada(plano, { client: client({ id: "outra-pessoa" }) })))).toBe(
      "CLIENT_NOT_FOUND",
    );
    expect(parouPor(decideReplyDispatch(entrada(plano, { appointment: null })))).toBe("APPOINTMENT_NOT_FOUND");
  });

  it("regra desligada ou remetente revogado depois do pedido", () => {
    const plano = planejado();
    const semRegra = organization({
      verifiedSenderChannels: ["WHATSAPP"],
      rules: REGRAS.map((regra) => ({ ...regra, enabled: false })),
    });
    expect(parouPor(decideReplyDispatch(entrada(plano, { organization: semRegra })))).toBe("RULE_DISABLED");
    expect(parouPor(decideReplyDispatch(entrada(plano, { sender: { ...REMETENTE, status: "REJECTED" } })))).toBe(
      "SENDER_NOT_APPROVED",
    );
  });

  it("chave de emergência desligada: a resposta espera, não é cancelada", () => {
    const passo = decideReplyDispatch(
      entrada(planejado(), {
        switches: { organization: { enabled: false, reason: "teste", changedAt: ANCHOR, changedBy: "dono" }, global: null },
      }),
    );
    expect(passo.kind).toBe("REQUEUE");
  });

  it("toda parada cancela a entrega junto e deixa trilha", () => {
    const passo = decideReplyDispatch(entrada(planejado(), { offer: null }));
    if (passo.kind !== "STOP") throw new Error(passo.kind);
    expect(passo.task.status).toBe("CANCELLED");
    expect(passo.delivery?.status).toBe("CANCELLED");
    expect(passo.effects.map((efeito) => efeito.kind)).toContain("WRITE_AUDIT");
  });
});
