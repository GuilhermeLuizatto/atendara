"use client";

import { Field, Input, Select } from "@/components/ui/form";
import {
  CHANNEL_META,
  CONSENT_MEDIUM_HINTS,
  CONSENT_MEDIUM_LABELS,
  CONSENT_RECORDER_LABELS,
  CONSENT_STAFF_INSTRUCTION,
  LEGAL_GUARDIAN_NAME_MIN_LENGTH,
  LEGAL_GUARDIAN_RELATIONSHIP_LABELS,
  NOTIFICATION_CONSENT_TEXT_VERSION,
} from "@/config/notifications";
import {
  activeConsentChannels,
  applyConsentChanges,
  channelHistory,
  isCompleteConsentAct,
  isRecordFormat,
  latestConsentRecord,
  plannedConsentChanges,
  type ConsentChange,
} from "@/lib/notifications/consent-record";
import { consentStatement } from "@/lib/notifications/consent-text";
import { formatDateTime } from "@/lib/utils/format";
import {
  CONSENT_MEDIA,
  LEGAL_GUARDIAN_RELATIONSHIPS,
  OUTBOUND_CHANNELS,
  type ChannelConsentRecord,
  type Client,
  type ConsentAct,
  type ConsentMedium,
  type ID,
  type LegalGuardianRelationship,
  type OutboundChannel,
  type ProfessionConfig,
  type StoredNotificationConsent,
} from "@/types";

/**
 * Consentimento dos avisos no cadastro.
 *
 * A tela guarda so a intencao — quais canais ficam valendo e como a pessoa se
 * manifestou. O registro sai de `applyConsentChanges` sobre o que ja estava
 * salvo, na hora de gravar: assim cada canal ganha ou perde no maximo um
 * registro por vez, que e o que as Security Rules aceitam, e desmarcar e marcar
 * de novo antes de salvar nao deixa rastro falso.
 */

export interface ConsentDraft {
  /** Aceite geral (`appointmentNotificationsEnabled`). */
  enabled: boolean;
  channels: OutboundChannel[];
  medium: ConsentMedium | "";
  subjectIsMinor: boolean;
  guardianName: string;
  guardianRelationship: LegalGuardianRelationship | "";
}

export type ConsentErrors = Partial<
  Record<"medium" | "guardianName" | "guardianRelationship" | "recorder", string>
>;

export function initialConsentDraft(client: Client | null | undefined): ConsentDraft {
  const saved = client?.notificationConsent ?? null;
  const latest = latestConsentRecord(saved);
  return {
    enabled: client?.appointmentNotificationsEnabled ?? false,
    channels: activeConsentChannels(saved),
    medium: "",
    subjectIsMinor: latest?.subjectIsMinor ?? false,
    guardianName: latest?.legalGuardian?.fullName ?? "",
    guardianRelationship: latest?.legalGuardian?.relationship ?? "",
  };
}

function changesFor(saved: StoredNotificationConsent | null, draft: ConsentDraft): ConsentChange[] {
  return plannedConsentChanges(saved, draft.enabled ? draft.channels : []);
}

/** O valor a gravar, ou os erros que impedem gravar. */
export function consentFromDraft(
  saved: StoredNotificationConsent | null,
  draft: ConsentDraft,
  userId: ID | null,
  now: string,
): { consent: StoredNotificationConsent | null; errors: ConsentErrors } {
  const changes = changesFor(saved, draft);
  if (changes.length === 0) return { consent: saved, errors: {} };

  const errors: ConsentErrors = {};
  if (!draft.medium) errors.medium = "Informe como a pessoa se manifestou.";
  if (!userId) errors.recorder = "Não foi possível identificar quem está registrando. Entre de novo.";

  const granting = changes.some((change) => change.kind === "GRANTED");
  if (granting && draft.subjectIsMinor) {
    if (draft.guardianName.trim().length < LEGAL_GUARDIAN_NAME_MIN_LENGTH) {
      errors.guardianName = "Informe o nome do responsável legal.";
    }
    if (!draft.guardianRelationship) {
      errors.guardianRelationship = "Informe o vínculo do responsável legal.";
    }
  }
  if (Object.keys(errors).length > 0 || !draft.medium || !userId) return { consent: saved, errors };

  const act: ConsentAct = { at: now, recordedBy: { kind: "STAFF", userId }, medium: draft.medium };
  const minor = draft.subjectIsMinor && draft.guardianRelationship !== "";
  return {
    consent: applyConsentChanges(saved, changes, act, {
      textVersion: NOTIFICATION_CONSENT_TEXT_VERSION,
      subjectIsMinor: draft.subjectIsMinor,
      legalGuardian: minor
        ? {
            fullName: draft.guardianName.trim(),
            relationship: draft.guardianRelationship as LegalGuardianRelationship,
          }
        : null,
    }),
    errors: {},
  };
}

