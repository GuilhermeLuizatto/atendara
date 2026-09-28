"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Field, FormActions, Input } from "@/components/ui/form";
import { MaskedInput } from "@/components/ui/masked-input";
import {
  RECEIPT_LIMITS,
  documentInputError,
  formatDocument,
  formatDocumentInput,
  validateIssuer,
} from "@/lib/finance/receipts";
import { addressFromCep, cepDigits, formatCepInput, lookupCep } from "@/lib/geo/cep";
import {
  loadMunicipalities,
  municipalityLabel,
  resolveMunicipality,
  searchMunicipalities,
  type Municipality,
} from "@/lib/geo/municipalities";
import { cn } from "@/lib/utils/cn";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";

type CepStatus = { tone: "info" | "danger"; text: string } | null;
type CepFill = { address: string; caret: number; city: string | null; hasStreet: boolean };

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
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [cep, setCep] = useState("");
  const [cepStatus, setCepStatus] = useState<CepStatus>(null);
  const [cepOffer, setCepOffer] = useState<CepFill | null>(null);
  const [address, setAddress] = useState(current?.issuerAddress ?? "");
  const [city, setCity] = useState(current?.issuerCity ?? "");
  const [cityError, setCityError] = useState<string | null>(null);
  const [municipalities, setMunicipalities] = useState<Municipality[] | null>(null);
  const [municipalitiesFailed, setMunicipalitiesFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cepRequest = useRef(0);
  // Onde o numero entra no endereco vindo do CEP. O cursor so vai para la
  // quando a pessoa entra no campo: mover o foco sozinho desorienta quem usa
  // leitor de tela.
  const addressCaret = useRef<number | null>(null);
  // Ultimo endereco posto pelo CEP, ainda sem edicao: esse pode ser trocado.
  const autoAddress = useRef<string | null>(null);
  const canEdit = session?.permissions.includes("receiptSettings:update") ?? false;

  useEffect(() => {
    let active = true;
    loadMunicipalities()
      .then((index) => {
        if (active) setMunicipalities(index);
      })
      .catch(() => {
        if (active) setMunicipalitiesFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const suggestions = municipalities ? searchMunicipalities(municipalities, city) : [];

  async function changeCep(formatted: string) {
    setCep(formatted);
    setCepOffer(null);
    const request = ++cepRequest.current;
    if (cepDigits(formatted).length !== 8) {
      setCepStatus(null);
      return;
    }
    setCepStatus({ tone: "info", text: "Buscando o endereço no ViaCEP..." });
    const result = await lookupCep(formatted);
    if (request !== cepRequest.current) return;
    if (!result.ok) {
      setCepStatus({ tone: "danger", text: result.error });
      return;
    }
    const line = addressFromCep(result.value, formatted);
    const index = municipalities ?? (await loadMunicipalities().catch(() => null));
    if (request !== cepRequest.current) return;
    const found = index ? resolveMunicipality(index, municipalityLabel(result.value.city, result.value.state)) : null;
    const fill: CepFill = { address: line.text, caret: line.caret, city: found?.label ?? null, hasStreet: Boolean(result.value.street) };
    // Endereco digitado a mao (com numero e complemento) nao se perde por
    // causa de um CEP: so se troca o que esta vazio ou o que o proprio CEP pos.
    if (!address.trim() || address === autoAddress.current) {
      applyCepFill(fill);
      return;
    }
    setCepOffer(fill);
    setCepStatus({ tone: "info", text: `Endereço do CEP: ${line.text}. O endereço que já estava no campo foi mantido.` });
  }

  function applyCepFill(fill: CepFill) {
    setAddress(fill.address);
    autoAddress.current = fill.address;
    addressCaret.current = fill.caret;
    setCepOffer(null);
    if (fill.city) {
      setCity(fill.city);
      setCityError(null);
    }
    const next = fill.hasStreet
      ? "Endereço preenchido pelo CEP. Complete com o número e o complemento."
      : "Este CEP vale para a cidade inteira. Digite a rua e o número no começo do endereço.";
    setCepStatus({ tone: "info", text: fill.city ? next : `${next} Escolha a cidade na lista.` });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const documentMessage = documentInputError(document);
    setDocumentError(documentMessage);
    if (!municipalities) {
      setError(
        municipalitiesFailed
          ? "Não foi possível carregar a lista de cidades. Recarregue a página."
          : "A lista de cidades ainda está carregando. Tente de novo em instantes.",
      );
      return;
    }
    const municipality = resolveMunicipality(municipalities, city);
    const cityMessage = city.trim() && !municipality ? "Escolha a cidade da emissão na lista de sugestões." : null;
    setCityError(cityMessage);
    if (documentMessage || cityMessage) {
      setError(null);
      return;
    }
    const issuerCity = municipality?.label ?? "";
    const validation = validateIssuer({ issuerName: name, issuerDocument: document, issuerAddress: address, issuerCity });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (municipality) setCity(municipality.label);
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
          <Field
            label="CPF ou CNPJ"
            required
            hint="CPF para quem atende como pessoa física; CNPJ para a clínica, inclusive o novo, com letras."
            error={documentError ?? undefined}
          >
            {(props) => (
              <MaskedInput
                {...props}
                required
                maxLength={18}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                invalid={Boolean(documentError)}
                value={document}
                format={formatDocumentInput}
                onValueChange={(formatted) => {
                  setDocument(formatted);
                  setDocumentError(null);
                }}
                onBlur={() => setDocumentError(documentInputError(document))}
              />
            )}
          </Field>
          <div className="space-y-1">
            <Field label="CEP" hint="Opcional. Com o CEP completo, o endereço é buscado no ViaCEP; só o CEP sai do navegador, e ele não é gravado.">
              {(props) => (
                <MaskedInput
                  {...props}
                  inputMode="numeric"
                  maxLength={9}
                  autoComplete="postal-code"
                  value={cep}
                  format={formatCepInput}
                  onValueChange={changeCep}
                />
              )}
            </Field>
            <p role="status" className={cn("text-xs", cepStatus?.tone === "danger" ? "text-danger" : "text-muted-foreground")}>
              {cepStatus?.text ?? ""}
            </p>
            {cepOffer && (
              <Button type="button" variant="secondary" size="sm" onClick={() => applyCepFill(cepOffer)}>
                Usar o endereço do CEP
              </Button>
            )}
          </div>
          <div className="sm:col-span-2">
            <Field label="Endereço" required>
              {(props) => (
                <Input
                  {...props}
                  required
                  maxLength={RECEIPT_LIMITS.addressMax}
                  value={address}
                  onChange={(e) => {
                    addressCaret.current = null;
                    setAddress(e.target.value);
                  }}
                  onFocus={(e) => {
                    const caret = addressCaret.current;
                    addressCaret.current = null;
                    if (caret === null) return;
                    const element = e.currentTarget;
                    // Depois do clique, que tambem posiciona o cursor.
                    setTimeout(() => element.setSelectionRange(caret, caret), 0);
                  }}
                />
              )}
            </Field>
          </div>
          <Field
            label="Cidade da emissão"
            required
            hint="Escolha na lista de cidades do IBGE. O recibo mostra cidade e UF, como Santos/SP."
            error={cityError ?? undefined}
          >
            {(props) => (
              <Combobox
                {...props}
                required
                maxLength={RECEIPT_LIMITS.cityMax}
                invalid={Boolean(cityError)}
                value={city}
                options={suggestions.map((entry) => ({ value: entry.label, label: entry.name, hint: entry.state }))}
                onValueChange={(text) => {
                  setCity(text);
                  setCityError(null);
                }}
                onSelect={(option) => {
                  setCity(option.value);
                  setCityError(null);
                }}
                emptyMessage={
                  municipalities
                    ? "Nenhuma cidade do Brasil com esse nome."
                    : municipalitiesFailed
                      ? "Não foi possível carregar a lista de cidades. Recarregue a página."
                      : "Carregando a lista de cidades..."
                }
              />
            )}
          </Field>
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
