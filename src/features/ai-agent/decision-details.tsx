import { Badge } from "@/components/ui/badge";
import { classificationMeta } from "@/config/classifications";
import { AI_ACTION_LABELS, RULE_LEVEL_LABELS } from "@/config/labels";
import type { DecisionOutcome } from "@/types";
import { formatDateTime } from "@/lib/utils/format";

const OUTCOMES = {
  MATCHED: "Aplicada",
  NOT_MATCHED: "Condição não atendida",
  BLOCKED_BY_HIGHER_LEVEL: "Bloqueada por regra superior",
  DISABLED: "Desativada",
};

export function DecisionDetails({ decision }: { decision: DecisionOutcome }) {
  return (
    <div className="space-y-4 text-sm">
      {"evaluatedAt" in decision &&
        typeof decision.evaluatedAt === "string" && (
          <p className="text-muted-foreground text-xs">
            Horário avaliado na simulação:{" "}
            {formatDateTime(decision.evaluatedAt)}
          </p>
        )}
      <div className="flex flex-wrap gap-2">
        <Badge tone={decision.escalated ? "warning" : "success"}>
          {AI_ACTION_LABELS[decision.action]}
        </Badge>
        <Badge>{classificationMeta(decision.classification).label}</Badge>
        <Badge>{Math.round(decision.confidence * 100)}% de confiança</Badge>
      </div>
      <p>{decision.reason}</p>
      {decision.responseText && (
        <blockquote className="bg-primary-soft rounded-lg p-4 whitespace-pre-wrap">
          {decision.responseText}
        </blockquote>
      )}
      <details>
        <summary className="text-primary cursor-pointer font-medium">
          Regras avaliadas ({decision.appliedRules.length})
        </summary>
        <ol className="mt-3 space-y-2">
          {decision.appliedRules.map((rule) => (
            <li
              key={rule.ruleId}
              className="border-border rounded-lg border p-3"
            >
              <p className="font-medium">
                {rule.ruleName} · v{rule.ruleVersion}
              </p>
              <p className="text-muted-foreground text-xs">
                {RULE_LEVEL_LABELS[rule.level]} · {OUTCOMES[rule.outcome]}
              </p>
            </li>
          ))}
        </ol>
      </details>
      <p className="text-muted-foreground text-xs">
        Motor {decision.engineVersion} · IA simulada
      </p>
    </div>
  );
}
