import { describe, expect, it } from "vitest";

import { PERMISSIONS, ROLES, type Role } from "@/types";

import {
  ROLE_PERMISSIONS,
  hasPermission,
  permissionsForRole,
} from "./permissions";

/**
 * Invariantes do RBAC.
 *
 * As Firestore Security Rules reimplementam esta matriz em CEL. Estes testes
 * fixam as propriedades que os dois lados precisam respeitar, de modo que uma
 * mudanca descuidada em um deles quebre o build antes de virar falha de
 * seguranca em producao.
 */
describe("matriz de permissoes", () => {
  it("define permissoes para todos os papeis", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it("da ao OWNER todas as permissoes existentes", () => {
    expect(new Set(permissionsForRole("OWNER"))).toEqual(new Set(PERMISSIONS));
  });

  it("reserva faturamento e exclusao da organizacao ao OWNER", () => {
    const exclusive = ["billing:manage", "organization:delete"] as const;

    for (const permission of exclusive) {
      expect(hasPermission("OWNER", permission)).toBe(true);
      for (const role of ROLES.filter((item) => item !== "OWNER")) {
        expect(hasPermission(role, permission)).toBe(false);
      }
    }
  });

  it("mantem o VIEWER estritamente em leitura", () => {
    for (const permission of permissionsForRole("VIEWER")) {
      expect(permission.split(":")[1]).toBe("read");
    }
  });

  it("nao deixa a secretaria gerenciar equipe nem excluir cadastros", () => {
    expect(hasPermission("ASSISTANT", "member:invite")).toBe(false);
    expect(hasPermission("ASSISTANT", "member:remove")).toBe(false);
    expect(hasPermission("ASSISTANT", "client:delete")).toBe(false);
    // Mas opera o dia a dia:
    expect(hasPermission("ASSISTANT", "appointment:create")).toBe(true);
    expect(hasPermission("ASSISTANT", "conversation:reply")).toBe(true);
  });

  it("restringe a leitura da trilha de auditoria a OWNER e ADMIN", () => {
    const allowed: Role[] = ["OWNER", "ADMIN"];
    for (const role of ROLES) {
      expect(hasPermission(role, "auditLog:read")).toBe(allowed.includes(role));
    }
  });

  it("aumenta a permissao conforme o papel sobe na hierarquia", () => {
    const ordered: Role[] = [
      "VIEWER",
      "ASSISTANT",
      "PROFESSIONAL",
      "ADMIN",
      "OWNER",
    ];

    for (let index = 1; index < ordered.length; index += 1) {
      const lower = new Set(permissionsForRole(ordered[index - 1]));
      const higher = new Set(permissionsForRole(ordered[index]));

      // Todo papel superior contem tudo o que o inferior pode fazer.
      for (const permission of lower) {
        expect(higher.has(permission)).toBe(true);
      }
      expect(higher.size).toBeGreaterThan(lower.size);
    }
  });

  it("nao contem permissao desconhecida", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });
});
