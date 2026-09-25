"use client";

import { CalendarClock, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TRANSACTION_STATUS_LABELS } from "@/config/labels";
import {
  chargeHistory,
  periodLabel,
  periodOf,
  shiftPeriod,
  summarizeMonth,
} from "@/lib/finance/recurring";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";
import { useNow } from "@/lib/utils/use-now";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { RecurringCharge, Transaction } from "@/types";

import { PaymentProofActions } from "./payment-proof-actions";
import { ReceiptAction } from "./receipt-action";
import { RecurringForm } from "./recurring-form";

type Tone = "success" | "warning" | "danger" | "neutral";

const MONTH_TONES: Record<Transaction["status"], Tone> = {
  PAID: "success",
  PENDING: "warning",
  OVERDUE: "danger",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
};

/** "Setembro de 2026": so a primeira letra sobe — `capitalize` do CSS subiria o "de". */
function monthTitle(period: string): string {
  const label = periodLabel(period);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const CHARGE_STATUS_LABELS: Record<RecurringCharge["status"], string> = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  ENDED: "Encerrada",
};

export function RecurringView() {
  const { data, session, terminology } = useWorkspace();
  const { run } = useWorkspaceActions();
  const now = useNow();
  const currentPeriod = periodOf(now);
  const [period, setPeriod] = useState(currentPeriod);
  const [editing, setEditing] = useState<RecurringCharge | "new" | null>(null);
  const [ending, setEnding] = useState<RecurringCharge | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;

  const canCreate = session?.permissions.includes("transaction:create") ?? false;
  const canUpdate = session?.permissions.includes("transaction:update") ?? false;
  const charges = data.recurringCharges ?? [];
  const month = summarizeMonth(charges, data.transactions, period);
  const percent = month.collectionRate === null ? "—" : `${Math.round(month.collectionRate * 100)}%`;

  const setStatus = (charge: RecurringCharge, status: RecurringCharge["status"], message: string) =>
    run((repo) => repo.setRecurringChargeStatus(charge.id, status).then(() => true), message);
  const markPaid = (transaction: Transaction) =>
    run((repo) => repo.updateTransaction(transaction.id, { status: "PAID" }).then(() => true), "Mês marcado como pago.");

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => setPeriod(shiftPeriod(period, -1))}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <h2 className="min-w-40 text-center font-semibold">{monthTitle(period)}</h2>
          <Button variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => setPeriod(shiftPeriod(period, 1))}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          {period !== currentPeriod && (
            <Button variant="outline" size="sm" onClick={() => setPeriod(currentPeriod)}>
              Mês atual
            </Button>
          )}
        </div>
        {canCreate && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Nova mensalidade
          </Button>
        )}
      </Card>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(
          [
            ["Previsto no mês", formatCurrency(month.expectedInCents), "neutral"],
            ["Recebido", formatCurrency(month.receivedInCents), "success"],
            ["A receber", formatCurrency(month.pendingInCents), "warning"],
            ["Em atraso", formatCurrency(month.overdueInCents), month.overdueInCents ? "danger" : "neutral"],
            ["Taxa de recebimento", percent, "neutral"],
          ] as const
        ).map(([label, value, tone]) => (
          <Card key={label} className="p-4">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className={`mt-2 text-lg font-semibold ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-foreground"}`}>
              {value}
            </dd>
          </Card>
        ))}
      </dl>
      {data.pagination?.transactions?.hasMore && (
        <p role="status" className="text-warning-soft-foreground text-sm">
          Amostra parcial: há lançamentos antigos ainda não carregados no Financeiro.
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="border-border border-b p-4">
          <h2 className="font-semibold">Mensalidades · {month.activeCharges} ativa(s)</h2>
          <p className="text-muted-foreground text-xs">
            O pagamento vai direto para você. O Atendara lança cada mês e mostra quem pagou. Nenhuma mensagem sai sozinha: copie o link de pagamento e envie como preferir; o comprovante chega aqui para você conferir.
          </p>
        </div>
        {month.rows.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-5" aria-hidden />}
            title="Nenhuma mensalidade neste mês"
            description={`Crie uma mensalidade para cada ${terminology.client.singularLower} com cobrança recorrente.`}
          />
        ) : (
          <ul className="divide-border divide-y">
            {month.rows.map(({ charge, transaction }) => (
              <li key={charge.id} className="space-y-3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{charge.clientName ?? "Cadastro removido"}</p>
                      {transaction ? (
                        <Badge tone={MONTH_TONES[transaction.status]}>{TRANSACTION_STATUS_LABELS[transaction.status]}</Badge>
                      ) : (
                        <Badge tone="neutral">{charge.status === "ACTIVE" ? "Mês ainda não lançado" : CHARGE_STATUS_LABELS[charge.status]}</Badge>
                      )}
                      {charge.status !== "ACTIVE" && transaction && <Badge tone="neutral">{CHARGE_STATUS_LABELS[charge.status]}</Badge>}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {charge.description} · todo dia {charge.dueDay}
                      {transaction?.paidAt ? ` · pago em ${formatShortDate(transaction.paidAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <p className="text-sm font-semibold">{formatCurrency(transaction?.amountInCents ?? charge.amountInCents)}</p>
                    {canUpdate && transaction && (transaction.status === "PENDING" || transaction.status === "OVERDUE") && (
                      <Button size="sm" onClick={() => void markPaid(transaction)}>
                        Marcar como pago
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" aria-expanded={open === charge.id} onClick={() => setOpen(open === charge.id ? null : charge.id)}>
                      Histórico
                    </Button>
                    {canUpdate && charge.status !== "ENDED" && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(charge)}>
                          Editar
                        </Button>
                        {charge.status === "ACTIVE" ? (
                          <Button variant="ghost" size="sm" onClick={() => void setStatus(charge, "PAUSED", "Mensalidade pausada.")}>
                            Pausar
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => void setStatus(charge, "ACTIVE", "Mensalidade retomada.")}>
                            Retomar
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEnding(charge)}>
                          Encerrar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {transaction && (
                  <div className="flex flex-wrap items-center gap-2">
                    <PaymentProofActions transaction={transaction} />
                    <ReceiptAction transaction={transaction} />
                  </div>
                )}
                {open === charge.id && <History charge={charge} transactions={data.transactions} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <RecurringForm charge={editing === "new" ? null : editing} currentPeriod={currentPeriod} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(ending)}
        onClose={() => setEnding(null)}
        onConfirm={() => {
          if (ending) void setStatus(ending, "ENDED", "Mensalidade encerrada.");
        }}
        title="Encerrar mensalidade"
        message={`Encerrar a mensalidade de ${ending?.clientName ?? "este cadastro"}? Nenhum mês novo será lançado; os meses já lançados continuam no Financeiro. Encerrada não volta: para cobrar de novo, crie outra.`}
        confirmLabel="Encerrar mensalidade"
      />
    </div>
  );
}

function History({ charge, transactions }: { charge: RecurringCharge; transactions: readonly Transaction[] }) {
  const history = chargeHistory(charge.id, transactions);
  if (history.length === 0) return <p className="text-muted-foreground text-sm">Nenhum mês lançado ainda.</p>;
  return (
    <ol className="bg-surface-muted grid gap-2 rounded-lg p-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Histórico de ${charge.clientName ?? "cadastro"}`}>
      {history.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
          <span>{item.period ? monthTitle(item.period) : "—"}</span>
          <Badge tone={MONTH_TONES[item.status]}>{TRANSACTION_STATUS_LABELS[item.status]}</Badge>
        </li>
      ))}
    </ol>
  );
}
