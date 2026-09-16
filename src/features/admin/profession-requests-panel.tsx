"use client";

import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { PROFESSION_CHANGE_REASON_LENGTH } from "@/config/platform";
import { getProfession } from "@/config/professions";
import { authAdapter } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils/format";
import { platformAccessReader } from "@/services/platform-access";
import type { PageRequest, ProfessionChangeStatus } from "@/types";

import { usePagedList } from "./use-paged-list";

/**
 * Pedidos de troca de profissao. Aprovar muda a conta, a organizacao e o perfil
 * de uma vez, com registro na mesma transacao; recusar so fecha o pedido.
 *
 * Os dois exigem justificativa. Nao e formalidade: quem ler a trilha meses
 * depois precisa saber por que aquele cadastro deixou de ser o que era.
 */
const STATUS: Record<ProfessionChangeStatus, { label: string; tone: "accent" | "success" | "danger" }> = {
  PENDING: { label: "Aguardando", tone: "accent" },
  APPROVED: { label: "Aprovado", tone: "success" },
  REJECTED: { label: "Recusado", tone: "danger" },
};

export function ProfessionRequestsPanel() {
  const reader = platformAccessReader();
  const fetchRequests = useCallback(
    (request: PageRequest) => reader.allProfessionChangeRequests(request),
    [reader],
  );
  const pedidos = usePagedList(fetchRequests, "Não foi possível carregar os pedidos.");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(organizationId: string, decision: "APPROVED" | "REJECTED") {
    setBusy(true);
    setError("");
    try {
      await authAdapter.decideProfessionChange(organizationId, decision, reason);
      setDeciding(null);
      setReason("");
      await pedidos.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível responder ao pedido.");
    } finally {
      setBusy(false);
    }
  }

  const curto = reason.trim().length < PROFESSION_CHANGE_REASON_LENGTH.min;

  return (
    <section className="space-y-4" aria-busy={pedidos.status === "loading" || undefined}>
      <div>
        <h2 className="text-foreground font-semibold">Pedidos de troca de profissão</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          A profissão define vocabulário, taxonomia e o que um aviso pode revelar. Aprovar muda tudo
          isso; o registro do conselho anterior é apagado, porque não vale para a profissão nova.
        </p>
      </div>

      {pedidos.status === "loading" ? (
        <p role="status" className="text-muted-foreground text-sm">
          Carregando pedidos...
        </p>
      ) : null}
      {pedidos.status === "error" ? (
        <p role="alert" className="text-danger-soft-foreground bg-danger-soft rounded-lg px-3 py-2 text-sm">
          {pedidos.error}
        </p>
      ) : null}
      {pedidos.status === "ready" && pedidos.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum pedido até agora.</p>
      ) : null}

      {pedidos.items.map((pedido) => (
        <article
          key={pedido.organizationId}
          aria-labelledby={`pedido-${pedido.organizationId}`}
          className="bg-surface border-border space-y-3 rounded-xl border p-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`pedido-${pedido.organizationId}`} className="text-foreground font-medium">
              {getProfession(pedido.from).label} → {getProfession(pedido.to).label}
            </h3>
            <Badge tone={STATUS[pedido.status].tone}>{STATUS[pedido.status].label}</Badge>
          </div>
          <p className="text-muted-foreground text-sm break-words">
            Organização {pedido.organizationId} · pedido em {formatDateTime(pedido.requestedAt)}
          </p>
          <p className="text-foreground text-sm">{pedido.reason}</p>
          {pedido.status !== "PENDING" && pedido.decidedAt ? (
            <p className="text-muted-foreground text-sm">
              Respondido em {formatDateTime(pedido.decidedAt)}
              {pedido.decisionReason ? `: ${pedido.decisionReason}` : "."}
            </p>
          ) : null}

          {pedido.status === "PENDING" ? (
            deciding === pedido.organizationId ? (
              <div className="space-y-3">
                <Field label="Motivo da resposta" hint="Fica na trilha da operadora.">
                  {(props) => (
                    <Textarea
                      {...props}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      minLength={PROFESSION_CHANGE_REASON_LENGTH.min}
                      maxLength={PROFESSION_CHANGE_REASON_LENGTH.max}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void decide(pedido.organizationId, "APPROVED")}
                    disabled={busy || curto}
                  >
                    Aprovar
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void decide(pedido.organizationId, "REJECTED")}
                    disabled={busy || curto}
                  >
                    Recusar
                  </Button>
                  <Button variant="ghost" onClick={() => setDeciding(null)} disabled={busy}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setDeciding(pedido.organizationId);
                  setReason("");
                  setError("");
                }}
              >
                Responder
              </Button>
            )
          ) : null}
        </article>
      ))}

      {error ? (
        <p role="alert" className="text-danger-soft-foreground bg-danger-soft rounded-lg px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <LoadMore
        page={pedidos.page}
        summary={`Mostrando os ${pedidos.items.length} pedidos mais recentes.`}
        label="Carregar pedidos anteriores"
        onLoadMore={() => void pedidos.loadMore()}
      />
    </section>
  );
}
