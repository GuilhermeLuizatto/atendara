import { describe, expect, it } from "vitest";

import {
  hasProfessionalScope,
  professionalScopeFor,
} from "./professional-scope";

describe("professionalScopeFor", () => {
  it.each(["OWNER", "ADMIN"] as const)(
    "%s preserva o alcance organizacional",
    (role) => {
      const scope = professionalScopeFor({ role, linkedProfessionalIds: [] });

      expect(scope.organizationWide).toBe(true);
      expect(hasProfessionalScope(scope, "professional-c")).toBe(true);
    },
  );

  it.each(["PROFESSIONAL", "ASSISTANT", "VIEWER"] as const)(
    "%s depende somente dos vínculos explícitos",
    (role) => {
      const scope = professionalScopeFor({
        role,
        linkedProfessionalIds: ["professional-a", "professional-b", "professional-a"],
      });

      expect(scope).toEqual({
        organizationWide: false,
        professionalIds: ["professional-a", "professional-b"],
      });
      expect(hasProfessionalScope(scope, "professional-a")).toBe(true);
      expect(hasProfessionalScope(scope, "professional-c")).toBe(false);
      expect(hasProfessionalScope(scope, null)).toBe(false);
    },
  );

  it("não transforma vínculo ausente ou vazio em acesso geral", () => {
    expect(
      hasProfessionalScope(
        professionalScopeFor({ role: "ASSISTANT" }),
        "professional-a",
      ),
    ).toBe(false);
    expect(
      hasProfessionalScope(
        professionalScopeFor({ role: "PROFESSIONAL", linkedProfessionalIds: [] }),
        "professional-a",
      ),
    ).toBe(false);
  });
});
