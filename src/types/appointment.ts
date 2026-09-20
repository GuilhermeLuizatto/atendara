import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { PrivacyRedactionMark } from "./privacy";
import type { ServiceModality } from "./profession";

export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "RESCHEDULED";

/** O que aconteceu com o sinal quando o atendimento nao aconteceu (E2.2). */
export type DepositOutcome = "KEPT" | "REFUNDED";

export type AppointmentOrigin =
  "MANUAL" | "AI_AGENT" | "CLIENT_SELF_SERVICE" | "IMPORTED";

/**
 * Referencia a um evento em calendario externo. O campo existe desde ja para
 * que a sincronizacao (Google/Outlook) na Fase 3 nao exija migracao de dados.
 */
export interface ExternalCalendarRef {
  provider: "GOOGLE" | "OUTLOOK" | "ICAL";
  externalEventId: string;
  syncedAt: ISODateString;
}

export interface Appointment extends TenantScopedEntity {
  clientId: ID;
  /** Desnormalizado para listagem de agenda sem N+1 leituras no Firestore. */
  clientName: string;
  professionalId: ID;
  professionalName: string;
  startsAt: ISODateString;
  endsAt: ISODateString;
  durationMinutes: number;
  /**
   * Servico do catalogo (E2.1), quando a profissao tem catalogo. O NOME vai
   * junto porque o atendimento e registro do que aconteceu: renomear o servico
   * depois nao pode reescrever o passado.
   */
  serviceId: ID | null;
  serviceName: string | null;
  modality: ServiceModality;
  status: AppointmentStatus;
  priceInCents: number;
  /**
   * Sinal combinado na marcacao (E2.2), em centavos inteiros. `null` quando a
   * profissao nao trabalha com sinal ou quando ela nao pediu sinal aqui.
   *
   * O sinal **abate**: a receita do servico nasce por `priceInCents` menos
   * este valor, e o sinal vira um lancamento proprio. Somados, os dois dao o
   * valor do atendimento — o financeiro nao cobra duas vezes.
   */
  depositInCents: number | null;
  /**
   * O que foi feito com o sinal quando o atendimento nao aconteceu. Fica no
   * atendimento, e nao so na trilha, porque a tela precisa dizer "sinal
   * retido" sem varrer a auditoria.
   */
  depositOutcome: DepositOutcome | null;
  /**
   * Endereco do atendimento a domicilio (E2.3). **Dado pessoal**: entra no
   * mapa de `src/config/privacy.ts`, sai na exportacao e some na eliminacao.
   *
   * Nunca sai do painel: nao existe variavel de modelo para ele, nenhuma
   * tarefa de automacao o carrega, e o aviso a cliente nao o menciona
   * (decisao do titular, 20/09). Endereco em mensagem e endereco circulando
   * pela Meta e pela operadora de telefonia sem precisar.
   */
  visitAddress: string | null;
  /** Taxa de deslocamento, em centavos inteiros. Lancamento proprio (E2.3). */
  travelFeeInCents: number | null;
  /** Observacao administrativa. Nao e registro clinico. */
  administrativeNotes: string | null;
  origin: AppointmentOrigin;
  confirmedAt: ISODateString | null;
  cancelledAt: ISODateString | null;
  cancellationReason: string | null;
  /** Preenchido quando este atendimento substitui outro remarcado. */
  rescheduledFromId: ID | null;
  externalCalendar: ExternalCalendarRef | null;
  /** Titular eliminado: horario e valor ficam, quem foi atendido nao. */
  privacyRedaction?: PrivacyRedactionMark | null;
}
