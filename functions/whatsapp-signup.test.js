import { describe, expect, it } from "vitest";

import { connectionDocument, selectWhatsappPhone } from "./whatsapp-signup.js";

describe("Embedded Signup do WhatsApp", () => {
  it("seleciona somente o número confirmado que veio da WABA", () => {
    expect(
      selectWhatsappPhone(
        [
          { id: "outro", display_phone_number: "+1 555", verified_name: "Outro" },
          { id: "phone-1", display_phone_number: "+55 13 99999-0000", verified_name: "Atendara" },
        ],
        "phone-1",
      ),
    ).toMatchObject({ id: "phone-1", verified_name: "Atendara" });
  });

  it("recusa número sem telefone exibível ou nome verificado", () => {
    expect(selectWhatsappPhone([{ id: "phone-1" }], "phone-1")).toBeNull();
    expect(
      selectWhatsappPhone([{ id: "phone-1", display_phone_number: "+55 13 99999-0000" }], "phone-1"),
    ).toBeNull();
  });

  it("não persiste token nem o payload bruto da Meta", () => {
    const document = connectionDocument({
      organizationId: "org-1",
      input: { businessId: "business-1", wabaId: "waba-1", phoneNumberId: "phone-1" },
      phone: { display_phone_number: "+55 13 99999-0000", verified_name: "Atendara" },
      actorId: "user-1",
      now: "2026-09-22T12:00:00.000Z",
    });

    expect(document).toMatchObject({ status: "VALIDATED", wabaId: "waba-1", phoneNumberId: "phone-1" });
    expect(document).not.toHaveProperty("accessToken");
    expect(document).not.toHaveProperty("payload");
  });
});
