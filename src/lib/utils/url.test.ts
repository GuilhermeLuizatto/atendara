import { describe, expect, it } from "vitest";

import { safeExternalUrl } from "./url";

describe("URL externa exibida em link", () => {
  it("aceita somente https", () => {
    expect(safeExternalUrl("https://invoice.stripe.com/i/acct_x/test_y")).toBe("https://invoice.stripe.com/i/acct_x/test_y");
  });

  it("recusa esquemas que executam ou rebaixam a conexao", () => {
    for (const value of [
      "javascript:alert(document.cookie)",
      " JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://invoice.stripe.com/i/x",
      "/assinatura",
      "nao e url",
      "",
      null,
      undefined,
    ]) {
      expect(safeExternalUrl(value)).toBeNull();
    }
  });
});
