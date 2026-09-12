"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LoadMore } from "@/components/ui/load-more";
import { ACCESS_GRANT_KIND_LABELS, PLATFORM_AUDIT_ACTION_LABELS } from "@/config/platform";
import { authAdapter } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { platformAccessReader } from "@/services/platform-access";
import type { AccessGrantKind, PageRequest, PlatformAuditLog } from "@/types";
import type { AccountAccess } from "@/types/access";

import { usePagedList } from "./use-paged-list";

/** Resumo legivel dos campos conhecidos; o documento completo fica no banco. */
function summarize(log: PlatformAuditLog): string[] {
  const details = log.details as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof details.kind === "string") lines.push(ACCESS_GRANT_KIND_LABELS[details.kind as AccessGrantKind] ?? details.kind);
  if (typeof details.until === "string") lines.push(`até ${formatDate(details.until)}`);
  if (typeof details.resultingAccessUntil === "string") lines.push(`acesso resultante até ${formatDate(details.resultingAccessUntil)}`);
  const status = details.status as { from?: string; to?: string } | undefined;
  if (status?.from !== status?.to && status?.to) lines.push(`situação ${status.from} -> ${status.to}`);
  const modules = details.modules;
  if (Array.isArray(modules)) lines.push(`módulos: ${modules.join(", ")}`);
  else if (modules && typeof modules === "object" && "to" in modules && Array.isArray(modules.to)) lines.push(`módulos: ${modules.to.join(", ")}`);
  return lines;
}

/**
 * Trilha append-only dos atos da operadora. Leitura so pela operadora com
 * segundo fator; nenhuma escrita pelo cliente.
 */
export function PlatformAuditPanel() {
  const reader = platformAccessReader();
  const fetchLogs = useCallback((request: PageRequest) => reader.recentAuditLogs(request), [reader]);
  const logs = usePagedList(fetchLogs, "Não foi possível carregar a trilha da operadora.");
  // So as contas citadas na pagina: ler todos os cadastros para trocar id por
  // e-mail seria uma leitura por conta a cada abertura da aba.
  const [accounts, setAccounts] = useState<AccountAccess[]>([]);
  const looked = useRef(new Set<string>());

  useEffect(() => {
    const missing = [
      ...new Set(logs.items.flatMap((log) => [log.actorId, log.targetUserId]).filter((id): id is string => Boolean(id))),
    ].filter((id) => !looked.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) looked.current.add(id);
    let active = true;
    authAdapter
      .accountsById(missing)
      .then((found) => {
        if (active) setAccounts((current) => [...current, ...found]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [logs.items]);

  const emailOf = (userId: string | null) => (userId ? (accounts.find((item) => item.userId === userId)?.email ?? userId) : "—");

  if (!reader.available) {
    return <p className="text-muted-foreground text-sm">Na demonstração não existe trilha: nada aqui seria registro real.</p>;
  }

  return (
    <section className="space-y-3" aria-busy={logs.status === "loading" || undefined}>
      <p className="text-muted-foreground text-sm">
        Cada cadastro, alteração de conta, concessão e revogação grava uma entrada na mesma transação do ato. Ninguém
        edita nem apaga pelo aplicativo.
      </p>
      {logs.error ? <p role="alert" className="text-danger text-sm">{logs.error}</p> : null}
      {logs.status === "loading" ? (
        <p role="status" className="text-muted-foreground text-sm">Carregando a trilha...</p>
      ) : logs.items.length === 0 && logs.status === "ready" ? (
        <p className="text-muted-foreground text-sm">Nenhum ato registrado.</p>
      ) : (
        <ul className="space-y-2">
          {logs.items.map((log) => (
            <li key={log.id} className="border-border space-y-1 border-t pt-2 text-sm">
              <p className="text-foreground font-medium">
                {PLATFORM_AUDIT_ACTION_LABELS[log.action] ?? log.action}
                <span className="text-muted-foreground font-normal"> · {formatDateTime(log.createdAt)}</span>
              </p>
              <p className="text-muted-foreground break-words">
                Por {emailOf(log.actorId)} · conta {emailOf(log.targetUserId)}
                {log.organizationId ? <span className="text-subtle-foreground font-mono text-xs"> · {log.organizationId}</span> : null}
              </p>
              {summarize(log).length ? <p className="text-subtle-foreground text-xs">{summarize(log).join(" · ")}</p> : null}
              {log.reason ? <p className="text-foreground">Motivo: {log.reason}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        page={logs.page}
        summary={`Mostrando os ${logs.items.length} atos mais recentes.`}
        label="Carregar atos anteriores"
        onLoadMore={() => void logs.loadMore()}
      />
    </section>
  );
}
