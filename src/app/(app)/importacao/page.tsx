"use client";

import readXlsxFile from "read-excel-file";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { useWorkspace } from "@/providers/workspace-provider";
import { phaseFiveService, type ImportCommitRow } from "@/services/phase-five";
import type { ImportEntityType, ImportMapping } from "@/types";

type RawCell = string | number | boolean | Date | null;
type RawRow = Record<string, RawCell>;
type DuplicateDecision = "IGNORE" | "UPDATE";

interface FieldDefinition { key: string; label: string; required: boolean; }

const ENTITY_LABEL: Record<ImportEntityType, string> = { PROFESSIONALS: "Profissionais", CLIENTS: "Clientes", APPOINTMENTS: "Atendimentos", TRANSACTIONS: "Financeiro" };
const FIELD_TUPLES: Record<ImportEntityType, [string, string, boolean][]> = {
  PROFESSIONALS: [["id", "ID do registro", false], ["displayName", "Nome", true], ["email", "E-mail", true], ["phone", "Telefone", false], ["profession", "Profissão", true], ["licenseNumber", "Registro profissional", false], ["specialties", "Especialidades", true], ["active", "Ativo", true]],
  CLIENTS: [["id", "ID do registro", false], ["fullName", "Nome completo", true], ["preferredName", "Nome preferido", false], ["email", "E-mail", false], ["phone", "Telefone", false], ["status", "Situação", true], ["preferredModality", "Modalidade", true], ["assignedProfessionalId", "ID do profissional", false], ["acquisitionChannel", "Canal de aquisição", true], ["tags", "Tags", true], ["administrativeNotes", "Observação administrativa", false]],
  APPOINTMENTS: [["id", "ID do registro", false], ["clientId", "ID do cliente", true], ["professionalId", "ID do profissional", true], ["startsAt", "Início", true], ["durationMinutes", "Duração em minutos", true], ["modality", "Modalidade", true], ["status", "Situação", true], ["priceInCents", "Valor em centavos", true], ["administrativeNotes", "Observação administrativa", false]],
  TRANSACTIONS: [["id", "ID do registro", false], ["type", "Tipo", true], ["clientId", "ID do cliente", false], ["professionalId", "ID do profissional", false], ["appointmentId", "ID do atendimento", false], ["description", "Descrição", true], ["amountInCents", "Valor em centavos", true], ["status", "Situação", true], ["method", "Forma de pagamento", false], ["dueDate", "Vencimento", true]],
};
const FIELDS = Object.fromEntries(
  Object.entries(FIELD_TUPLES).map(([entity, fields]) => [
    entity,
    fields.map(([key, label, required]) => ({ key, label, required })),
  ]),
) as Record<ImportEntityType, FieldDefinition[]>;

const CLINICAL_TERMS = ["diagnostico", "sintoma", "prontuario", "anamnese", "laudo", "prescricao", "medicamento", "cid", "evolucao clinica", "observacao clinica"];
const nullable = new Set(["id", "phone", "licenseNumber", "preferredName", "email", "assignedProfessionalId", "administrativeNotes", "clientId", "professionalId", "appointmentId", "method"]);
const listFields = new Set(["specialties", "tags"]);
const numericFields = new Set(["durationMinutes", "priceInCents", "amountInCents"]);
const dateFields = new Set(["startsAt", "dueDate"]);

