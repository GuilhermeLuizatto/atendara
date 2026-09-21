import { describe, expect, it } from "vitest";

import { embeddedSignupResult } from "./embedded-signup";

describe("Embedded Signup", () => {
  it("confirma autorização somente quando recebe um código", () => {
    expect(
      embeddedSignupResult({ status: "connected", authResponse: { code: "temporary-code" } }),
    ).toMatchObject({ status: "connected" });
  });

  it("não trata cancelamento como autorização", () => {
    expect(embeddedSignupResult({ status: "unknown" })).toMatchObject({ status: "cancelled" });
  });

  it("recusa retorno sem código", () => {
    expect(embeddedSignupResult({ status: "connected" })).toMatchObject({ status: "error" });
  });
});
