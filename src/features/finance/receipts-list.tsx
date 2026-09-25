"use client";

import { ReceiptText } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { maskDocument } from "@/lib/finance/receipts";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";
import { useWorkspace } from "@/providers/workspace-provider";

/** Recibos emitidos, do mais recente para o mais antigo. CPF so mascarado aqui. */
export function ReceiptsList() {
  const { data } = useWorkspace();
  if (!data) return null;
  const receipts = data.receipts ?? [];
  return (
    <Card className="overflow-hidden">
      <div className="border-border border-b p-4">
        <h2 className="font-semibold">Recibos</h2>
        <p className="text-muted-foreground text-xs">
          Emitidos a partir de receitas pagas. Cancelado continua na sequência, com o motivo.
        </p>
      </div>
      {receipts.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="size-5" aria-hidden />}
          title="Nenhum recibo emitido"
          description="Numa receita paga, use Emitir recibo. Antes do primeiro, preencha o emissor em Configurações → Recibos."
        />
      ) : (
        <ul className="divide-border divide-y">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">Nº {String(receipt.number).padStart(6, "0")}</p>
                  <Badge tone={receipt.status === "ISSUED" ? "success" : "neutral"}>{receipt.status === "ISSUED" ? "Emitido" : "Cancelado"}</Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {receipt.payerName}
                  {receipt.payerDocument ? ` · ${maskDocument(receipt.payerDocument)}` : ""} · {formatShortDate(receipt.issuedAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold">{formatCurrency(receipt.amountInCents)}</p>
                <Link href={`/financeiro/recibo?id=${encodeURIComponent(receipt.id)}`} className={buttonStyles({ variant: "outline", size: "sm" })}>
                  Abrir
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