function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function csvLine(line: string): string[] {
  const values: string[] = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"') { if (quoted && line[index + 1] === '"') { current += '"'; index += 1; } else quoted = !quoted; } else if (char === "," && !quoted) { values.push(current); current = ""; } else current += char; }
  values.push(current); return values;
}
function rowsFromMatrix(matrix: RawCell[][]): { headers: string[]; rows: RawRow[] } {
  const headers = (matrix[0] ?? []).map((cell) => String(cell ?? "").trim());
  if (!headers.length || headers.some((header) => !header)) throw new Error("A primeira linha precisa ter o nome de todas as colunas.");
  if (new Set(headers.map(normalize)).size !== headers.length) throw new Error("Há colunas com nomes repetidos.");
  const forbidden = headers.filter((header) => CLINICAL_TERMS.some((term) => normalize(header).includes(term)));
  if (forbidden.length) throw new Error(`Campos clínicos não podem ser importados: ${forbidden.join(", ")}.`);
  return { headers, rows: matrix.slice(1).filter((row) => row.some((cell) => cell !== null && String(cell).trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null]))) };
}
function converted(key: string, value: RawCell): unknown {
  if (value === null || String(value).trim() === "") return nullable.has(key) ? null : listFields.has(key) ? [] : "";
  if (listFields.has(key)) return String(value).split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  if (numericFields.has(key)) { const number = Number(value); return Number.isInteger(number) ? number : Number.NaN; }
  if (dateFields.has(key)) { const date = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(date.getTime()) ? "" : date.toISOString(); }
  if (key === "active") return value === true || ["sim", "true", "1", "ativo"].includes(normalize(String(value)));
  return String(value).trim();
}
function importedEnd(record: Record<string, unknown>) {
  const start = Date.parse(String(record.startsAt ?? ""));
  const duration = Number(record.durationMinutes);
  return Number.isFinite(start) && Number.isFinite(duration) ? new Date(start + duration * 60_000).toISOString() : "";
}
function sameImportedRecord(entity: ImportEntityType, left: Record<string, unknown>, right: Record<string, unknown>) {
  if (entity === "PROFESSIONALS") return normalize(String(left.email ?? "")) === normalize(String(right.email ?? ""));
  if (entity === "CLIENTS") {
    const sameEmail = left.email && right.email && normalize(String(left.email)) === normalize(String(right.email));
    const samePhone = left.phone && right.phone && normalize(String(left.phone)) === normalize(String(right.phone));
    return Boolean(sameEmail || samePhone);
  }
  if (entity === "APPOINTMENTS") {
    const leftEnd = importedEnd(left);
    const rightEnd = importedEnd(right);
    return left.clientId === right.clientId && left.professionalId === right.professionalId && left.startsAt === right.startsAt && leftEnd === rightEnd;
  }
  return left.type === right.type && left.dueDate === right.dueDate && left.amountInCents === right.amountInCents && left.clientId === right.clientId && normalize(String(left.description ?? "")) === normalize(String(right.description ?? ""));
}
function downloadTemplate(entity: ImportEntityType) {
  const header = FIELDS[entity].map((field) => field.key).join(",");
  const blob = new Blob([`${header}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `modelo-${entity.toLowerCase()}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

export default function ImportPage() {
  const { data } = useWorkspace();
  const [entity, setEntity] = useState<ImportEntityType>("CLIENTS");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<ImportMapping[]>([]);
  const [mappingName, setMappingName] = useState("");
  const [decisions, setDecisions] = useState<Record<number, DuplicateDecision>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setNotice("O arquivo deve ter até 10 MB."); return; }
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const matrix = extension === "xlsx" ? (await readXlsxFile(file) as RawCell[][]) : extension === "csv" ? (await file.text()).split(/\r?\n/).filter(Boolean).map((line) => csvLine(line)) : null;
      if (!matrix) throw new Error("Use um arquivo CSV ou XLSX.");
      const parsed = rowsFromMatrix(matrix);
      if (parsed.rows.length > 350) throw new Error("Cada confirmação aceita até 350 linhas.");
      setHeaders(parsed.headers); setRawRows(parsed.rows); setMapping(Object.fromEntries(FIELDS[entity].map((field) => [field.key, parsed.headers.find((header) => normalize(header) === normalize(field.key) || normalize(header) === normalize(field.label)) ?? ""]))); setDecisions({}); setNotice("");
      const response = await phaseFiveService.imports.mappings(); setSaved(response.mappings.filter((item) => item.entityType === entity));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível ler o arquivo."); }
  }

  const preview = useMemo(() => {
    const existingIds = {
      PROFESSIONALS: new Set(data?.professionals.map((item) => item.id) ?? []),
      CLIENTS: new Set(data?.clients.map((item) => item.id) ?? []),
      APPOINTMENTS: new Set(data?.appointments.map((item) => item.id) ?? []),
    };
    const records = rawRows.map((raw) => Object.fromEntries(FIELDS[entity].map((field) => [field.key, converted(field.key, raw[mapping[field.key]] ?? null)])));
    return records.map((record, index) => {
      const missing = FIELDS[entity].filter((field) => field.required && (record[field.key] === "" || record[field.key] === null || Number.isNaN(record[field.key]))).map((field) => field.label);
      const referenceMissing: string[] = [];
      if (entity === "CLIENTS" && record.assignedProfessionalId && !existingIds.PROFESSIONALS.has(String(record.assignedProfessionalId))) referenceMissing.push("profissional vinculado");
      if (entity === "APPOINTMENTS") {
        if (!existingIds.CLIENTS.has(String(record.clientId))) referenceMissing.push("cliente");
        if (!existingIds.PROFESSIONALS.has(String(record.professionalId))) referenceMissing.push("profissional");
      }
      if (entity === "TRANSACTIONS") {
        if (record.clientId && !existingIds.CLIENTS.has(String(record.clientId))) referenceMissing.push("cliente");
        if (record.professionalId && !existingIds.PROFESSIONALS.has(String(record.professionalId))) referenceMissing.push("profissional");
        if (record.appointmentId && !existingIds.APPOINTMENTS.has(String(record.appointmentId))) referenceMissing.push("atendimento");
      }
      let duplicateId: string | null = null;
      if (entity === "PROFESSIONALS") duplicateId = data?.professionals.find((item) => item.id === record.id || normalize(item.email) === normalize(String(record.email ?? "")))?.id ?? null;
      if (entity === "CLIENTS") duplicateId = data?.clients.find((item) => item.id === record.id || (record.email && normalize(item.email ?? "") === normalize(String(record.email))) || (record.phone && normalize(item.phone ?? "") === normalize(String(record.phone))))?.id ?? null;
      if (entity === "APPOINTMENTS") duplicateId = data?.appointments.find((item) => item.id === record.id || (item.clientId === record.clientId && item.professionalId === record.professionalId && item.startsAt === record.startsAt && item.endsAt === importedEnd(record)))?.id ?? null;
      if (entity === "TRANSACTIONS") duplicateId = data?.transactions.find((item) => item.id === record.id || (item.type === record.type && item.dueDate === record.dueDate && item.amountInCents === record.amountInCents && item.clientId === record.clientId && normalize(item.description) === normalize(String(record.description))))?.id ?? null;
      const duplicateInFile = records.slice(0, index).some((candidate) => sameImportedRecord(entity, candidate, record));
      return { index, record, missing: [...missing, ...referenceMissing.map((value) => `Referência: ${value}`)], duplicateId, duplicateInFile };
    });
  }, [data, entity, mapping, rawRows]);
  const blocked = preview.some((item) => item.missing.length || ((item.duplicateId || item.duplicateInFile) && !decisions[item.index]));

  function discard() { setHeaders([]); setRawRows([]); setMapping({}); setDecisions({}); setNotice("Prévia descartada. Nenhum dado foi gravado."); }
  async function saveMapping() { if (!mappingName.trim()) return; const result = await phaseFiveService.imports.saveMapping({ name: mappingName, entityType: entity, columns: mapping }); setSaved([...saved.filter((item) => item.id !== result.mapping.id), result.mapping]); setMappingName(""); setNotice("Modelo de mapeamento salvo."); }
  async function commit() {
    setBusy(true);
    try {
      const rows: ImportCommitRow[] = preview.filter((item) => (!item.duplicateId && !item.duplicateInFile) || decisions[item.index] === "UPDATE").map((item) => {
        const { id: importedId, ...dataRecord } = item.record;
        const targetId = item.duplicateId ?? (typeof importedId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(importedId) ? importedId : crypto.randomUUID());
        return { entityType: entity, action: item.duplicateId ? "UPDATE" : "CREATE", targetId, data: dataRecord };
      });
      if (!rows.length) throw new Error("Todas as linhas foram ignoradas; não há o que confirmar.");
      const result = await phaseFiveService.imports.commit(rows); setNotice(`${result.imported} registros importados. A confirmação não pode ser desfeita.`); discard();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível confirmar a importação."); }
    finally { setBusy(false); setConfirming(false); }
  }

  return <div className="mx-auto max-w-6xl space-y-6">
    <PageHeader title="Importação administrativa" description="Importe CSV ou XLSX com prévia, mapeamento e decisão individual para duplicidades." />
    {notice ? <p role="status" className="border-border bg-surface rounded-lg border px-4 py-3 text-sm">{notice}</p> : null}
    <Card><CardHeader><CardTitle>1. Arquivo e formato</CardTitle></CardHeader><CardBody className="grid gap-4 sm:grid-cols-2"><Field label="Tipo de dado">{(props) => <Select {...props} value={entity} onChange={(event) => { setEntity(event.target.value as ImportEntityType); discard(); }}><option value="PROFESSIONALS">Profissionais</option><option value="CLIENTS">Clientes</option><option value="APPOINTMENTS">Atendimentos</option><option value="TRANSACTIONS">Financeiro</option></Select>}</Field><Field label="Arquivo CSV ou XLSX" hint="Máximo de 10 MB e 350 linhas por confirmação.">{(props) => <Input {...props} type="file" accept=".csv,.xlsx" onChange={(event) => void chooseFile(event.target.files?.[0])} />}</Field><div className="sm:col-span-2"><Button variant="outline" size="sm" onClick={() => downloadTemplate(entity)}>Baixar modelo oficial de {ENTITY_LABEL[entity].toLowerCase()}</Button></div></CardBody></Card>
    {headers.length ? <><Card><CardHeader><CardTitle>2. Mapear colunas</CardTitle></CardHeader><CardBody className="space-y-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{FIELDS[entity].map((field) => <Field key={field.key} label={field.label} required={field.required}>{(props) => <Select {...props} value={mapping[field.key] ?? ""} onChange={(event) => setMapping({ ...mapping, [field.key]: event.target.value })}><option value="">Não importar</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</Select>}</Field>)}</div><div className="border-border flex flex-wrap gap-2 border-t pt-4"><Input aria-label="Nome do modelo" placeholder="Nome do modelo de mapeamento" className="max-w-xs" value={mappingName} onChange={(event) => setMappingName(event.target.value)} /><Button variant="outline" onClick={() => void saveMapping()} disabled={!mappingName.trim()}>Salvar modelo</Button>{saved.map((item) => <Button key={item.id} size="sm" variant="ghost" onClick={() => setMapping(item.columns)}>{item.name}</Button>)}</div></CardBody></Card>
    <Card><CardHeader><CardTitle>3. Prévia e duplicidades</CardTitle></CardHeader><CardBody className="space-y-3"><p className="text-muted-foreground text-sm">Até a confirmação, você pode ajustar o mapeamento ou desfazer toda a prévia. Campos clínicos são recusados.</p><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-border border-b"><th className="p-2">Linha</th><th className="p-2">Identificação</th><th className="p-2">Integridade</th><th className="p-2">Duplicidade</th></tr></thead><tbody>{preview.map((item) => <tr key={item.index} className="border-border border-b align-top"><td className="p-2">{item.index + 2}</td><td className="p-2">{String(item.record.displayName ?? item.record.fullName ?? item.record.description ?? item.record.startsAt ?? "—")}</td><td className="p-2">{item.missing.length ? <Badge tone="danger">Faltam: {item.missing.join(", ")}</Badge> : <Badge tone="success">Formato válido</Badge>}</td><td className="p-2">{item.duplicateId || item.duplicateInFile ? <Select aria-label={`Decisão da linha ${item.index + 2}`} value={decisions[item.index] ?? ""} onChange={(event) => setDecisions({ ...decisions, [item.index]: event.target.value as DuplicateDecision })}><option value="">Decidir…</option><option value="IGNORE">Ignorar</option>{item.duplicateId ? <option value="UPDATE">Atualizar existente</option> : null}</Select> : <span className="text-muted-foreground">Novo registro</span>}</td></tr>)}</tbody></table></div><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={discard}>Desfazer prévia</Button><Button disabled={blocked || busy} onClick={() => setConfirming(true)}>Confirmar importação</Button></div></CardBody></Card></> : null}
    <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} onConfirm={() => void commit()} title="Confirmar importação" message="Os registros válidos serão criados ou atualizados agora. Depois desta confirmação não haverá botão de desfazer." confirmLabel="Confirmar e gravar" destructive={false} />
  </div>;
}
