"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormActions, Input } from "@/components/ui/form";
import { RECEIPT_LIMITS, formatDocument, validateIssuer } from "@/lib/finance/receipts";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";

/**
 * Quem emite os recibos (C3): preenchido uma vez. Para o autonomo, e ele; para
 * a clinica com CNPJ, a clinica. Mudar aqui nao altera recibo ja emitido.
 */
export function ReceiptSettingsForm() {
  const { data, session } = useWorkspace();
  const { run } = useWorkspaceActions();
  const current = data?.receiptSettings ?? null;
  const [name, setName] = useState(current?.issuerName ?? data?.organization.name ?? "");
  const [document, setDocument] = useState(current ? formatDocument(current.issuerDocument) : "");
  const [address, setAddress] = useState(current?.issuerAddress ?? "");
  const [city, setCity] = useState(current?.issuerCity ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = session?.permissions.includes("receiptSettings:update") ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = { issuerName: name, issuerDocument: document, issuerAddress: address, issuerCity: city };
    const validation = validateIssuer(input);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    setSaving(true);
    await run((repo) => repo.updateReceiptSettings(validation.value), "Emissor dos recibos salvo.");
    setSaving(false);
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Recibos</h2>
        <p className="text-muted-foreground text-sm">
          Quem aparece como emissor dos recibos de pagamento. Recibo já emitido guarda os dados do dia em que saiu.
        </p>
      </div>
      {!canEdit && (
        <p className="text-muted-foreground text-sm">Somente a administração ou o titular da organização altera o emissor.</p>
      )}
      <form className="space-y-4" onSubmit={submit}>
        <fieldset disabled={!canEdit || saving} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Nome de quem emite" required>
              {(props) => <Input {...props} required maxLength={RECEIPT_LIMITS.nameMax} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </div>
          <Field label="CPF ou CNPJ" required hint="CPF para quem atende como pessoa física; CNPJ para a clínica.">
            {(props) => <Input {...props} required inputMode="numeric" value={document} onChange={(e) => setDocument(e.target.value)} />}
          </Field>
          <Field label="Cidade da emissão" required>
            {(props) => <Input {...props} required maxLength={RECEIPT_LIMITS.cityMax} value={city} onChange={(e) => setCity(e.target.value)} />}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Endereço" required>
              {(props) => <Input {...props} required maxLength={RECEIPT_LIMITS.addressMax} value={address} onChange={(e) => setAddress(e.target.value)} />}
            </Field>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        {canEdit && (
          <FormActions>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar emissor"}
            </Button>
          </FormActions>
        )}
      </form>
    </Card>
  );
}
