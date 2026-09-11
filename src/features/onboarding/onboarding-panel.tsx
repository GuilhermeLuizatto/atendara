"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { OPERATOR_NAME } from "@/config/app";
import { MODALITY_LABELS } from "@/config/labels";
import { AppointmentForm } from "@/features/agenda/appointment-form";
import { ClientForm } from "@/features/clients/client-form";
import { AgendaSettingsForm } from "@/features/settings/agenda-settings-form";
import { cn } from "@/lib/utils/cn";
import { firstTerm, indefiniteTerm } from "@/lib/utils/terms";
import { useWorkspace } from "@/providers/workspace-provider";

import { onboardingProgressStore } from "./progress-store";
import {
  EMPTY_PROGRESS,
  onboardingSteps,
  onboardingSummary,
  shouldShowOnboarding,
  type OnboardingProgress,
  type OnboardingStepId,
} from "./steps";

const NOOP_SUBSCRIBE = () => () => {};
const EMPTY = () => EMPTY_PROGRESS;

/**
 * Guia da primeira configuracao, no topo do painel de uma organizacao vazia.
 *
 * Cada passo usa as mesmas telas e as mesmas permissoes de sempre — o guia so
 * poe ordem. Some sozinho quando o primeiro atendimento e marcado, ou quando a
 * pessoa dispensa.
 */
export function OnboardingPanel() {
  const { data, session, profession, terminology } = useWorkspace();
  const titleId = useId();
  const store =
    data && session ? onboardingProgressStore(data.organization.id, session.user.userId) : null;
  const progress = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store?.getSnapshot ?? EMPTY,
    EMPTY,
  );
  // `null` segue o proximo passo pendente; "none" e a pessoa ter recolhido tudo.
  const [expanded, setExpanded] = useState<OnboardingStepId | "none" | null>(null);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [appointmentFormOpen, setAppointmentFormOpen] = useState(false);

  if (!data || !session || !store) return null;

  const permissions = new Set(session.permissions);
  const input = {
    clients: data.clients.length,
    appointments: data.appointments.length,
    canCreateClient: permissions.has("client:create"),
    canCreateAppointment: permissions.has("appointment:create"),
    progress,
  };
  if (!shouldShowOnboarding(input)) return null;

  const steps = onboardingSteps(input);
  const summary = onboardingSummary(steps);
  const next = steps.find((step) => step.available && !step.done)?.id ?? null;
  const open = expanded === null ? next : expanded === "none" ? null : expanded;

  const save = (value: OnboardingProgress) => store.set(value);
  const confirm = (id: OnboardingStepId) => {
    save({ ...progress, confirmed: [...new Set([...progress.confirmed, id])] });
    setExpanded(null);
  };

  const clientTerm = terminology.client;
  const appointmentTerm = terminology.appointment;
  const firstClient = data.clients[0] ?? null;

  const content: Record<OnboardingStepId, { title: string; body: ReactNode }> = {
    profession: {
      title: "Confira a sua profissao",
      body: (
        <div className="space-y-3">
          <p className="text-foreground text-sm">
            Seu acesso foi liberado para <strong>{profession.label}</strong>. E isso que
            define os nomes do painel — {clientTerm.pluralLower} e{" "}
            {appointmentTerm.pluralLower} — e as modalidades oferecidas:{" "}
            {profession.modalities.map((modality) => MODALITY_LABELS[modality].toLocaleLowerCase("pt-BR")).join(", ")}.
          </p>
          <p className="text-muted-foreground text-sm">
            Se a profissao estiver errada, pare aqui e fale com a {OPERATOR_NAME}: so a
            operadora altera a profissao de um cadastro.
          </p>
          <Button size="sm" onClick={() => confirm("profession")}>
            A profissao esta certa
          </Button>
        </div>
      ),
    },
    agenda: {
      title: "Veja o horario de atendimento",
      body: <AgendaSettingsForm onDone={() => confirm("agenda")} doneLabel="Confirmar horario" />,
    },
    client: {
      title: `Cadastre ${firstTerm(clientTerm)}`,
      body: (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            So dados administrativos: nome, contato e preferencias. Informacao clinica
            nao pertence a este cadastro.
          </p>
          <Button size="sm" onClick={() => setClientFormOpen(true)}>
            Cadastrar {clientTerm.singularLower}
          </Button>
        </div>
      ),
    },
    appointment: {
      title: `Marque ${firstTerm(appointmentTerm)}`,
      body: firstClient ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Escolha data e horario para {firstClient.fullName}. Marcar ou confirmar{" "}
            {indefiniteTerm(appointmentTerm)} nao envia mensagem para ninguem.
          </p>
          <Button size="sm" onClick={() => setAppointmentFormOpen(true)}>
            Agendar {appointmentTerm.singularLower}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Primeiro cadastre {indefiniteTerm(clientTerm)}: o agendamento e feito para essa pessoa.
        </p>
      ),
    },
  };

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-card border-border bg-surface shadow-card border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id={titleId} className="text-foreground text-base font-semibold">
            Primeiros passos
          </h2>
          <p className="text-muted-foreground text-sm">
            {summary.done} de {summary.total} concluidos. Leva poucos minutos.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => save({ ...progress, dismissed: true })}
        >
          Dispensar guia
        </Button>
      </div>

      <div
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={summary.total}
        aria-valuenow={summary.done}
        aria-valuetext={`${summary.done} de ${summary.total} passos concluidos`}
        className="bg-surface-muted mt-4 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-accent h-full rounded-full transition-[width] duration-500"
          style={{ width: `${summary.total ? (summary.done / summary.total) * 100 : 0}%` }}
        />
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const isOpen = open === step.id;
          const panelId = `${titleId}-${step.id}`;
          const status = !step.available
            ? "nao liberado no seu cadastro"
            : step.done
              ? "concluido"
              : "pendente";
          return (
            <li key={step.id} className="border-border rounded-lg border">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setExpanded(isOpen ? "none" : step.id)}
                className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    step.done
                      ? "bg-success-soft text-success-soft-foreground"
                      : "bg-surface-muted text-muted-foreground",
                  )}
                >
                  {step.done ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      step.done ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {content[step.id].title}
                  </span>
                  <span className="text-muted-foreground block text-xs first-letter:uppercase">
                    {status}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn("text-subtle-foreground size-4 transition-transform", isOpen && "rotate-180")}
                />
              </button>
              {isOpen ? (
                <div id={panelId} className="border-border border-t px-3 py-3">
                  {step.available ? (
                    content[step.id].body
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Seu cadastro nao inclui esta area. Fale com a {OPERATOR_NAME} se
                      precisar dela.
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {clientFormOpen ? <ClientForm open onClose={() => setClientFormOpen(false)} /> : null}
      {appointmentFormOpen && firstClient ? (
        <AppointmentForm
          open
          defaultClientId={firstClient.id}
          onClose={() => setAppointmentFormOpen(false)}
        />
      ) : null}
    </section>
  );
}
