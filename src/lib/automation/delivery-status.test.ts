import { describe, expect, it } from "vitest";

import {
  deliveryStatusFields,
  parseDeliveryStatuses,
  type DeliveryStatusEvent,
} from "./delivery-status";

function corpo(statuses: unknown[], phoneNumberId = "123456789") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              statuses,
            },
          },
        ],
      },
    ],
  };
}

const ENTREGA = {
  status: "SENT" as const,
  deliveredAt: null,
  readAt: null,
  failureCode: null,
};

function evento(patch: Partial<DeliveryStatusEvent> = {}): DeliveryStatusEvent {
  return {
    providerSenderId: "123456789",
    providerMessageId: "wamid.1",
    kind: "DELIVERED",
    occurredAt: "2026-11-19T12:00:00.000Z",
    failureCode: null,
    ...patch,
  };
}

describe("o progresso de entrega contado pela Meta", () => {
  it("lê entregue, lido e falha, com o horário em ISO", () => {
    const eventos = parseDeliveryStatuses(
      corpo([
        { id: "wamid.1", status: "delivered", timestamp: "1795000000" },
        { id: "wamid.2", status: "read", timestamp: "1795000060" },
        {
          id: "wamid.3",
          status: "failed",
          timestamp: "1795000120",
          errors: [{ code: 131026, title: "Message undeliverable" }],
        },
      ]),
    );

    expect(eventos.map((e) => e.kind)).toEqual(["DELIVERED", "READ", "FAILED"]);
    expect(eventos[0].occurredAt).toBe(new Date(1795000000 * 1000).toISOString());
    expect(eventos[0].providerSenderId).toBe("123456789");
    expect(eventos[2].failureCode).toBe("INVALID_DESTINATION");
  });

  it("a janela fechada chega como recusa nomeada, e não como destino inválido", () => {
    const [um] = parseDeliveryStatuses(
      corpo([
        {
          id: "wamid.1",
          status: "failed",
          timestamp: "1795000000",
          errors: [{ code: 131047 }],
        },
      ]),
    );

    expect(um.failureCode).toBe("OUTSIDE_REPLY_WINDOW");
  });

  it("descarta o que não reconhece, em vez de inventar progresso", () => {
    expect(parseDeliveryStatuses(null)).toEqual([]);
    expect(parseDeliveryStatuses({ entry: "nao e lista" })).toEqual([]);
    expect(parseDeliveryStatuses(corpo([{ id: "wamid.1" }]))).toEqual([]);
    expect(
      parseDeliveryStatuses(
        corpo([{ id: "wamid.1", status: "inventado", timestamp: "1795000000" }]),
      ),
    ).toEqual([]);
    expect(
      parseDeliveryStatuses(
        corpo([{ id: "wamid.1", status: "read", timestamp: "ontem" }]),
      ),
    ).toEqual([]);
    expect(
      parseDeliveryStatuses(
        corpo([{ id: "com espaço", status: "read", timestamp: "1795000000" }]),
      ),
    ).toEqual([]);
  });

  it("mensagem e progresso no mesmo corpo não se confundem", () => {
    const misto = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "123456789" },
                messages: [
                  {
                    id: "wamid.msg",
                    from: "5513999990000",
                    timestamp: "1795000000",
                    type: "text",
                    text: { body: "oi" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(parseDeliveryStatuses(misto)).toEqual([]);
  });

  it("entregue carimba uma vez só: reentrega não move o horário", () => {
    expect(deliveryStatusFields(ENTREGA, evento())).toEqual({
      deliveredAt: "2026-11-19T12:00:00.000Z",
    });
    expect(
      deliveryStatusFields(
        { ...ENTREGA, deliveredAt: "2026-11-19T11:00:00.000Z" },
        evento(),
      ),
    ).toEqual({});
  });

  it("lida implica entregue, porque às vezes só o segundo aviso chega", () => {
    expect(deliveryStatusFields(ENTREGA, evento({ kind: "READ" }))).toEqual({
      deliveredAt: "2026-11-19T12:00:00.000Z",
      readAt: "2026-11-19T12:00:00.000Z",
    });
  });

  it("enviado não muda nada: quem aceitou o envio já gravou o horário", () => {
    expect(deliveryStatusFields(ENTREGA, evento({ kind: "SENT" }))).toEqual({});
  });

  it("falha depois do aceite derruba a entrega, com o motivo", () => {
    expect(
      deliveryStatusFields(
        ENTREGA,
        evento({ kind: "FAILED", failureCode: "OUTSIDE_REPLY_WINDOW" }),
      ),
    ).toEqual({ status: "FAILED", failureCode: "OUTSIDE_REPLY_WINDOW" });
  });

  it("entrega já encerrada não troca de motivo", () => {
    for (const status of ["FAILED", "CANCELLED"] as const) {
      expect(
        deliveryStatusFields(
          { ...ENTREGA, status, failureCode: "INVALID_DESTINATION" },
          evento({ kind: "FAILED", failureCode: "RATE_LIMITED" }),
        ),
      ).toEqual({});
    }
  });
});
