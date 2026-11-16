import { describe, expect, it } from "vitest";

import { networkSubject, tokenSubject } from "./rate-limit.js";

describe("sujeitos do limite de abuso", () => {
  it("o sujeito por token é estável e não carrega o token", () => {
    const token = "a".repeat(43);
    expect(tokenSubject(token)).toBe(tokenSubject(token));
    expect(tokenSubject(token)).not.toContain(token);
    expect(tokenSubject(token)).toMatch(/^token-[0-9a-f]{32}$/);
    expect(tokenSubject(token)).not.toBe(tokenSubject(`${token}b`));
  });

  it("o sujeito por rede não guarda o endereço", () => {
    const subject = networkSubject({ rawRequest: { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } } });
    expect(subject).toMatch(/^rede-[0-9a-f]{32}$/);
    expect(subject).not.toContain("203.0.113.9");
  });
});
