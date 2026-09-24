import { describe, expect, it } from "vitest";

import {
  embeddedSignupResult,
  embeddedSignupSession,
  isMetaEmbeddedSignupOrigin,
} from "./embedded-signup";

describe("Embedded Signup", () => {
  it("confirma autorização somente quando recebe um código", () => {
    expect(
      embeddedSignupResult({ status: "connected", authResponse: { code: "temporary-code" } }),
    ).toMatchObject({ status: "connected", code: "temporary-code" });
  });

  it("não trata cancelamento como autorização", () => {
    expect(embeddedSignupResult({ status: "unknown" })).toMatchObject({ status: "cancelled" });
  });

  it("recusa retorno sem código", () => {
    expect(embeddedSignupResult({ status: "connected" })).toMatchObject({ status: "error" });
  });

  it("extrai somente os identificadores do evento da Meta", () => {
    expect(
      embeddedSignupSession({
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        version: 4,
        data: {
          business_id: "business-1",
          phone_number_id: "phone-1",
          waba_id: "waba-1",
          access_token: "must-not-be-returned",
        },
      }),
    ).toEqual({
      event: "FINISH",
      version: 4,
      data: { businessId: "business-1", phoneNumberId: "phone-1", wabaId: "waba-1" },
    });
  });

  it("ignora mensagens que não são eventos do Embedded Signup", () => {
    expect(embeddedSignupSession({ type: "OTHER", event: "FINISH" })).toBeNull();
    expect(embeddedSignupSession("mensagem inválida")).toBeNull();
  });

  it("aceita o payload serializado usado por algumas versões do SDK", () => {
    expect(
      embeddedSignupSession(
        JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "waba-2" } }),
      ),
    ).toMatchObject({ data: { wabaId: "waba-2" } });
  });

  it("aceita somente origens HTTPS da Meta", () => {
    expect(isMetaEmbeddedSignupOrigin("https://www.facebook.com")).toBe(true);
    expect(isMetaEmbeddedSignupOrigin("https://business.facebook.com")).toBe(true);
    expect(isMetaEmbeddedSignupOrigin("https://facebook.com.attacker.test")).toBe(false);
    expect(isMetaEmbeddedSignupOrigin("http://www.facebook.com")).toBe(false);
  });
});
