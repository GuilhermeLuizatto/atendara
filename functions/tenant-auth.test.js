import { describe, expect, it } from "vitest";

import { assertProfessionalScope, hasProfessionalScope } from "./tenant-auth.js";

const actor = (role, linkedProfessionalIds) => ({
  membership: { role, linkedProfessionalIds },
});

describe("escopo profissional das Functions", () => {
  it.each(["OWNER", "ADMIN"])("%s alcança toda a organização", (role) => {
    expect(hasProfessionalScope(actor(role, []), "prof-c")).toBe(true);
  });

  it.each(["PROFESSIONAL", "ASSISTANT", "VIEWER"])(
    "%s alcança somente os vínculos explícitos",
    (role) => {
      const scoped = actor(role, ["prof-a", "prof-b"]);
      expect(hasProfessionalScope(scoped, "prof-a")).toBe(true);
      expect(hasProfessionalScope(scoped, "prof-b")).toBe(true);
      expect(hasProfessionalScope(scoped, "prof-c")).toBe(false);
      expect(() => assertProfessionalScope(scoped, "prof-c")).toThrow(
        /fora dos seus vínculos ativos/,
      );
    },
  );

  it.each([undefined, null, [], "prof-a"])(
    "lista ausente ou inválida nunca significa acesso geral (%#)",
    (linkedProfessionalIds) => {
      expect(hasProfessionalScope(actor("ASSISTANT", linkedProfessionalIds), "prof-a")).toBe(false);
    },
  );
});
