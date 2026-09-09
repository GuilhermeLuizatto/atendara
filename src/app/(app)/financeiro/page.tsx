"use client";

import { useMemo } from "react";

import {
  ModulePlaceholder,
  type ModuleStat,
} from "@/components/layout/module-placeholder";
import { formatCurrencyCompact } from "@/lib/utils/format";
import { useWorkspace } from "@/providers/workspace-provider";
import type { TransactionStatus } from "@/types";

export default function FinancePage() {
  const { data } = useWorkspace();

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

  return (
    <ModulePlaceholder
      title="Financeiro"
      description="Receitas, pendencias e atrasos derivados da agenda. Valores em centavos, sem ponto flutuante."
      phase="Fase 1"
      stats={stats}
      upcoming={[
        "Lancamento manual de receitas e despesas",
        "Filtros por periodo, status, cliente e forma de pagamento",
        "Conciliacao entre atendimento realizado e pagamento",
        "Arquitetura preparada para gateways de cobranca",
      ]}
    />
  );
}
