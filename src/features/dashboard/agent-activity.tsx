"use client";

import Link from "next/link";
import { ArrowUpRight, Bot, CornerUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CLASSIFICATION_TONE } from "@/components/ui/tones";
import { classificationMeta } from "@/config/classifications";
import { AI_ACTION_LABELS } from "@/config/labels";
import { cn } from "@/lib/utils/cn";
import {
  formatPercent,
  formatRelativeToNow,
  truncate,
} from "@/lib/utils/format";
import type { AIDecision } from "@/types";

/**
 * Feed de atividade do agente.
 *
 * Cada linha mostra o que chegou, como foi classificado, o que o agente fez e
 * com que confianca. E a materializacao do principio do produto: o
 * comportamento da IA e observavel, nao uma caixa preta.
 */
export function AgentActivity({
  decisions,
  autoResponses,
  escalations,
  automationRate,
  now,
}: {
  decisions: AIDecision[];
  autoResponses: number;
  escalations: number;
  automationRate: number;
  now: Date;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle
          action={
            <Link
              href="/agente"
              className="text-primary text-xs font-medium hover:underline"
            >
              Ver regras
            </Link>
          }
        >
          <span className="flex items-center gap-2">
            <Bot
              className="text-subtle-foreground size-4"
              aria-hidden
              strokeWidth={1.75}
            />
            Atividade do agente
          </span>
        </CardTitle>
      </CardHeader>

      <CardBody className="border-border grid grid-cols-3 gap-3 border-b py-3">
        <Summary label="Respondidas" value={String(autoResponses)} />
        <Summary
          label="Encaminhadas"
          value={String(escalations)}
          tone="warning"
        />
        <Summary label="Automação" value={formatPercent(automationRate)} />
      </CardBody>

      {decisions.length === 0 ? (
        <EmptyState
          icon={<Bot className="size-5" aria-hidden />}
          title="Sem atividade ainda"
          description="As decisões do agente aparecem aqui assim que as mensagens chegarem."
        />
      ) : (
        <ul className="divide-border divide-y">
          {decisions.map((decision) => {
            const meta = classificationMeta(decision.classification);
            const escalated = decision.escalated;

            return (
              <li key={decision.id} className="flex gap-3 px-5 py-3.5">
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                    escalated
                      ? "bg-warning-soft text-warning-soft-foreground"
                      : "bg-primary-soft text-primary-soft-foreground",
                  )}
                >
                  {escalated ? (
                    <CornerUpRight
                      className="size-3.5"
                      aria-hidden
                      strokeWidth={2}
                    />
                  ) : (
                    <Bot className="size-3.5" aria-hidden strokeWidth={2} />
                  )}
                </span>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-foreground text-sm leading-snug">
                    {decision.inputPreview ? (
                      <>&ldquo;{truncate(decision.inputPreview, 84)}&rdquo;</>
                    ) : (
                      "Trecho da mensagem não guardado nesta profissão"
                    )}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={CLASSIFICATION_TONE[meta.tone]}>
                      {meta.label}
                    </Badge>
                    <Badge tone={escalated ? "warning" : "success"}>
                      {AI_ACTION_LABELS[decision.action]}
                    </Badge>
                    <span className="text-subtle-foreground text-[11px] tabular-nums">
                      {formatPercent(decision.confidence)} de confiança
                    </span>
                  </div>

                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {decision.reason}
                  </p>

                  <time
                    dateTime={decision.decidedAt}
                    className="text-subtle-foreground block text-[11px]"
                  >
                    {formatRelativeToNow(decision.decidedAt, now)}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CardBody className="border-border border-t py-3">
        <Link
          href="/agente"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          Auditoria completa das decisões
          <ArrowUpRight className="size-3" aria-hidden strokeWidth={2} />
        </Link>
      </CardBody>
    </Card>
  );
}

function Summary({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "warning"
            ? "text-warning-soft-foreground"
            : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground text-[11px]">{label}</p>
    </div>
  );
}
