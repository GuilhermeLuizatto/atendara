"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/form";
import { PAYMENT_PROOF_LIMITS, type PublicPaymentView } from "@/lib/finance/payment-proof";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";
import { fileToBase64, paymentLinks } from "@/services/payment-links";

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm">Carregando cobrança…</div>}>
      <PaymentContent />
    </Suspense>
  );
}

function PaymentContent() {
  const token = useSearchParams().get("token") ?? "";
  const [view, setView] = useState<PublicPaymentView | null>(null);
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => {
      void paymentLinks
        .inspect(token)
        .then(setView)
        .catch((error: Error) => setNotice(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (file.size > PAYMENT_PROOF_LIMITS.maxBytes) {
      setNotice("O arquivo passa de 5 MB. Envie um print ou um PDF menor.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await paymentLinks.submitProof(token, await fileToBase64(file));
      setSent(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível enviar o comprovante.");
    } finally {
      setBusy(false);
    }
  }

  const awaiting = view?.proof === "SUBMITTED" || sent;

  return (
    <main data-accent="violet" className="bg-background flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{view ? view.organizationName : "Cobrança"}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {!token ? (
            <p role="status" className="text-muted-foreground text-sm">O link está incompleto. Peça um novo a quem enviou.</p>
          ) : !view ? (
            <p role="status" className="text-muted-foreground text-sm">{notice || "Conferindo a cobrança…"}</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Referente a</dt>
                  <dd className="font-medium">{view.description}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Valor</dt>
                  <dd className="text-lg font-semibold">{formatCurrency(view.amountInCents)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Vencimento</dt>
                  <dd className="font-medium">{formatShortDate(view.dueDate)}</dd>
                </div>
              </dl>
              {view.situation === "PAID" ? (
                <p role="status" className="text-success text-sm font-medium">Pagamento já registrado. Obrigado!</p>
              ) : view.situation === "CLOSED" ? (
                <p role="status" className="text-muted-foreground text-sm">Esta cobrança não está mais em aberto.</p>
              ) : awaiting ? (
                <p role="status" className="text-sm">
                  Comprovante recebido. {view.organizationName} vai conferir e registrar o pagamento.
                </p>
              ) : (
                <form className="space-y-4" onSubmit={submit}>
                  <p className="text-muted-foreground text-sm">
                    O Atendara não recebe pagamentos: pague como você combinou com {view.organizationName} e envie aqui o
                    comprovante (print ou PDF, até 5 MB).
                  </p>
                  {view.proof === "REJECTED" && (
                    <p role="alert" className="text-danger text-sm">
                      O comprovante anterior foi recusado{view.rejectionReason ? `: ${view.rejectionReason}` : "."} Envie outro.
                    </p>
                  )}
                  <Field label="Comprovante" required>
                    {(props) => (
                      <input
                        {...props}
                        type="file"
                        required
                        accept="image/png,image/jpeg,image/webp,application/pdf"
                        className="border-input bg-surface block w-full rounded-lg border p-2 text-sm"
                        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                      />
                    )}
                  </Field>
                  <Button type="submit" disabled={busy || !file}>
                    {busy ? "Enviando…" : "Enviar comprovante"}
                  </Button>
                </form>
              )}
              {notice && <p role="alert" className="text-danger text-sm">{notice}</p>}
            </>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
