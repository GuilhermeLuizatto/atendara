"use client";

import { Plus, Search, UsersRound } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { CLIENT_STATUS_TONE } from "@/components/ui/tones";
import { CLIENT_STATUS_LABELS, MODALITY_LABELS } from "@/config/labels";
import { AppointmentForm } from "@/features/agenda/appointment-form";
import { formatCurrency, formatDate, formatPhone } from "@/lib/utils/format";
import { byGender, firstTerm, newTerm, noTerm } from "@/lib/utils/terms";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Client, ClientStatus } from "@/types";

import { ClientDrawer } from "./client-drawer";
import { ClientForm } from "./client-form";
import { useClients, type ClientSort } from "./use-clients";

const SORT_LABELS: Record<ClientSort, string> = {
  name: "Nome",
  recent: "Ultimo atendimento",
  next: "Proximo atendimento",
  balance: "Valor em aberto",
};

export function ClientsView() {
  const { terminology, loading, data } = useWorkspace();
  const { loadMore } = useWorkspaceActions();
  const { filters, setFilters, clients, total, countsByStatus, professionals } =
    useClients();
  const page = data?.pagination?.clients;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [selected, setSelected] = useState<Client | null>(null);
  const [appointmentFor, setAppointmentFor] = useState<Client | null>(null);

  // A lista e a fonte da verdade: o registro aberto na gaveta e relido dela a
  // cada render, entao editar ou agendar reflete na hora sem fechar o painel.
  const selectedClient = selected
    ? (clients.find((client) => client.id === selected.id) ??
      (clients.length ? null : selected))
    : null;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditing(client);
    setFormOpen(true);
  };

  if (loading) return <ClientsSkeleton />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={terminology.client.plural}
        description={`CRM administrativo. ${total} ${total === 1 ? terminology.client.singularLower : terminology.client.pluralLower} ${page?.hasMore ? "carregados" : "cadastrados"}.`}
        actions={
          <Button size="md" onClick={openCreate}>
            <Plus className="size-4" aria-hidden strokeWidth={2} />
            {newTerm(terminology.client)}
          </Button>
        }
      />

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search
              className="text-subtle-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
              strokeWidth={1.75}
            />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters({ ...filters, search: event.target.value })
              }
              placeholder="Buscar por nome, e-mail ou telefone"
              aria-label="Buscar"
              className="pl-9"
            />
          </div>

          <Select
            value={filters.status}
            onChange={(event) =>
              setFilters({
                ...filters,
                status: event.target.value as ClientStatus | "ALL",
              })
            }
            aria-label="Filtrar por situacao"
          >
            <option value="ALL">
              Todas as situacoes ({countsByStatus.get("ALL") ?? 0})
            </option>
            {Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label} ({countsByStatus.get(value as ClientStatus) ?? 0})
              </option>
            ))}
          </Select>

          <Select
            value={filters.professionalId}
            onChange={(event) =>
              setFilters({ ...filters, professionalId: event.target.value })
            }
            aria-label={`Filtrar por ${terminology.professional.singularLower}`}
          >
            <option value="ALL">Todos os profissionais</option>
            {professionals.map((professional) => (
              <option key={professional.id} value={professional.id}>
                {professional.displayName}
              </option>
            ))}
          </Select>

          <Select
            value={filters.sort}
            onChange={(event) =>
              setFilters({ ...filters, sort: event.target.value as ClientSort })
            }
            aria-label="Ordenar"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                Ordenar por: {label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {clients.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersRound className="size-5" aria-hidden />}
            title={
              total === 0
                ? `${noTerm(terminology.client)} cadastrad${byGender(terminology.client, "o", "a")} ainda`
                : "Nada encontrado com essa busca ou filtro"
            }
            description={
              total === 0
                ? `Comece por ${firstTerm(terminology.client)}: nome e contato bastam.`
                : "Ajuste a busca ou os filtros."
            }
            action={
              total === 0 ? (
                <Button size="sm" onClick={openCreate}>
                  Criar cadastro
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Tabela em telas medias para cima; em telas estreitas a mesma
              informacao vira lista de cartoes, sem rolagem horizontal. */}
          <table className="hidden w-full md:table">
            <thead>
              <tr className="border-border text-subtle-foreground border-b text-left text-[11px] tracking-wide uppercase">
                <th className="px-4 py-2.5 font-medium">Nome</th>
                <th className="px-4 py-2.5 font-medium">Situacao</th>
                <th className="px-4 py-2.5 font-medium">Contato</th>
                <th className="px-4 py-2.5 font-medium">Proximo</th>
                <th className="px-4 py-2.5 text-right font-medium">Em aberto</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {clients.map((client) => (
                <tr
                  key={client.id}
                  onClick={() => setSelected(client)}
                  className="hover:bg-surface-muted/60 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={client.fullName} size="sm" />
                      <div className="min-w-0">
                        {/* O clique na linha e atalho de mouse; teclado e leitor
                            de tela chegam pelo botao, que diz o que abre. */}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(client);
                          }}
                          className="text-foreground block max-w-full truncate rounded text-left text-sm font-medium hover:underline"
                        >
                          {client.fullName}
                        </button>
                        <p className="text-subtle-foreground truncate text-xs">
                          {MODALITY_LABELS[client.preferredModality]}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={CLIENT_STATUS_TONE[client.status]}>
                      {CLIENT_STATUS_LABELS[client.status]}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 text-xs">
                    <p>{formatPhone(client.phone) || "—"}</p>
                    <p className="truncate">{client.email ?? "—"}</p>
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 text-xs tabular-nums">
                    {client.nextAppointmentAt
                      ? formatDate(client.nextAppointmentAt)
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                    <span
                      className={
                        client.outstandingBalanceInCents > 0
                          ? "text-warning-soft-foreground font-medium"
                          : "text-subtle-foreground"
                      }
                    >
                      {formatCurrency(client.outstandingBalanceInCents)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-border divide-y md:hidden">
            {clients.map((client) => (
              <li key={client.id}>
                <button
                  type="button"
                  onClick={() => setSelected(client)}
                  className="hover:bg-surface-muted/60 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                >
                  <Avatar name={client.fullName} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {client.fullName}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {formatPhone(client.phone) || client.email || "Sem contato"}
                    </p>
                  </div>
                  <Badge tone={CLIENT_STATUS_TONE[client.status]}>
                    {CLIENT_STATUS_LABELS[client.status]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
          <LoadMore
            className="border-border border-t"
            page={page}
            summary={`Mostrando ${total} ${terminology.client.pluralLower} em ordem alfabetica. Busca e filtros consideram so os carregados.`}
            label={`Carregar mais ${terminology.client.pluralLower}`}
            onLoadMore={() => void loadMore("clients")}
          />
        </Card>
      )}

      {formOpen ? (
        <ClientForm
          open
          client={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      <ClientDrawer
        client={selectedClient}
        onClose={() => setSelected(null)}
        onEdit={(client) => {
          setSelected(null);
          openEdit(client);
        }}
        onNewAppointment={(client) => {
          setSelected(null);
          setAppointmentFor(client);
        }}
      />

      {appointmentFor ? (
        <AppointmentForm
          open
          defaultClientId={appointmentFor.id}
          onClose={() => setAppointmentFor(null)}
        />
      ) : null}
    </div>
  );
}

function ClientsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <Skeleton className="h-16 w-full rounded-card" />
      <Card>
        <ul className="divide-border divide-y">
          {Array.from({ length: 8 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
