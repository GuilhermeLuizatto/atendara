import { describe, expect, it } from "vitest";

import { PERMISSIONS, PLATFORM_PERMISSIONS, ROLES, type Role } from "@/types";

import {
  ORGANIZATION_HOLDER_PERMISSIONS,
  PLATFORM_MASTER_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  hasPlatformPermission,
  permissionsForMembership,
  permissionsForRole,
} from "./permissions";
import { PRIVACY_RESPONSIBLE_ROLES } from "./privacy";

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

  it("reserva pedidos de titulares aos papeis que o backend e as rules aceitam", () => {
    for (const permission of ["privacy:export", "privacy:erase"] as const) {
      const roles = ROLES.filter((role) => hasPermission(role, permission));
      expect(new Set(roles)).toEqual(new Set(PRIVACY_RESPONSIBLE_ROLES));
    }
  });

  it("reserva a configuracao de avisos e do horario a OWNER, ADMIN e ao titular", () => {
    const allowed: Role[] = ["OWNER", "ADMIN"];
    for (const permission of ["notificationSettings:update", "agendaSettings:update"] as const) {
      for (const role of ROLES) {
        expect(hasPermission(role, permission)).toBe(allowed.includes(role));
        expect(permissionsForMembership(role, true)).toContain(permission);
      }
    }
  });

  it("da ao titular so a lista fechada, alem do proprio papel", () => {
    // Espelha `organizationHolder()` nas rules: avisos, horario e pedidos de titular.
    expect(new Set(ORGANIZATION_HOLDER_PERMISSIONS)).toEqual(
      new Set(["notificationSettings:update", "agendaSettings:update", "privacy:export", "privacy:erase"]),
    );
    const professional = new Set(permissionsForRole("PROFESSIONAL"));
    const gained = permissionsForMembership("PROFESSIONAL", true).filter(
      (permission) => !professional.has(permission),
    );
    expect(new Set(gained)).toEqual(new Set(ORGANIZATION_HOLDER_PERMISSIONS));
    expect(gained).not.toContain("organization:update");
    expect(gained).not.toContain("auditLog:read");
  });

  it("nao amplia o papel de quem nao e titular", () => {
    for (const role of ROLES) {
      expect(permissionsForMembership(role, false)).toEqual(permissionsForRole(role));
    }
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

  it("nao da a operadora nenhuma permissao de tenant e reserva gerir administradores a chave mestra", () => {
    const tenant = new Set<string>(PERMISSIONS);
    for (const permission of PLATFORM_PERMISSIONS) {
      expect(tenant.has(permission)).toBe(false);
    }
    expect(new Set([...PLATFORM_ROLE_PERMISSIONS.PLATFORM_ADMIN, ...PLATFORM_MASTER_PERMISSIONS])).toEqual(
      new Set(PLATFORM_PERMISSIONS),
    );
    expect(PLATFORM_ROLE_PERMISSIONS.PLATFORM_ADMIN).not.toContain("platformAdmin:manage");
  });

  it("reserva os atos de plataforma a operadora ativa", () => {
    const base = {
      userId: "u",
      email: "u@atendara.test",
      displayName: "U",
      organizationId: null,
      professionId: null,
      modules: [],
      status: "ACTIVE" as const,
      subscriptionStatus: "PENDING" as const,
      accessUntil: null,
      mustChangePassword: false,
      createdAt: "2026-09-10T00:00:00.000Z",
    };
    const operator = { ...base, platformRole: "PLATFORM_ADMIN" as const };
    const professional = { ...base, platformRole: "PROFESSIONAL" as const, organizationId: "org" };

    expect(hasPlatformPermission(operator, "accessGrant:create")).toBe(true);
    expect(hasPlatformPermission({ ...operator, status: "SUSPENDED" }, "accessGrant:create")).toBe(false);
    expect(hasPlatformPermission({ ...operator, mustChangePassword: true }, "account:list")).toBe(false);
    expect(hasPlatformPermission(operator, "platformAdmin:manage")).toBe(false);
    expect(hasPlatformPermission({ ...operator, platformMaster: true }, "platformAdmin:manage")).toBe(true);
    expect(hasPlatformPermission({ ...operator, platformMaster: true, status: "SUSPENDED" }, "platformAdmin:manage")).toBe(false);
    expect(hasPlatformPermission({ ...professional, platformMaster: true }, "platformAdmin:manage")).toBe(false);
    for (const permission of PLATFORM_PERMISSIONS) {
      expect(hasPlatformPermission(professional, permission)).toBe(false);
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
