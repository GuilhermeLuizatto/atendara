"use client";

import { useMemo, useState } from "react";

import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import {
  APPOINTMENT_EVENT_META,
  CHANNEL_META,
  SKIP_REASON_LABELS,
} from "@/config/notifications";
import { planAppointmentNotifications } from "@/lib/notifications";
import { formatDateTime } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type {
  AppointmentNotificationEvent,
  NotificationRule,
  OutboundChannel,
} from "@/types";

/**
 * Configuracao dos avisos ao cliente.
 *
 * A tela nao decide nada: ela edita a configuracao e mostra o que o nucleo
 * responderia. A pre-visualizacao roda o mesmo `planAppointmentNotifications`
 * que a agenda usa, contra o proximo atendimento real da organizacao — entao o
 * que aparece aqui e o que aconteceria, e nao uma explicacao paralela do que
 * deveria acontecer.
 *
 * Nada e enviado por esta tela. O unico provedor implementado e o simulado.
 */
export function NotificationSettings() {
  const { data, profession } = useWorkspace();
  const { updateNotificationSettings, dispatchDueNotifications } =
    useWorkspaceActions();

  const settings = data?.organization.settings.notifications;
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => {
    if (!data) return null;

    // O proximo atendimento futuro serve de caso concreto. Sem nenhum, nao ha o
    // que pre-visualizar — e dizer isso e melhor do que inventar um exemplo.
    const now = new Date().toISOString();
    const next = data.appointments.find(
      (appointment) =>
        appointment.startsAt > now &&
        (appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED"),
    );
    if (!next) return null;

    const client = data.clients.find((item) => item.id === next.clientId);
    if (!client) return null;

    return {
      appointment: next,
      results: (
        ["APPOINTMENT_REMINDER", "APPOINTMENT_CONFIRMED"] as const
      ).map((event) => ({
        event,
        plan: planAppointmentNotifications({
          organization: data.organization,
          profession,
          appointment: next,
          client,
          professionalName: next.professionalName,
          event,
          now,
          existingDeliveryIds: [],
        }),
      })),
    };
  }, [data, profession]);

  if (!settings || !data) return null;

  const deliveries = data.notificationDeliveries;

  async function persist(next: Parameters<typeof updateNotificationSettings>[0]) {
    setSaving(true);
    await updateNotificationSettings(next);
    setSaving(false);
  }

  function toggleMaster(enabled: boolean) {
    void persist({ ...settings!, enabled });
  }

  function toggleSender(channel: OutboundChannel, verified: boolean) {
    const current = settings!.verifiedSenderChannels;
    void persist({
      ...settings!,
      verifiedSenderChannels: verified
        ? [...current.filter((item) => item !== channel), channel]
        : current.filter((item) => item !== channel),
    });
  }

  function upsertRule(
    event: AppointmentNotificationEvent,
    channel: OutboundChannel,
    changes: Partial<NotificationRule>,
  ) {
    const id = `${event}:${channel}`;
    const existing = settings!.rules.find((rule) => rule.id === id);
    const merged: NotificationRule = {
      id,
      event,
      channel,
      enabled: false,
      leadMinutes:
        APPOINTMENT_EVENT_META[event].anchor === "START"
          ? profession.notifications.defaultLeadMinutes
          : 0,
      customTemplate: null,
      ...existing,
      ...changes,
    };

    void persist({
      ...settings!,
      rules: [...settings!.rules.filter((rule) => rule.id !== id), merged],
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle
            action={
              <Badge tone={settings.enabled ? "success" : "neutral"}>
                {settings.enabled ? "Ativado" : "Desligado"}
              </Badge>
            }
          >
            Avisos de atendimento
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Nenhuma mensagem sai enquanto esta chave estiver desligada. Ligada,
            ainda e preciso um canal com remetente comprovado, uma regra para o
            evento e, do outro lado, contato valido e consentimento por canal.
          </p>
          <p className="text-warning text-sm">
            Todos os canais usam um provedor simulado. Nada e enviado para
            ninguem, em nenhuma circunstancia, ate que um provedor real seja
            integrado.
          </p>
          <label className="text-foreground flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={saving}
              onChange={(event) => toggleMaster(event.target.checked)}
            />
            Permitir que esta organizacao envie avisos sobre atendimentos
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Canais</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Marcar um canal declara que a organizacao esta habilitada como
            remetente nele. Ter um numero ou um e-mail nao e a mesma coisa que
            estar habilitado a enviar por ele.
          </p>
          {profession.notifications.allowedChannels.map((channel) => (
            <div key={channel} className="border-border rounded-lg border p-3">
              <label className="text-foreground flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.verifiedSenderChannels.includes(channel)}
                  disabled={saving}
                  onChange={(event) => toggleSender(channel, event.target.checked)}
                />
                {CHANNEL_META[channel].label}
              </label>
              <p className="text-muted-foreground mt-1 text-xs">
                Pendente para uso real: {CHANNEL_META[channel].activationRequirement}
              </p>
            </div>
          ))}
          {profession.notifications.allowedChannels.length <
          Object.keys(CHANNEL_META).length ? (
            <p className="text-muted-foreground text-xs">
              Alguns canais nao aparecem porque a profissao {profession.label} nao
              os permite, pelo grau de sensibilidade dos dados que trafega.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eventos</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {profession.notifications.allowedEvents.map((event) => {
            const meta = APPOINTMENT_EVENT_META[event];
            return (
              <div key={event} className="border-border space-y-2 rounded-lg border p-3">
                <p className="text-foreground text-sm font-medium">{meta.label}</p>
                <p className="text-muted-foreground text-xs">{meta.description}</p>

                {profession.notifications.allowedChannels.map((channel) => {
                  const rule = settings.rules.find(
                    (item) => item.id === `${event}:${channel}`,
                  );
                  return (
                    <div key={channel} className="flex flex-wrap items-center gap-3">
                      <label className="text-foreground flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={rule?.enabled ?? false}
                          disabled={saving}
                          onChange={(input) =>
                            upsertRule(event, channel, {
                              enabled: input.target.checked,
                            })
                          }
                        />
                        {CHANNEL_META[channel].label}
                      </label>

                      {meta.anchor === "START" ? (
                        <label className="text-muted-foreground flex items-center gap-2 text-xs">
                          Antecedencia
                          <select
                            className="border-border bg-surface text-foreground rounded border px-2 py-1"
                            value={
                              rule?.leadMinutes ??
                              profession.notifications.defaultLeadMinutes
                            }
                            disabled={saving}
                            onChange={(input) =>
                              upsertRule(event, channel, {
                                leadMinutes: Number(input.target.value),
                              })
                            }
                          >
                            {meta.allowedLeadMinutes.map((minutes) => (
                              <option key={minutes} value={minutes}>
                                {minutes >= 1_440
                                  ? `${minutes / 1_440} dia(s)`
                                  : `${minutes / 60} hora(s)`}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Testar antes de ativar</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {preview ? (
            <>
              <p className="text-muted-foreground text-sm">
                Simulado contra o proximo atendimento marcado —{" "}
                {formatDateTime(preview.appointment.startsAt)}. Este e o mesmo
                calculo que a agenda faz.
              </p>
              {preview.results.map(({ event, plan }) => (
                <div key={event} className="border-border rounded-lg border p-3">
                  <p className="text-foreground text-sm font-medium">
                    {APPOINTMENT_EVENT_META[event].label}
                  </p>
                  {plan.planned.length === 0 ? (
                    <ul className="mt-1 space-y-1">
                      {plan.skipped.map((skip, index) => (
                        <li
                          key={`${skip.ruleId}-${skip.channel}-${index}`}
                          className="text-muted-foreground text-xs"
                        >
                          Nada seria enviado
                          {skip.channel ? ` por ${CHANNEL_META[skip.channel].label}` : ""}
                          : {SKIP_REASON_LABELS[skip.reason]}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    plan.planned.map((planned) => (
                      <div key={planned.id} className="mt-1">
                        <p className="text-foreground text-xs">
                          {CHANNEL_META[planned.channel].label} para{" "}
                          {planned.contactHint} em{" "}
                          {formatDateTime(planned.scheduledFor)}
                        </p>
                        <p className="text-muted-foreground bg-surface-muted mt-1 rounded p-2 text-xs">
                          {planned.body}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Sem atendimento futuro no periodo carregado, nao ha caso concreto
              para simular.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle
            action={
              <Button
                variant="secondary"
                disabled={deliveries.length === 0}
                onClick={() => void dispatchDueNotifications()}
              >
                Executar simulacao
              </Button>
            }
          >
            Fila de saida
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <p className="text-muted-foreground text-sm">
            {deliveries.length === 0
              ? "Nenhum envio planejado."
              : "Executar processa os envios ja vencidos com o provedor simulado. Nada sai do produto."}
          </p>
          {deliveries.slice(0, 10).map((delivery) => (
            <div
              key={delivery.id}
              className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs"
            >
              <Badge tone={DELIVERY_TONES[delivery.status]}>{delivery.status}</Badge>
              <span className="text-foreground">
                {CHANNEL_META[delivery.channel].label} · {delivery.contactHint}
              </span>
              <span className="text-muted-foreground">
                {formatDateTime(delivery.scheduledFor)} · tentativas:{" "}
                {delivery.attempts}
                {delivery.failureCode ? ` · ${delivery.failureCode}` : ""}
              </span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

const DELIVERY_TONES = {
  PLANNED: "info",
  SENDING: "info",
  SENT: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
} as const;
