import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PROVISIONAL_RETENTION_DAYS } from "@/config/platform";
import {
  PLATFORM_COLLECTIONS,
  ROOT_COLLECTIONS,
  TENANT_COLLECTIONS,
} from "@/lib/firebase/paths";
import { ORGANIZATION_EXPORT_SECTIONS } from "@/types";

import {
  APPEND_ONLY_PROTECTED_FIELDS,
  PERSONAL_DATA_MAP,
  type PersonalDataCollection,
  type Treatment,
} from "./privacy";

/**
 * O mapa de dados pessoais e politica executavel: `functions/privacy.js` so
 * faz o que ele diz. Estes testes fixam o que nao pode escapar dele.
 */

const ALL_COLLECTIONS = [
  ...Object.keys(ROOT_COLLECTIONS),
  ...Object.keys(TENANT_COLLECTIONS),
  ...Object.keys(PLATFORM_COLLECTIONS),
] as PersonalDataCollection[];

const entries = Object.entries(PERSONAL_DATA_MAP) as Array<
  [PersonalDataCollection, (typeof PERSONAL_DATA_MAP)[PersonalDataCollection]]
>;

function fieldsOf(treatment: Treatment): string[] {
  return treatment.action === "PSEUDONYMIZE" ? Object.keys(treatment.fields) : [];
}

describe("mapa de dados pessoais", () => {
  it("tem uma decisao para cada colecao de paths.ts, e nenhuma a mais", () => {
    expect(new Set(Object.keys(PERSONAL_DATA_MAP))).toEqual(new Set(ALL_COLLECTIONS));
  });

  it("nunca apaga decisoes do agente nem a trilha de auditoria", () => {
    for (const collection of ["aiDecisions", "auditLogs"] as const) {
      const policy = PERSONAL_DATA_MAP[collection];
      expect(policy.onClientErasure.action).toBe("PSEUDONYMIZE");
      expect(policy.onOrganizationDeletion.action).toBe("PSEUDONYMIZE");
    }
  });

  it("nao pseudonimiza campo que da sentido a decisao ou a entrada da trilha", () => {
    for (const collection of ["aiDecisions", "auditLogs"] as const) {
      const protectedFields = new Set<string>(APPEND_ONLY_PROTECTED_FIELDS[collection]);
      const policy = PERSONAL_DATA_MAP[collection];
      for (const field of [...fieldsOf(policy.onClientErasure), ...fieldsOf(policy.onOrganizationDeletion)]) {
        expect(protectedFields.has(field), `${collection}.${field}`).toBe(false);
      }
    }
  });

  it("so pseudonimiza campo declarado como pessoal", () => {
    for (const [collection, policy] of entries) {
      const personal = new Set(policy.personalFields);
      for (const field of [...fieldsOf(policy.onClientErasure), ...fieldsOf(policy.onOrganizationDeletion)]) {
        expect(personal.has(field), `${collection}.${field}`).toBe(true);
      }
    }
  });

  it("pedido de um titular nao toca conta, acesso nem cobranca da plataforma", () => {
    const outside = [...Object.keys(ROOT_COLLECTIONS), ...Object.keys(PLATFORM_COLLECTIONS)] as PersonalDataCollection[];
    for (const collection of outside) {
      expect(PERSONAL_DATA_MAP[collection].onClientErasure.action, collection).toBe("NOT_APPLICABLE");
    }
  });

  it("manter dado pessoal exige motivo escrito", () => {
    for (const [collection, policy] of entries) {
      for (const treatment of [policy.onClientErasure, policy.onOrganizationDeletion]) {
        if (treatment.action === "KEEP") expect(treatment.why.length, collection).toBeGreaterThan(20);
      }
    }
  });

  it("excluir a organizacao encerra o acesso de quem era membro", () => {
    for (const collection of ["accounts", "initialPasswords", "userMemberships", "members"] as const) {
      expect(PERSONAL_DATA_MAP[collection].onOrganizationDeletion.action, collection).toBe("DELETE");
    }
    // Mensagens saem junto das conversas, por serem subcolecao delas.
    expect(PERSONAL_DATA_MAP.conversations.onOrganizationDeletion.action).toBe("DELETE");
  });

  it("so a colecao da organizacao vira lapide", () => {
    const tombstones = entries.filter(([, policy]) => policy.onOrganizationDeletion.action === "TOMBSTONE");
    expect(tombstones.map(([collection]) => collection)).toEqual(["organizations"]);
  });

  it("declara TTL ligado exatamente onde firestore.indexes.json liga", () => {
    const indexes = JSON.parse(readFileSync(new URL("../../firestore.indexes.json", import.meta.url), "utf8")) as {
      fieldOverrides: Array<{ collectionGroup: string; fieldPath: string; ttl?: boolean }>;
    };
    const withTtl = indexes.fieldOverrides.filter((override) => override.ttl).map((override) => override.collectionGroup);
    const declared = entries
      .filter(([, policy]) => "ttlEnabled" in policy.retention && policy.retention.ttlEnabled)
      .map(([collection]) => collection);
    expect(new Set(declared)).toEqual(new Set(withTtl));
  });

  it("reaproveita o prazo provisorio dos eventos do gateway da Etapa 5B", () => {
    expect(PERSONAL_DATA_MAP.platformGatewayEvents.retention).toEqual({
      kind: "PROVISIONAL_DAYS",
      days: PROVISIONAL_RETENTION_DAYS.platformGatewayEvents,
      ttlEnabled: false,
    });
  });

  it("exporta toda colecao do tenant", () => {
    expect(new Set(ORGANIZATION_EXPORT_SECTIONS)).toEqual(new Set(Object.keys(TENANT_COLLECTIONS)));
  });
});
