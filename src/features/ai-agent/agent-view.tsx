"use client";

import { useState } from "react";
import { LockKeyhole, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { RULE_LEVEL_LABELS } from "@/config/labels";
import { AI_ASSISTANT_NAME } from "@/config/app";
import { formatDateTime } from "@/lib/utils/format";
import { sortByPrecedence } from "@/lib/rules/precedence";
import { useWorkspace } from "@/providers/workspace-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import type { AIRule } from "@/types";
import { RuleForm } from "./rule-form";
import { Simulator } from "./simulator";
import { DecisionDetails } from "./decision-details";

export function AgentView() {
  const { data } = useWorkspace();
  if (!data) return <p>Carregando agente...</p>;
  return <AgentWorkspace key={data.organization.id} />;
}

function AgentWorkspace() {
  const { data, session } = useWorkspace();
  const actions = useWorkspaceActions();
  const [tab, setTab] = useState<"rules" | "simulator" | "audit">("rules");
  const [editing, setEditing] = useState<AIRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<AIRule | null>(null);
  if (!data) return <p>Carregando agente...</p>;
  const groups = [
    {
      title: "1. Regras fundamentais e da profissao",
      rules: data.rules.filter((r) => r.immutable),
    },
    {
      title: "2. Regras do profissional",
      rules: data.rules.filter(
        (r) => !r.immutable && r.level === "PROFESSIONAL",
      ),
    },
    {
      title: "3. Regras contextuais e preferencias",
      rules: data.rules.filter(
        (r) => !r.immutable && r.level !== "PROFESSIONAL",
      ),
    },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title={AI_ASSISTANT_NAME}
        description="Sua assistente de IA para a rotina administrativa. Configure as regras e acompanhe cada decisão. Você mantém o controle."
        actions={<Badge tone="info">IA simulada</Badge>}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "rules", label: "Regras", count: data.rules.length },
            { value: "simulator", label: `Testar ${AI_ASSISTANT_NAME}` },
            {
              value: "audit",
              label: "Auditoria",
              count: data.decisions.length,
            },
          ]}
        />
        {tab === "rules" && session?.permissions.includes("rule:create") && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            Adicionar regra
          </Button>
        )}
      </div>
      {tab === "rules" &&
        groups.map((group) => (
          <section key={group.title} className="space-y-3">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {group.title}
            </h2>
            {sortByPrecedence(group.rules).map((rule) => (
              <Card
                key={rule.id}
                className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{rule.name}</h3>
                    <Badge tone={rule.enabled ? "success" : "neutral"}>
                      {rule.enabled ? "Ativa" : "Desativada"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {rule.description}
                  </p>
                  <p className="text-subtle-foreground text-xs">
                    {RULE_LEVEL_LABELS[rule.level]} · v{rule.version} ·
                    prioridade {rule.priority}
                  </p>
                </div>
                {rule.immutable ? (
                  <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                    <LockKeyhole className="size-3" aria-hidden />
                    Protegida
                  </span>
                ) : (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {session?.permissions.includes("rule:update") && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            actions.setRuleEnabled(rule.id, !rule.enabled)
                          }
                        >
                          {rule.enabled ? "Desativar" : "Ativar"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(rule)}
                        >
                          Editar
                        </Button>
                      </>
                    )}
                    {session?.permissions.includes("rule:delete") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(rule)}
                      >
                        Excluir
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            ))}
            {!group.rules.length && (
              <p className="text-muted-foreground text-sm">
                Nenhuma regra neste nivel.
              </p>
            )}
          </section>
        ))}
      {tab === "simulator" && <Simulator />}
      {tab === "audit" && (
        <div className="space-y-3">
          {data.decisions.map((decision) => (
            <Card key={decision.id} className="p-4">
              <details>
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">{decision.inputPreview}</span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {formatDateTime(decision.decidedAt)} ·{" "}
                    {data.clients.find(
                      (client) => client.id === decision.clientId,
                    )?.fullName ?? "Contato"}
                  </span>
                </summary>
                <div className="mt-4">
                  <DecisionDetails decision={decision} />
                  <p className="text-muted-foreground mt-2 text-xs">
                    Organizacao: {decision.organizationId} · Decisao:{" "}
                    {decision.id}
                  </p>
                </div>
              </details>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <RuleForm
          key={editing === "new" ? "new" : editing.id}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void actions.deleteRule(deleting.id);
        }}
        title="Excluir regra"
        message={`Excluir "${deleting?.name}"? As decisoes anteriores permanecem na auditoria.`}
        confirmLabel="Excluir regra"
      />
    </div>
  );
}
