"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { useState } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/skeleton";
import {
  LEAD_CONSENT_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_WHATSAPP_CONSENT,
  ROUTING_QUEUE_LABELS,
  ROUTING_REASON_LABELS,
} from "@/config/leads";
import { canTeamMoveLead, leadConsentState } from "@/lib/leads/lifecycle";
import { formatDateTime } from "@/lib/utils/format";
import { useWorkspace } from "@/providers/workspace-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import {
  LEAD_STATUSES,
  type Lead,
  type LeadConsentState,
  type LeadStatus,
} from "@/types";

const STATUS_TONE: Record<LeadStatus, BadgeTone> = {
  NEW: "info",
  WAITING_TEAM: "warning",
  TAKEN_OVER: "primary",
  CLOSED: "neutral",
};

const CONSENT_TONE: Record<LeadConsentState, BadgeTone> = {
  GRANTED: "success",
  ABSENT: "warning",
  WITHDRAWN: "danger",
  OUTDATED: "warning",
};

/** O que cada situação de consentimento significa para a Dara, dito à equipe. */
const CONSENT_HINT: Record<LeadConsentState, string> = {
  GRANTED: "A Dara pode responder só perguntas administrativas.",
  ABSENT: "A Dara não responde: só a equipe fala com este contato.",
  WITHDRAWN: "A pessoa pediu para parar. Nenhuma mensagem automática sai.",
  OUTDATED:
    "A autorização é de um texto anterior. A Dara não responde até a pessoa autorizar de novo.",
};

export function LeadsView() {
  const { data, session } = useWorkspace();
  if (!data) {
    return (
      <div className="space-y-5" aria-busy="true">
        <p role="status" className="sr-only">
          Carregando contatos...
        </p>
        <SkeletonCard lines={1} />
        <SkeletonCard lines={5} />
      </div>
    );
  }
  if (!session?.permissions.includes("lead:read")) {
    return (
      <Card>
        <EmptyState
          icon={<UserPlus className="size-5" aria-hidden />}
          title="Sem acesso ao primeiro contato"
          description="A fila de contatos novos é vista por quem responde as conversas da organização."
        />
      </Card>
    );
  }
  return <LeadsList leads={data.leads ?? []} />;
}

function LeadsList({ leads }: { leads: Lead[] }) {
  const { data, session } = useWorkspace();
  const { run, loadMore } = useWorkspaceActions();
  const [filter, setFilter] = useState<LeadStatus | "OPEN" | "ALL">("OPEN");
  const [closing, setClosing] = useState<Lead | null>(null);
  if (!data) return null;
  const canManage = session?.permissions.includes("lead:manage") ?? false;
  const visible = leads
    .filter((lead) =>
      filter === "ALL"
        ? true
        : filter === "OPEN"
          ? lead.status !== "CLOSED"
          : lead.status === filter,
    )
    .sort((a, b) => b.lastContactAt.localeCompare(a.lastContactAt));
  const professionalName = (id: string | null) =>
    data.professionals.find((item) => item.id === id)?.displayName ??
    "Sem profissional definido";
  const move = (lead: Lead, status: "TAKEN_OVER" | "CLOSED") =>
    run(
      (repo) => repo.updateLeadStatus(lead.id, status),
      status === "TAKEN_OVER"
        ? "Contato assumido. A Dara não responde mais nesta conversa."
        : "Contato encerrado.",
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Primeiro contato"
        description="Quem escreveu pelo WhatsApp sem ter cadastro. Nenhum contato vira cliente sozinho."
      />
      <Card className="text-muted-foreground space-y-2 p-4 text-sm">
        <p>
          A Dara só responde a quem autorizou pelo próprio WhatsApp, e só
          perguntas administrativas. Para pedir a autorização, a equipe envia
          à pessoa o texto abaixo; risco, dúvida ou assunto clínico vão sempre
          para a equipe.
        </p>
        <p className="bg-surface-muted text-foreground rounded-lg p-3">
          {LEAD_WHATSAPP_CONSENT.invitation}
        </p>
      </Card>
      <Card>
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <Select
            aria-label="Filtrar contatos por situação"
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as typeof filter)
            }
          >
            <option value="OPEN">Em aberto</option>
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {LEAD_STATUS_LABELS[status]}
              </option>
            ))}
            <option value="ALL">Todos ({leads.length})</option>
          </Select>
        </div>
        {visible.length === 0 ? (
          <EmptyState
            icon={<UserPlus className="size-5" aria-hidden />}
            title="Nenhum contato nesta situação"
            description="Contatos novos aparecem aqui quando alguém sem cadastro escreve pelo WhatsApp da organização."
          />
        ) : (
          <ul className="divide-border divide-y">
            {visible.map((lead) => {
              const consent = leadConsentState(lead.notificationConsent);
              return (
                <li
                  key={lead.id}
                  className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        Contato {lead.contactHint}
                      </span>
                      <Badge tone={STATUS_TONE[lead.status]} dot>
                        {LEAD_STATUS_LABELS[lead.status]}
                      </Badge>
                      {lead.attention === "CRITICAL" && (
                        <Badge tone="danger">Prioridade crítica</Badge>
                      )}
                    </div>
                    <dl className="text-muted-foreground grid gap-1 text-sm sm:grid-cols-2">
                      <div className="flex flex-wrap gap-1">
                        <dt>Origem:</dt>
                        <dd>
                          {LEAD_SOURCE_LABELS[lead.source]} ·{" "}
                          {formatDateTime(lead.lastContactAt)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <dt>Responsável:</dt>
                        <dd>{professionalName(lead.professionalId)}</dd>
                      </div>
                      <div className="flex flex-wrap gap-1 sm:col-span-2">
                        <dt>Encaminhado para:</dt>
                        <dd>
                          {ROUTING_QUEUE_LABELS[lead.queue]} ·{" "}
                          {ROUTING_REASON_LABELS[lead.routingReason]}
                        </dd>
                      </div>
                    </dl>
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={CONSENT_TONE[consent]}>
                        {LEAD_CONSENT_LABELS[consent]}
                      </Badge>
                      <span className="text-muted-foreground">
                        {CONSENT_HINT[consent]}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Link
                      href={`/mensagens?conversa=${encodeURIComponent(lead.conversationId)}`}
                      className={buttonStyles({ variant: "outline", size: "sm" })}
                    >
                      Ver conversa
                    </Link>
                    {canManage && canTeamMoveLead(lead.status, "TAKEN_OVER") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void move(lead, "TAKEN_OVER")}
                      >
                        Assumir
                      </Button>
                    )}
                    {canManage && canTeamMoveLead(lead.status, "CLOSED") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setClosing(lead)}
                      >
                        Encerrar
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <LoadMore
          className="border-border border-t"
          page={data.pagination?.leads}
          summary={`Mostrando os ${leads.length} contatos mais recentes.`}
          label="Carregar contatos anteriores"
          onLoadMore={() => void loadMore("leads")}
        />
      </Card>
      <ConfirmDialog
        open={closing !== null}
        onClose={() => setClosing(null)}
        onConfirm={() => {
          if (closing) void move(closing, "CLOSED");
        }}
        title="Encerrar este contato?"
        message="O contato sai da lista em aberto. Se a pessoa escrever de novo, ele volta para a equipe."
        confirmLabel="Encerrar contato"
        destructive={false}
      />
    </div>
  );
}
