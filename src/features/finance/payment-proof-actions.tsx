"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormActions, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PAYMENT_PROOF_LIMITS, latestProof, paymentLinkPath } from "@/lib/finance/payment-proof";
import { formatShortDate } from "@/lib/utils/format";
import { useToast } from "@/providers/toast-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import { paymentLinks } from "@/services/payment-links";
import type { PaymentProof, Transaction } from "@/types";

/**
 * Link de pagamento e conferencia do comprovante de um mes (cobrador, C2).
 * Nenhuma mensagem sai: o link e copiado e o profissional manda como quiser.
 */
export function PaymentProofActions({ transaction }: { transaction: Transaction }) {
  const { data, session } = useWorkspace();
  const { run } = useWorkspaceActions();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<PaymentProof | null>(null);
  if (!data) return null;

  const canLink = session?.permissions.includes("transaction:create") ?? false;
  const canReview = session?.permissions.includes("transaction:update") ?? false;
  const open = transaction.status === "PENDING" || transaction.status === "OVERDUE";
  const proof = latestProof(data.paymentProofs ?? [], transaction.id);
  const link = (data.paymentLinks ?? []).find((item) => item.transactionId === transaction.id);

  async function copyLink(renew: boolean) {
    setBusy(true);
    try {
      const token = renew || !link ? (await paymentLinks.create(transaction.id)).token : link.token;
      const url = `${window.location.origin}${paymentLinkPath(token)}`;
      await navigator.clipboard.writeText(url);
      show(renew ? "Novo link copiado. O anterior deixou de valer." : "Link de pagamento copiado.", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : "Não foi possível gerar o link.", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function viewProof(item: PaymentProof) {
    try {
      window.open(await paymentLinks.proofUrl(item.storagePath), "_blank", "noopener,noreferrer");
    } catch {
      show("Não foi possível abrir o comprovante.", "danger");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {proof?.status === "SUBMITTED" && <Badge tone="warning">Comprovante enviado em {formatShortDate(proof.submittedAt)}</Badge>}
      {proof?.status === "REJECTED" && open && <Badge tone="neutral">Comprovante recusado</Badge>}
      {proof?.status === "APPROVED" && <Badge tone="success">Comprovante aprovado</Badge>}
      {proof && (
        <Button variant="ghost" size="sm" onClick={() => void viewProof(proof)}>
          Ver comprovante
        </Button>
      )}
      {canReview && proof?.status === "SUBMITTED" && (
        <>
          <Button size="sm" onClick={() => void run((repo) => repo.approvePaymentProof(proof.id).then(() => true), "Comprovante aprovado; mês marcado como pago.")}>
            Aprovar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRejecting(proof)}>
            Recusar
          </Button>
        </>
      )}
      {canLink && open && (
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void copyLink(false)}>
            {link ? "Copiar link de pagamento" : "Gerar link de pagamento"}
          </Button>
          {link && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void copyLink(true)}>
              Novo link
            </Button>
          )}
        </>
      )}
      {rejecting && <RejectDialog proof={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}

function RejectDialog({ proof, onClose }: { proof: PaymentProof; onClose: () => void }) {
  const { run } = useWorkspaceActions();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Modal open onClose={onClose} title="Recusar comprovante" description="O motivo aparece para a pessoa no link, e ela pode enviar outro." size="sm">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          const done = await run((repo) => repo.rejectPaymentProof(proof.id, reason).then(() => true), "Comprovante recusado.");
          setSaving(false);
          if (done) onClose();
        }}
      >
        <Field label="Motivo" required>
          {(props) => (
            <Input
              {...props}
              required
              maxLength={PAYMENT_PROOF_LIMITS.rejectionReasonMax}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: o valor do comprovante é diferente"
            />
          )}
        </Field>
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving || !reason.trim()}>
            {saving ? "Recusando..." : "Recusar comprovante"}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