function describeAct(act: ConsentAct): string {
  return `${formatDateTime(act.at)} · ${CONSENT_MEDIUM_LABELS[act.medium]} · ${CONSENT_RECORDER_LABELS[act.recordedBy.kind]}`;
}

function describeRecord(record: ChannelConsentRecord): string {
  if (!isCompleteConsentAct(record.granted)) return "registro incompleto, que não autoriza aviso";
  const guardian = record.legalGuardian
    ? ` · pelo responsável legal ${record.legalGuardian.fullName} (${LEGAL_GUARDIAN_RELATIONSHIP_LABELS[record.legalGuardian.relationship] ?? "vínculo não informado"})`
    : "";
  const withdrawn =
    record.withdrawn && isCompleteConsentAct(record.withdrawn)
      ? ` — retirado em ${describeAct(record.withdrawn)}`
      : "";
  return `autorizado em ${describeAct(record.granted)} · texto ${record.textVersion}${guardian}${withdrawn}`;
}

function ConsentHistory({ saved }: { saved: StoredNotificationConsent | null }) {
  const rows = OUTBOUND_CHANNELS.flatMap((channel) =>
    channelHistory(saved, channel).map((record, index) => ({ channel, record, index })),
  );
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-foreground text-xs font-medium">Histórico do consentimento</p>
      <ul className="space-y-1">
        {rows.map(({ channel, record, index }) => (
          <li key={`${channel}-${index}`} className="text-muted-foreground text-xs">
            <span className="text-foreground">{CHANNEL_META[channel].label}</span>: {describeRecord(record)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConsentFields({
  organizationName,
  profession,
  saved,
  draft,
  errors,
  disabled,
  onChange,
}: {
  organizationName: string;
  profession: ProfessionConfig;
  saved: StoredNotificationConsent | null;
  draft: ConsentDraft;
  errors: ConsentErrors;
  disabled: boolean;
  onChange: (changes: Partial<ConsentDraft>) => void;
}) {
  const allowedChannels = profession.notifications.allowedChannels;
  const statement = consentStatement({
    organizationName,
    channels: allowedChannels,
    events: profession.notifications.allowedEvents,
    disclosure: profession.notifications.disclosure,
  });
  // Canal vigente fora da politica da profissao continua na lista: precisa
  // poder ser retirado.
  const savedActive = activeConsentChannels(saved);
  const channelOptions = OUTBOUND_CHANNELS.filter(
    (channel) => allowedChannels.includes(channel) || savedActive.includes(channel),
  );
  const changes = changesFor(saved, draft);
  const granting = changes.some((change) => change.kind === "GRANTED");
  const pending = changes
    .map((change) => `${change.kind === "GRANTED" ? "autoriza" : "retira"} ${CHANNEL_META[change.channel].label}`)
    .join("; ");

  const toggleChannel = (channel: OutboundChannel, checked: boolean) =>
    onChange({
      channels: checked
        ? [...draft.channels.filter((item) => item !== channel), channel]
        : draft.channels.filter((item) => item !== channel),
    });

  return (
    <div className="bg-surface-muted space-y-3 rounded-lg p-3">
      <div className="border-border space-y-1 rounded-md border p-2">
        {statement.paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-foreground text-xs">
            {paragraph}
          </p>
        ))}
        <p className="text-muted-foreground text-xs">Texto versão {statement.version}</p>
      </div>
      <p className="text-muted-foreground text-xs">{CONSENT_STAFF_INSTRUCTION}</p>

      <label className="text-foreground flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={disabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        A pessoa autorizou receber avisos sobre atendimentos
      </label>

      {draft.enabled ? (
        <fieldset className="space-y-1 pl-6" disabled={disabled}>
          <legend className="text-muted-foreground text-xs">
            Por quais canais. O consentimento vale por canal: marcar aqui não autoriza os demais.
          </legend>
          {channelOptions.map((channel) => (
            <label key={channel} className="text-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.channels.includes(channel)}
                onChange={(event) => toggleChannel(channel, event.target.checked)}
              />
              {CHANNEL_META[channel].label}
              <span className="text-muted-foreground text-xs">
                {CHANNEL_META[channel].contactField === "email"
                  ? "exige e-mail no cadastro"
                  : "exige telefone no cadastro"}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {saved && !isRecordFormat(saved) ? (
        <p className="text-muted-foreground text-xs">
          Este cadastro tem uma autorização no formato antigo, sem data por canal, sem quem
          registrou e sem meio. Ela continua guardada, mas não autoriza nenhum aviso: registre de
          novo os canais que a pessoa autorizar.
        </p>
      ) : null}

      {changes.length > 0 ? (
        <div className="border-border space-y-3 rounded-md border p-3">
          <p className="text-foreground text-xs font-medium">Registro desta alteração: {pending}.</p>
          <Field
            label="Como a pessoa se manifestou"
            required
            error={errors.medium}
            hint={draft.medium ? `${CONSENT_MEDIUM_HINTS[draft.medium]}.` : undefined}
          >
            {(props) => (
              <Select
                {...props}
                value={draft.medium}
                disabled={disabled}
                invalid={Boolean(errors.medium)}
                onChange={(event) => onChange({ medium: event.target.value as ConsentMedium | "" })}
              >
                <option value="">Selecione</option>
                {CONSENT_MEDIA.map((medium) => (
                  <option key={medium} value={medium}>
                    {CONSENT_MEDIUM_LABELS[medium]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {granting ? (
            <div className="space-y-3">
              <label className="text-foreground flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.subjectIsMinor}
                  disabled={disabled}
                  onChange={(event) => onChange({ subjectIsMinor: event.target.checked })}
                />
                A pessoa é menor de idade: quem autoriza é o responsável legal
              </label>
              {draft.subjectIsMinor ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nome do responsável legal" required error={errors.guardianName}>
                    {(props) => (
                      <Input
                        {...props}
                        value={draft.guardianName}
                        disabled={disabled}
                        invalid={Boolean(errors.guardianName)}
                        autoComplete="off"
                        onChange={(event) => onChange({ guardianName: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Vínculo com a pessoa" required error={errors.guardianRelationship}>
                    {(props) => (
                      <Select
                        {...props}
                        value={draft.guardianRelationship}
                        disabled={disabled}
                        invalid={Boolean(errors.guardianRelationship)}
                        onChange={(event) =>
                          onChange({
                            guardianRelationship: event.target.value as LegalGuardianRelationship | "",
                          })
                        }
                      >
                        <option value="">Selecione</option>
                        {LEGAL_GUARDIAN_RELATIONSHIPS.map((relationship) => (
                          <option key={relationship} value={relationship}>
                            {LEGAL_GUARDIAN_RELATIONSHIP_LABELS[relationship]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}

          {errors.recorder ? (
            <p role="alert" className="text-danger text-xs">
              {errors.recorder}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Fica registrado com a data e a hora de agora, a versão {NOTIFICATION_CONSENT_TEXT_VERSION}{" "}
            do texto e o seu usuário. Retirar um canal não apaga o que já foi registrado.
          </p>
        </div>
      ) : null}

      <ConsentHistory saved={saved} />

      <p className="text-muted-foreground text-xs">
        Nenhuma mensagem sai enquanto a organização não configurar canal, evento, antecedência e
        modelo em Configurações. Confirmar na agenda, por si só, não envia nada.
      </p>
    </div>
  );
}
