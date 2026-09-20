"use client";

import { Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormActions, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/skeleton";
import {
  PAYMENT_METHOD_LABELS,
  TRANSACTION_STATUS_LABELS,
} from "@/config/labels";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Transaction, TransactionStatus } from "@/types";
import type { TransactionInput } from "@/services";

const STATUS_TONES: Record<TransactionStatus, "success" | "warning" | "danger" | "neutral"> = {
  PENDING: "warning",
  PAID: "success",
  OVERDUE: "danger",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
};

type Draft = TransactionInput;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function blankDraft(): Draft {
  return {
    type: "INCOME",
    clientId: null,
    professionalId: null,
    appointmentId: null,
    description: "",
    amountInCents: 0,
    status: "PENDING",
    method: "PIX",
    dueDate: today(),
  };
}

function toDraft(transaction: Transaction): Draft {
  return {
    type: transaction.type,
    clientId: transaction.clientId,
    professionalId: transaction.professionalId,
    appointmentId: transaction.appointmentId,
    description: transaction.description,
    amountInCents: transaction.amountInCents,
    status: transaction.status,
    method: transaction.method,
    dueDate: transaction.dueDate.slice(0, 10),
  };
}

export function FinanceView() {
  const { data, terminology, session } = useWorkspace();
  const actions = useWorkspaceActions();
  const [editing, setEditing] = useState<Transaction | "new" | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [filter, setFilter] = useState<"ALL" | TransactionStatus>("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");

  if (!data) {
    return <div className="space-y-5"><SkeletonCard lines={2} /><SkeletonCard lines={6} /></div>;
  }

  const canCreate = session?.permissions.includes("transaction:create") ?? false;
  const canUpdate = session?.permissions.includes("transaction:update") ?? false;
  const canDelete = session?.permissions.includes("transaction:delete") ?? false;
  const transactions = data.transactions
    .filter((item) => filter === "ALL" || item.status === filter)
    .filter((item) => typeFilter === "ALL" || item.type === typeFilter);

  const summary = (() => {
    const income = data.transactions.filter((item) => item.type === "INCOME");
    const expenses = data.transactions
      .filter((item) => item.type === "EXPENSE" && item.status !== "CANCELLED")
      .reduce((sum, item) => sum + item.amountInCents, 0);
    const paid = income.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.amountInCents, 0);
    const pending = income.filter((item) => item.status === "PENDING").reduce((sum, item) => sum + item.amountInCents, 0);
    const overdue = income.filter((item) => item.status === "OVERDUE").reduce((sum, item) => sum + item.amountInCents, 0);
    return { paid, pending, overdue, result: paid - expenses };
  })();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Financeiro"
        description={`Receitas, despesas e pendências de ${terminology.client.pluralLower}.`}
        actions={canCreate ? <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Novo lançamento</Button> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Recebido" value={formatCurrency(summary.paid)} tone="success" />
        <SummaryCard label="A receber" value={formatCurrency(summary.pending)} tone="warning" />
        <SummaryCard label="Em atraso" value={formatCurrency(summary.overdue)} tone={summary.overdue ? "danger" : "neutral"} />
        <SummaryCard label="Resultado" value={formatCurrency(summary.result)} tone="neutral" />
      </div>

      <Card className="overflow-hidden">
        <div className="border-border flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Lançamentos</h2>
            <p className="text-muted-foreground text-xs">Valores administrativos do negócio. Nenhuma integração de pagamento está ativa.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Filtrar tipo" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className="w-auto min-w-32">
              <option value="ALL">Todos os tipos</option><option value="INCOME">Receitas</option><option value="EXPENSE">Despesas</option>
            </Select>
            <Select aria-label="Filtrar status" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-auto min-w-32">
              <option value="ALL">Todos os status</option>
              {Object.entries(TRANSACTION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
        </div>

        {transactions.length === 0 ? (
          <EmptyState icon={<Wallet className="size-5" aria-hidden />} title="Nenhum lançamento encontrado" description="Ajuste os filtros ou crie um lançamento manual." />
        ) : (
          <div className="divide-border divide-y">
            {transactions.map((transaction) => (
              <div key={transaction.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{transaction.description}</p>
                    <Badge tone={STATUS_TONES[transaction.status]}>{TRANSACTION_STATUS_LABELS[transaction.status]}</Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {transaction.clientName ?? "Sem cadastro"} · vencimento {formatShortDate(transaction.dueDate)} · {transaction.method ? PAYMENT_METHOD_LABELS[transaction.method] : "Sem método"}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <p className={transaction.type === "EXPENSE" ? "text-danger text-sm font-semibold" : "text-sm font-semibold"}>
                    {transaction.type === "EXPENSE" ? "−" : "+"}{formatCurrency(transaction.amountInCents)}
                  </p>
                  {(canUpdate || canDelete) && (
                    <div className="flex gap-1">
                      {canUpdate && <Button variant="ghost" size="icon" aria-label={`Editar ${transaction.description}`} onClick={() => setEditing(transaction)}><Pencil className="size-4" aria-hidden /></Button>}
                      {canDelete && <Button variant="ghost" size="icon" aria-label={`Excluir ${transaction.description}`} onClick={() => setDeleting(transaction)}><Trash2 className="size-4" aria-hidden /></Button>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing && <TransactionForm transaction={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) void actions.deleteTransaction(deleting.id); }} title="Excluir lançamento" message={`Excluir “${deleting?.description}”? Esta ação não altera o histórico da agenda.`} confirmLabel="Excluir lançamento" />
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  return <Card className="p-4"><p className="text-muted-foreground text-xs">{label}</p><p className={`mt-2 text-lg font-semibold ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-foreground"}`}>{value}</p></Card>;
}

function TransactionForm({ transaction, onClose }: { transaction: Transaction | null; onClose: () => void }) {
  const { data } = useWorkspace();
  const { createTransaction, updateTransaction } = useWorkspaceActions();
  const [draft, setDraft] = useState<Draft>(() => transaction ? toDraft(transaction) : blankDraft());
  const [amount, setAmount] = useState(() => transaction ? String(transaction.amountInCents / 100).replace(".", ",") : "");
  const [saving, setSaving] = useState(false);
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount.replace(".", "").replace(",", ".")) * 100);
    if (!draft.description.trim() || !Number.isFinite(cents) || cents <= 0) return;
    setSaving(true);
    const result = transaction ? await updateTransaction(transaction.id, { ...draft, amountInCents: cents }) : await createTransaction({ ...draft, amountInCents: cents });
    setSaving(false);
    if (result !== null) onClose();
  }

  return <Modal open onClose={onClose} title={transaction ? "Editar lançamento" : "Novo lançamento"} description="Registre receitas e despesas administrativas." size="md">
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo">{(props) => <Select {...props} value={draft.type} onChange={(e) => patch({ type: e.target.value as Draft["type"] })}><option value="INCOME">Receita</option><option value="EXPENSE">Despesa</option></Select>}</Field>
        <Field label="Status">{(props) => <Select {...props} value={draft.status} onChange={(e) => patch({ status: e.target.value as Draft["status"] })}>{Object.entries(TRANSACTION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}</Field>
        <div className="sm:col-span-2"><Field label="Descrição" required>{(props) => <Input {...props} required value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Ex.: Sessão de acompanhamento" />}</Field></div>
        <Field label="Valor (R$)" required>{(props) => <Input {...props} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="180,00" />}</Field>
        <Field label="Vencimento" required>{(props) => <Input {...props} required type="date" value={draft.dueDate.slice(0, 10)} onChange={(e) => patch({ dueDate: `${e.target.value}T12:00:00.000Z` })} />}</Field>
        <Field label="Método de pagamento">{(props) => <Select {...props} value={draft.method ?? ""} onChange={(e) => patch({ method: (e.target.value || null) as Draft["method"] })}><option value="">Não informado</option>{Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}</Field>
        <Field label="Cadastro relacionado">{(props) => <Select {...props} value={draft.clientId ?? ""} onChange={(e) => patch({ clientId: e.target.value || null })}><option value="">Nenhum</option>{data?.clients.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}</Select>}</Field>
      </div>
      <FormActions><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar lançamento"}</Button></FormActions>
    </form>
  </Modal>;
}
