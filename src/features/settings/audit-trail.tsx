"use client";

import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { SkeletonCard } from "@/components/ui/skeleton";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTOR_LABELS,
  AUDIT_RESOURCE_LABELS,
} from "@/config/labels";
import { formatDateTime } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import { AUDIT_ACTIONS, type AuditAction } from "@/types";

/** Quantos registros aparecem por vez antes de "Mostrar mais". */
const VISIBLE_STEP = 50;

/**
 * Trilha de auditoria da organizacao, para quem a matriz autoriza
 * (`auditLog:read`: OWNER e ADMIN). A leitura e a mesma de sempre — o
 * snapshot ja traz a colecao, e as rules continuam negando a quem nao pode.
 *
 * So leitura: a trilha e append-only, e nenhum controle aqui escreve nada.
 */
export function AuditTrail() {
  const { data, session } = useWorkspace();
  const { loadMore } = useWorkspaceActions();
  const [action, setAction] = useState<AuditAction | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(VISIBLE_STEP);

  const logs = useMemo(
    () => [...(data?.auditLogs ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [data?.auditLogs],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return logs.filter(
      (log) =>
        (action === "ALL" || log.action === action) &&
        (!term ||
          log.summary.toLocaleLowerCase("pt-BR").includes(term) ||
          log.actorName.toLocaleLowerCase("pt-BR").includes(term)),
    );
  }, [logs, action, search]);

  if (!data) return <SkeletonCard lines={6} />;

  if (!session?.permissions.includes("auditLog:read")) {
    return (
      <p className="text-muted-foreground text-sm">
        A trilha de auditoria é lida por quem administra a organização.
      </p>
    );
  }

  const page = data.pagination?.auditLogs;
  const shown = filtered.slice(0, visible);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Cada alteração feita no painel deixa um registro aqui, na mesma gravação
        da própria alteração. Ninguém edita nem apaga registro pelo aplicativo —
        nem o proprietário. Pedido de titular de dados troca o nome da pessoa por
        um pseudônimo e deixa a marca no registro.
      </p>

      <Card className="p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Buscar no resumo ou por autor">
            {(props) => (
              <Input
                {...props}
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setVisible(VISIBLE_STEP);
                }}
              />
            )}
          </Field>
          <Field label="Tipo de registro">
            {(props) => (
              <Select
                {...props}
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as AuditAction | "ALL");
                  setVisible(VISIBLE_STEP);
                }}
              >
                <option value="ALL">Todos</option>
                {AUDIT_ACTIONS.map((item) => (
                  <option key={item} value={item}>
                    {AUDIT_ACTION_LABELS[item]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p role="status" className="text-muted-foreground mt-2 text-xs">
          {filtered.length === logs.length
            ? `${logs.length} registro(s) carregado(s).`
            : `${filtered.length} de ${logs.length} registro(s) carregado(s).`}
        </p>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ScrollText className="size-5" aria-hidden />}
            title={logs.length === 0 ? "Nenhum registro ainda" : "Nenhum registro com esses filtros"}
            description={
              logs.length === 0
                ? "Os registros aparecem assim que alguém cadastrar, agendar ou alterar uma configuração."
                : "Limpe a busca ou escolha outro tipo."
            }
          />
        </Card>
      ) : (
        <Card>
          <ol className="divide-border divide-y">
            {shown.map((log) => (
              <li key={log.id} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{AUDIT_ACTION_LABELS[log.action] ?? log.action}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {AUDIT_RESOURCE_LABELS[log.resource.type] ?? log.resource.type}
                  </span>
                  {log.privacyRedaction ? <Badge tone="info">Pseudonimizado</Badge> : null}
                  <time dateTime={log.occurredAt} className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {formatDateTime(log.occurredAt)}
                  </time>
                </div>
                <p className="text-foreground text-sm">{log.summary}</p>
                <p className="text-muted-foreground text-xs">
                  {AUDIT_ACTOR_LABELS[log.actorType]}: {log.actorName}
                </p>
                {Object.keys(log.metadata).length > 0 ? (
                  <details className="text-xs">
                    <summary className="text-primary min-h-6 cursor-pointer">Detalhes gravados</summary>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      {Object.entries(log.metadata).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-muted-foreground font-mono">{key}</dt>
                          <dd className="text-foreground break-all">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
          {filtered.length > shown.length ? (
            <div className="border-border border-t px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setVisible((value) => value + VISIBLE_STEP)}>
                Mostrar mais {Math.min(VISIBLE_STEP, filtered.length - shown.length)}
              </Button>
            </div>
          ) : (
            <LoadMore
              className="border-border border-t"
              page={page}
              summary={`Mostrando os ${logs.length} registros mais recentes. Os mais antigos ainda não foram carregados.`}
              label="Carregar registros mais antigos"
              onLoadMore={() => void loadMore("auditLogs")}
            />
          )}
        </Card>
      )}
    </div>
  );
}
