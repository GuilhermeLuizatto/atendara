import { ruleInputSchema, validateRuleInput } from "@/lib/rules/validation";
import type { AIRule, ID } from "@/types";

import { assertPermission } from "../../guards";
import { RepositoryError, type RuleInput } from "../../types";
import {
  auditWrite,
  docPath,
  requireProfessional,
  stamp,
  touch,
  type Plan,
  type PlanContext,
} from "../plan";

/**
 * Regras do agente.
 *
 * SECURITY, SYSTEM e PROFESSION nao existem como documento: sao materializadas
 * de `src/config` a cada leitura do snapshot. Uma regra fundamental que nao esta
 * no banco nao tem como ser editada, desativada ou apagada — nem pela interface,
 * nem por chamada direta ao SDK. As Security Rules recusam a criacao desses
 * niveis pelo cliente justamente para que esse invariante nao dependa daqui.
 */

function validate(ctx: PlanContext, input: RuleInput): RuleInput {
  const validation = validateRuleInput(input);
  if (!validation.valid) throw new RepositoryError(validation.errors.join(" "));
  const parsed = ruleInputSchema.parse(input);
  if (parsed.professionalId) requireProfessional(ctx, parsed.professionalId);
  return parsed;
}

function assertEditableLevel(level: AIRule["level"]): void {
  if (level === "SECURITY" || level === "SYSTEM" || level === "PROFESSION") {
    throw new RepositoryError(
      "Somente regras do profissional, contextuais e de preferencia podem ser criadas.",
    );
  }
}

function requireEditableRule(ctx: PlanContext, id: ID): AIRule {
  const rule = ctx.snapshot.rules.find((item) => item.id === id);
  if (!rule) throw new RepositoryError("Regra nao encontrada.");
  if (rule.immutable) {
    throw new RepositoryError(
      "Regras fundamentais nao podem ser alteradas nem desativadas.",
    );
  }
  return rule;
}

export function planCreateRule(ctx: PlanContext, raw: RuleInput): Plan<ID> {
  assertPermission(ctx.actor, "rule:create");
  const input = validate(ctx, raw);
  assertEditableLevel(input.level);

  const id = ctx.newId("aiRules");
  const rule: AIRule = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    ...input,
    immutable: false,
    version: 1,
    lastAppliedAt: null,
  };

  return {
    result: id,
    writes: [
      {
        op: "set",
        collection: "aiRules",
        path: docPath(ctx, "aiRules", id),
        data: rule as unknown as Record<string, unknown>,
      },
      auditWrite(ctx, {
        action: "CREATE",
        actorType: "USER",
        resource: { type: "aiRule", id },
        summary: `Regra "${rule.name}" criada.`,
        metadata: { level: rule.level, source: rule.source },
      }),
    ],
  };
}

export function planUpdateRule(
  ctx: PlanContext,
  id: ID,
  patch: Partial<RuleInput>,
): Plan {
  assertPermission(ctx.actor, "rule:update");
  const existing = requireEditableRule(ctx, id);
  const input = validate(ctx, { ...existing, ...patch });
  if (patch.level) assertEditableLevel(patch.level);

  // Cada alteracao gera uma versao nova: a auditoria cita a versao aplicada,
  // e sem isso uma decisao antiga ficaria impossivel de interpretar.
  const version = existing.version + 1;

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "aiRules",
        path: docPath(ctx, "aiRules", id),
        data: { ...input, version, ...touch(ctx) },
      },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "aiRule", id },
        summary: `Regra "${input.name}" atualizada (v${version}).`,
        metadata: { version },
      }),
    ],
  };
}

export function planDeleteRule(ctx: PlanContext, id: ID): Plan {
  assertPermission(ctx.actor, "rule:delete");
  const existing = requireEditableRule(ctx, id);

  return {
    result: undefined,
    writes: [
      { op: "delete", path: docPath(ctx, "aiRules", id) },
      auditWrite(ctx, {
        action: "DELETE",
        actorType: "USER",
        resource: { type: "aiRule", id },
        summary: `Regra "${existing.name}" excluida.`,
      }),
    ],
  };
}

export function planSetRuleEnabled(
  ctx: PlanContext,
  id: ID,
  enabled: boolean,
): Plan {
  assertPermission(ctx.actor, "rule:update");
  const existing = requireEditableRule(ctx, id);
  validate(ctx, { ...existing, enabled });

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "aiRules",
        path: docPath(ctx, "aiRules", id),
        data: { enabled, version: existing.version + 1, ...touch(ctx) },
      },
      auditWrite(ctx, {
        action: enabled ? "RULE_ENABLED" : "RULE_DISABLED",
        actorType: "USER",
        resource: { type: "aiRule", id },
        summary: `Regra "${existing.name}" ${enabled ? "ativada" : "desativada"}.`,
      }),
    ],
  };
}
