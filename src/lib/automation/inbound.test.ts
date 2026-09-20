import { describe, expect, it } from "vitest";

import {
  decideInbound,
  foldInbound,
  inboundMessageId,
  inboundWindowEndsAt,
  isOptOut,
  isWithinInboundWindow,
  normalizeInboundPhone,
  parseInboundPayload,
  type InboundEvent,
} from "./inbound";

const SENDER = "1236644296208358";
const FROM = "5513999990000";

function webhook(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1735240217540050",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15551876897", phone_number_id: SENDER },
              contacts: [{ profile: { name: "Alex" }, wa_id: FROM }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

const TEXTO = webhook({
  from: FROM,
  id: "wamid.HBgNNTU=",
  timestamp: "1789881830",
  type: "text",
  text: { body: "  Posso remarcar para sexta?  " },
});

describe("ler o corpo do webhook", () => {
  it("separa mensagem de texto, com o remetente e o instante", () => {
    expect(parseInboundPayload(TEXTO)).toEqual([
      {
        kind: "TEXT",
        providerSenderId: SENDER,
        from: FROM,
        providerMessageId: "wamid.HBgNNTU=",
        text: "Posso remarcar para sexta?",
        sentAt: "2026-09-20T05:23:50.000Z",
      },
    ]);
  });

  it("reconhece o botao pelo payload ou pelo texto, com ou sem acento", () => {
    for (const button of [{ payload: "CONFIRMAR" }, { text: "Confirmar" }]) {
      const [evento] = parseInboundPayload(
        webhook({ from: FROM, id: "wamid.1", timestamp: "1789881830", type: "button", button, context: { id: "wamid.0" } }),
      );
      expect(evento).toMatchObject({ kind: "BUTTON", button: "CONFIRM", repliedTo: "wamid.0" });
    }

    const [remarcar] = parseInboundPayload(
      webhook({ from: FROM, id: "wamid.2", timestamp: "1789881830", type: "button", button: { payload: "REMARCAR" } }),
    );
    expect(remarcar).toMatchObject({ kind: "BUTTON", button: "RESCHEDULE", repliedTo: null });
  });

  it("descarta em silencio o que nao sabe tratar, sem quebrar", () => {
    expect(parseInboundPayload(webhook({ from: FROM, id: "w", timestamp: "1", type: "image", image: {} }))).toEqual([]);
    expect(parseInboundPayload(webhook({ from: FROM, id: "w", timestamp: "1", type: "text", text: { body: "   " } }))).toEqual([]);
    expect(parseInboundPayload({ entry: [{ changes: [{ value: { metadata: {} } }] }] })).toEqual([]);
    expect(parseInboundPayload({ object: "whatsapp_business_account" })).toEqual([]);
    expect(parseInboundPayload("{}")).toEqual([]);
    expect(parseInboundPayload(null)).toEqual([]);
  });

  it("status de entrega nao vira mensagem: ele volta pela rota do resultado", () => {
    const status = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: SENDER },
                statuses: [{ id: "wamid.x", status: "delivered", recipient_id: FROM }],
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundPayload(status)).toEqual([]);
  });
});

describe("o telefone", () => {
  it("vira o formato do cadastro", () => {
    expect(normalizeInboundPhone("5513999990000")).toBe("+5513999990000");
    expect(normalizeInboundPhone("+55 13 99999-0000")).toBe("+5513999990000");
  });

  it("o que nao parece telefone nao encontra ninguem — melhor do que encontrar a pessoa errada", () => {
    expect(normalizeInboundPhone("123")).toBeNull();
    expect(normalizeInboundPhone("")).toBeNull();
    expect(normalizeInboundPhone("1".repeat(16))).toBeNull();
  });
});

describe("pedido de saida", () => {
  it("vale em qualquer capitalizacao e com acento", () => {
    for (const texto of ["sair", "SAIR", "Parar", " PARAR ", "não quero receber"]) {
      expect(isOptOut(texto), texto).toBe(true);
    }
  });

  it("frase em volta do termo nao e pedido de saida", () => {
    expect(isOptOut("parar de mandar remédio às 8h")).toBe(false);
    expect(isOptOut("posso sair mais cedo?")).toBe(false);
  });

  it("a comparacao e sobre texto sem acento", () => {
    expect(foldInbound("não quero receber")).toBe("NAO QUERO RECEBER");
  });
});

describe("o que fazer com o que chegou", () => {
  const base: InboundEvent = {
    kind: "TEXT",
    providerSenderId: SENDER,
    from: FROM,
    providerMessageId: "wamid.novo",
    text: "Bom dia, posso chegar 10 minutos atrasado?",
    sentAt: "2026-09-20T12:00:00.000Z",
  };

  it("reentrega da Meta nao vira segunda mensagem, segunda decisao nem segunda resposta", () => {
    expect(decideInbound({ event: base, knownProviderMessageIds: ["wamid.novo"], lastInboundAt: null })).toEqual({
      kind: "DUPLICATE",
    });
  });

  it("mensagem atrasada e gravada, mas nao manda na conversa", () => {
    expect(
      decideInbound({ event: base, knownProviderMessageIds: [], lastInboundAt: "2026-09-20T12:30:00.000Z" }),
    ).toEqual({ kind: "OUT_OF_ORDER" });
  });

  it("pedido de saida vale mesmo atrasado", () => {
    expect(
      decideInbound({
        event: { ...base, text: "SAIR" },
        knownProviderMessageIds: [],
        lastInboundAt: "2026-09-20T12:30:00.000Z",
      }),
    ).toEqual({ kind: "OPT_OUT" });
  });

  it("botao vira confirmacao ou remarcacao, sem passar pelo classificador", () => {
    const botao = (button: "CONFIRM" | "RESCHEDULE"): InboundEvent => ({
      kind: "BUTTON",
      providerSenderId: SENDER,
      from: FROM,
      providerMessageId: `wamid.${button}`,
      button,
      repliedTo: null,
      sentAt: base.sentAt,
    });

    expect(decideInbound({ event: botao("CONFIRM"), knownProviderMessageIds: [], lastInboundAt: null })).toEqual({
      kind: "CONFIRM",
    });
    expect(decideInbound({ event: botao("RESCHEDULE"), knownProviderMessageIds: [], lastInboundAt: null })).toEqual({
      kind: "RESCHEDULE",
    });
  });

  it("texto comum vai ao motor de decisao", () => {
    expect(decideInbound({ event: base, knownProviderMessageIds: [], lastInboundAt: "2026-09-20T11:00:00.000Z" })).toEqual({
      kind: "CLASSIFY",
    });
  });
});

describe("a janela de 24 horas", () => {
  it("abre com a mensagem da pessoa e fecha 24 horas depois", () => {
    const fim = inboundWindowEndsAt("2026-09-20T12:00:00.000Z");
    expect(fim).toBe("2026-09-21T12:00:00.000Z");
    expect(isWithinInboundWindow(fim, "2026-09-21T11:59:59.000Z")).toBe(true);
    expect(isWithinInboundWindow(fim, "2026-09-21T12:00:00.000Z")).toBe(false);
    expect(isWithinInboundWindow(null, "2026-09-20T12:00:00.000Z")).toBe(false);
  });
});

describe("a identidade da mensagem", () => {
  it("deriva do id da Meta, sem caractere que estrague caminho de documento", () => {
    expect(inboundMessageId("wamid.HBgNNTU=")).toBe("wa-wamidHBgNNTU");
    expect(inboundMessageId("../outro/caminho")).toBe("wa-outrocaminho");
  });
});
