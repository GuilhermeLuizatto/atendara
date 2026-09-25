"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { Button, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormActions, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { SkeletonCard } from "@/components/ui/skeleton";
import { PAYMENT_METHOD_LABELS } from "@/config/labels";
import { RECEIPT_LIMITS, cancelReasonError, formatDocument } from "@/lib/finance/receipts";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useToast } from "@/providers/toast-provider";
import { useWorkspace } from "@/providers/workspace-provider";
import { receiptsService } from "@/services/receipts";
import type { Receipt } from "@/types";

export default function ReceiptPage() {
  return (
    <Suspense fallback={<SkeletonCard lines={8} />}>
      <ReceiptContent />
    </Suspense>
  );
}

function ReceiptContent() {
  const id = useSearchParams().get("id") ?? "";
  const { data, session } = useWorkspace();
  const [cancelling, setCancelling] = useState(false);
  if (!data) return <SkeletonCard lines={8} />;
  const receipt = (data.receipts ?? []).find((item) => item.id === id);
  if (!receipt) {
    return (
      <Card className="space-y-3 p-5">
        <p>Recibo não encontrado.</p>
        <Link href="/financeiro" className={buttonStyles({ variant: "outline", size: "sm" })}>
          Voltar ao financeiro
        </Link>
      </Card>
    );
  }
  const canCancel = receipt.status === "ISSUED" && (session?.permissions.includes("receipt:cancel") ?? false);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button onClick={() => window.print()}>Imprimir ou salvar em PDF</Button>
        <Link href="/financeiro" className={buttonStyles({ variant: "outline" })}>
          Voltar ao financeiro
        </Link>
        {canCancel && (
          <Button variant="ghost" onClick={() => setCancelling(true)}>
            Cancelar recibo
          </Button>
        )}
      </div>
      <ReceiptDocument receipt={receipt} />
      {cancelling && <CancelDialog receipt={receipt} onClose={() => setCancelling(false)} />}
    </div>
  );
}

/** O documento impresso. Tudo sai do registro gravado, nunca do cadastro atual. */
function ReceiptDocument({ receipt }: { receipt: Receipt }) {
  const payerDocument = receipt.payerDocument ? `, ${receipt.payerDocument.length === 14 ? "CNPJ" : "CPF"} ${formatDocument(receipt.payerDocument)}` : "";
  const beneficiary = receipt.beneficiaryName
    ? `, prestado a ${receipt.beneficiaryName}${receipt.beneficiaryDocument ? ` (CPF ${formatDocument(receipt.beneficiaryDocument)})` : ""}`
    : "";
  const cancelled = receipt.status === "CANCELLED";
  return (
    <Card className="relative space-y-6 p-8 print:border-0 print:shadow-none">
      {cancelled && (
        <p role="status" className="border-danger text-danger rounded-lg border-2 p-3 text-center font-semibold">
          CANCELADO em {formatDate(receipt.cancelledAt!)} — {receipt.cancellationReason}
        </p>
      )}
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-wide">RECIBO</h1>
        <p className="text-lg font-semibold">Nº {String(receipt.number).padStart(6, "0")}</p>
      </div>
      <p className="text-right text-2xl font-semibold">{formatCurrency(receipt.amountInCents)}</p>
      <p className="leading-relaxed">
        Recebi de <strong>{receipt.payerName}</strong>
        {payerDocument} a importância de <strong>{formatCurrency(receipt.amountInCents)}</strong> ({receipt.amountInWords}), referente a{" "}
        {receipt.description}
        {beneficiary}. Pagamento em {formatDate(receipt.paidAt)}
        {receipt.method ? `, por ${PAYMENT_METHOD_LABELS[receipt.method].toLowerCase()}` : ""}.
      </p>
      <p>
        {receipt.issuerCity}, {formatDate(receipt.issuedAt)}.
      </p>
      <div className="space-y-1 pt-10">
        <div className="border-foreground w-72 max-w-full border-t" />
        <p className="font-medium">{receipt.issuerName}</p>
        <p className="text-sm">
          {receipt.issuerDocument.length === 14 ? "CNPJ" : "CPF"} {formatDocument(receipt.issuerDocument)}
          {receipt.issuerRegistry ? ` · ${receipt.issuerRegistry}` : ""}
        </p>
        <p className="text-sm">{receipt.issuerAddress}</p>
      </div>
      {receipt.officialTaxReceipt === "RECEITA_SAUDE" && (
        <p className="text-muted-foreground text-xs">
          Comprovante de pagamento. Para dedução no Imposto de Renda, o recibo de saúde de pessoa física é emitido no Receita Saúde.
        </p>
      )}
      <p className="text-muted-foreground font-mono text-xs">Código de conferência: {receipt.contentHash.slice(0, 16)}</p>
    </Card>
  );
}

function CancelDialog({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const { show } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = cancelReasonError(reason);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await receiptsService.cancel(receipt.id, reason.trim());
      show(`Recibo nº ${receipt.number} cancelado.`, "success");
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Não foi possível cancelar o recibo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Cancelar recibo nº ${receipt.number}`} description="O número continua na sequência, marcado como cancelado. Depois, emita outro no lançamento." size="sm">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Motivo" required>
          {(props) => <Input {...props} required maxLength={RECEIPT_LIMITS.cancelReasonMax} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Cancelando..." : "Cancelar recibo"}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
