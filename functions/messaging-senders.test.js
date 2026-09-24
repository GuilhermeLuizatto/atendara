import { describe, expect, it } from "vitest";

import { whatsappConnectionMatchesSender } from "./messaging-senders.js";

const sender = {
  providerSenderId: "1236644296208358",
  displayNumber: "+55 13 99999-0000",
};

describe("aprovação do remetente do WhatsApp", () => {
  it("exige conexão Meta validada com o mesmo Phone Number ID e telefone", () => {
    expect(
      whatsappConnectionMatchesSender(
        { status: "VALIDATED", phoneNumberId: sender.providerSenderId, displayNumber: "+55 13 99999-0000" },
        sender,
      ),
    ).toBe(true);
  });

  it("recusa conexão ausente, pendente ou de outro número", () => {
    expect(whatsappConnectionMatchesSender(null, sender)).toBe(false);
    expect(
      whatsappConnectionMatchesSender(
        { status: "PENDING", phoneNumberId: sender.providerSenderId, displayNumber: sender.displayNumber },
        sender,
      ),
    ).toBe(false);
    expect(
      whatsappConnectionMatchesSender(
        { status: "VALIDATED", phoneNumberId: "outro-id", displayNumber: sender.displayNumber },
        sender,
      ),
    ).toBe(false);
    expect(
      whatsappConnectionMatchesSender(
        { status: "VALIDATED", phoneNumberId: sender.providerSenderId, displayNumber: "+55 11 98888-7777" },
        sender,
      ),
    ).toBe(false);
  });
});
