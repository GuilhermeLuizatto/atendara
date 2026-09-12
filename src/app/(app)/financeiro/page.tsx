"use client";

import { Wallet } from "lucide-react";
import { useMemo } from "react";

import {
  ModulePlaceholder,
  type ModuleStat,
} from "@/components/layout/module-placeholder";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadMore } from "@/components/ui/load-more";
import { formatCurrencyCompact } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { TransactionStatus } from "@/types";

export default function FinancePage() {
  const { data, terminology } = useWorkspace();
  const { loadMore } = useWorkspaceActions();

  const stats = useMemo<ModuleStat[] | null>(() => {
    if (!data) return null;

    const sumIncome = (status: TransactionStatus) =>
      data.transactions
        .filter(
          (transaction) =>
            transaction.type === "INCOME" && transaction.status === status,
        )
        .reduce((total, transaction) => total + transaction.amountInCents, 0);

    const expenses = data.transactions
      .filter((transaction) => transaction.type === "EXPENSE")
      .reduce((total, transaction) => total + transaction.amountInCents, 0);

    const paid = sumIncome("PAID");
    const overdue = sumIncome("OVERDUE");

    return [
      {
        label: "Recebido",
        value: formatCurrencyCompact(paid),
        tone: "success",
      },
      {
        label: "A receber",
        value: formatCurrencyCompact(sumIncome("PENDING")),
        hint: "Atendimentos agendados",
      },
      {
        label: "Em atraso",
        value: formatCurrencyCompact(overdue),
        tone: overdue > 0 ? "danger" : "default",
      },
      {
        label: "Resultado",
        value: formatCurrencyCompact(paid - expenses),
        hint: "Recebido menos despesas",
      },
    ];
  }, [data]);

  const page = data?.pagination?.transactions;

  return (
    <div className="space-y-6">
      <ModulePlaceholder
        title="Financeiro"
        description="Receitas, pendências e atrasos derivados da agenda. Valores em centavos, sem ponto flutuante."
        phase="Fase 1"
        stats={stats}
        upcoming={[
          "Lançamento manual de receitas e despesas",
          "Filtros por período, status, cliente e forma de pagamento",
          "Conciliação entre atendimento realizado e pagamento",
          "Arquitetura preparada para gateways de cobrança",
        ]}
      />

      {data && data.transactions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="size-5" aria-hidden />}
            title="Nenhum lançamento ainda"
            description={`As receitas aparecem aqui quando você marca ${terminology.appointment.pluralLower} com valor na agenda. Os indicadores acima começam em zero.`}
          />
        </Card>
      ) : null}

      {page ? (
        <Card>
          <LoadMore
            page={page}
            summary={`Indicadores calculados sobre os ${data?.transactions.length ?? 0} lançamentos mais recentes. Os mais antigos ainda não foram carregados.`}
            label="Carregar lançamentos anteriores"
            onLoadMore={() => void loadMore("transactions")}
          />
        </Card>
      ) : null}
    </div>
  );
}
