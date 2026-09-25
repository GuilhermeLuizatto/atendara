"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, buttonStyles } from "@/components/ui/button";
import { Field, FormActions, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { getProfession } from "@/config/professions";
import { RECEIPT_LIMITS, validateReceiptRequest } from "@/lib/finance/receipts";
import { formatCurrency } from "@/lib/utils/format";
import { useToast } from "@/providers/toast-provider";
import { useWorkspace } from "@/providers/workspace-provider";
import { receiptsService } from "@/services/receipts";
import type { Transaction } from "@/types";

/** "Emitir recibo" numa receita paga, ou o atalho para o recibo ja emitido. */
export function ReceiptAction({ transaction }: { transaction: Transaction }) {
  const { data, session } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (!data || transaction.type !== "INCOME" || transaction.status !== "PAID") return null;
  const issued = (data.receipts ?? []).find((item) => item.transactionId === transaction.id && item.status === "ISSUED");
  if (issued) {
    return (
      <Link href={`/financeiro/recibo?id=${encodeURIComponent(issued.id)}`} className={buttonStyles({ variant: "ghost", size: "sm" })}>
        Recibo nº {issued.number}
      </Link>
    );
  }
  if (!session?.permissions.includes("receipt:create")) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Emitir recibo
      </Button>
      {open && <ReceiptForm transaction={transaction} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReceiptForm({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const { data } = useWorkspace();
  const { show } = useToast();
  const router = useRouter();
  const [payerName, setPayerName] = useState(transaction.clientName ?? "");
  const [payerDocument, setPayerDocument] = useState("");
  const [otherBeneficiary, setOtherBeneficiary] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryDocument, setBeneficiaryDocument] = useState("");
  const [description, setDescription] = useState(transaction.description);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!data) return null;
  const taxReceipt = getProfession(data.organization.primaryProfession).officialTaxReceipt;
  const issuerMissing = !data.receiptSettings;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateReceiptRequest({
      payerName,
      payerDocument: payerDocument || null,
      beneficiaryName: otherBeneficiary ? beneficiaryName : null,
      beneficiaryDocument: otherBeneficiary ? beneficiaryDocument || null : null,
      description,
    });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { receiptId, number } = await receiptsService.issue({ transactionId: transaction.id, ...validation.value });
      show(`Recibo nº ${number} emitido.`, "success");
      onClose();
      router.push(`/financeiro/recibo?id=${encodeURIComponent(receiptId)}`);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Não foi possível emitir o recibo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Emitir recibo" description={`${formatCurrency(transaction.amountInCents)} · ${transaction.description}`} size="md">
      {issuerMissing ? (
        <div className="space-y-4">
          <p className="text-sm">Antes do primeiro recibo, preencha quem emite (nome, CPF ou CNPJ, endereço e cidade).</p>
          <FormActions>
            <Button type="button" variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Link href="/configuracoes?secao=recibos" className={buttonStyles()}>
              Ir para Configurações → Recibos
            </Link>
          </FormActions>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          {taxReceipt === "RECEITA_SAUDE" && (
            <p role="note" className="bg-warning-soft text-warning-soft-foreground rounded-lg p-3 text-sm">
              Este recibo comprova o pagamento, mas não vale para dedução no Imposto de Renda: desde 2025, o recibo de saúde de
              pessoa física válido para o IR é emitido no Receita Saúde, no aplicativo da Receita Federal.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quem pagou" required>
              {(props) => <Input {...props} required maxLength={RECEIPT_LIMITS.nameMax} value={payerName} onChange={(e) => setPayerName(e.target.value)} />}
            </Field>
            <Field label="CPF de quem pagou" hint="Opcional.">
              {(props) => <Input {...props} inputMode="numeric" value={payerDocument} onChange={(e) => setPayerDocument(e.target.value)} />}
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={otherBeneficiary} onChange={(e) => setOtherBeneficiary(e.target.checked)} />
            Quem foi atendido é outra pessoa (por exemplo, quem paga é o responsável)
          </label>
          {otherBeneficiary && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quem foi atendido" required>
                {(props) => <Input {...props} required maxLength={RECEIPT_LIMITS.nameMax} value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} />}
              </Field>
              <Field label="CPF de quem foi atendido" hint="Opcional.">
                {(props) => <Input {...props} inputMode="numeric" value={beneficiaryDocument} onChange={(e) => setBeneficiaryDocument(e.target.value)} />}
              </Field>
            </div>
          )}
          <Field label="Referente a" required>
            {(props) => <Input {...props} required maxLength={RECEIPT_LIMITS.descriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <p className="text-muted-foreground text-xs">
            O número é reservado ao emitir. Recibo emitido não muda: um erro se corrige cancelando e emitindo outro.
          </p>
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <FormActions>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Emitindo..." : "Emitir recibo"}
            </Button>
          </FormActions>
        </form>
      )}
    </Modal>
  );
}
