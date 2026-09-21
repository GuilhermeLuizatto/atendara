"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { classificationMeta } from "@/config/classifications";
import { summarizeDecisions } from "@/lib/ai/analytics";
import { useNow } from "@/lib/utils/use-now";
import { useWorkspace } from "@/providers/workspace-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import type { MessageClassificationId } from "@/types";

export function AnalyticsPanel() {
  const { data, repository, loadState } = useWorkspace();
  const { loadMore } = useWorkspaceActions();
  const now = useNow();
  const [days, setDays] = useState(30);
  const [professionalId, setProfessionalId] = useState("");
  if (!data) return null;
  if (loadState.status === "ready" && loadState.failed.includes("decisions"))
    return (
      <Card className="p-5">
        <p role="alert">
          Não foi possível carregar as decisões. Tente novamente antes de
          consultar os indicadores.
        </p>
      </Card>
    );
  const stats = summarizeDecisions(data.decisions, {
    organizationId: data.organization.id,
    from: new Date(now.getTime() - days * 86400000),
    until: now,
    professionalId,
  });
  const percent = (value: number | null) =>
    value === null ? "—" : `${Math.round(value * 100)}%`;
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Indicadores da Dara</h2>
        <p className="text-muted-foreground text-sm">
          {repository?.mode === "memory" ? "Dados de demonstração. " : ""}
          Resultados calculados sobre as decisões carregadas, por data de
          registro. Resposta automática é uma decisão do motor; não comprova
          entrega ao cliente.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Período">
            {(props) => (
              <Select
                {...props}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
              </Select>
            )}
          </Field>
          <Field label="Profissional">
            {(props) => (
              <Select
                {...props}
                value={professionalId}
                onChange={(e) => setProfessionalId(e.target.value)}
              >
                <option value="">Todos os profissionais</option>
                {data.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {data.pagination?.decisions?.hasMore && (
          <p role="status" className="text-warning-soft-foreground text-sm">
            Amostra parcial: existem decisões anteriores ainda não carregadas.
          </p>
        )}
        <LoadMore
          page={data.pagination?.decisions}
          summary={`${data.decisions.length} decisões carregadas.`}
          label="Carregar decisões anteriores"
          onLoadMore={() => void loadMore("decisions")}
        />
      </Card>
      {!stats.total ? (
        <Card className="p-5">
          <p>Nenhuma decisão neste período e filtro.</p>
        </Card>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Decisões", stats.total],
              ["Respostas automáticas", stats.automatic],
              ["Sugestões", stats.suggested],
              ["Encaminhamentos", stats.escalated],
              ["Alertas críticos", stats.critical],
              ["Taxa de automação", percent(stats.automaticRate)],
              ["Confiança média", percent(stats.averageConfidence)],
              [
                "Latência p95",
                stats.p95LatencyMs === null ? "—" : `${stats.p95LatencyMs} ms`,
              ],
            ].map(([label, value]) => (
              <Card key={label} className="p-4">
                <dt className="text-muted-foreground text-sm">{label}</dt>
                <dd className="mt-2 text-2xl font-semibold">{value}</dd>
              </Card>
            ))}
          </dl>
          <p className="text-muted-foreground text-xs">
            Confiança é a pontuação do classificador, não sua acurácia. Latência
            p95: 95% das avaliações levaram até esse tempo.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-3 p-5">
              <h3 className="font-semibold">Classificações</h3>
              {Object.entries(stats.classifications).map(([id, count]) => (
                <div key={id} className="space-y-1">
                  <p className="flex justify-between text-sm">
                    <span>
                      {classificationMeta(id as MessageClassificationId).label}
                    </span>
                    <span>{count}</span>
                  </p>
                  <progress
                    className="accent-primary w-full"
                    value={count}
                    max={stats.total}
                    aria-label={
                      classificationMeta(id as MessageClassificationId).label
                    }
                  />
                </div>
              ))}
            </Card>
            <Card className="space-y-3 p-5">
              <h3 className="font-semibold">Regras aplicadas por versão</h3>
              {stats.rules.slice(0, 10).map((rule) => (
                <p
                  key={`${rule.id}:${rule.version}`}
                  className="flex justify-between gap-3 text-sm"
                >
                  <span>
                    {rule.name} · v{rule.version}
                  </span>
                  <span>{rule.matches}</span>
                </p>
              ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
