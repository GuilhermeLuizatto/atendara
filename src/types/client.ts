import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { NotificationConsent } from "./notifications";
import type { ServiceModality } from "./profession";

/**
 * `Client` e a entidade central do CRM — deliberadamente generica. A profissao
 * decide como ela e chamada na interface (paciente, aluno, cliente), mas o
 * nucleo nunca conhece esses rotulos.
 *
 * Importante: este e o CRM ADMINISTRATIVO. Dados clinicos/sensiveis nao vivem
 * aqui; ver `docs/ARCHITECTURE.md`, secao "Dados administrativos vs sensiveis".
 */
export type ClientStatus =
  "LEAD" | "ACTIVE" | "INACTIVE" | "ON_HOLD" | "DISCHARGED";

export type AcquisitionChannel =
  "REFERRAL" | "INSTAGRAM" | "GOOGLE" | "WHATSAPP" | "WEBSITE" | "OTHER";

export interface Client extends TenantScopedEntity {
  /**
   * Aceite geral de receber avisos sobre atendimentos. Sozinho nao autoriza
   * envio nenhum: e preciso tambem um `notificationConsent` que nomeie o canal.
   */
  appointmentNotificationsEnabled?: boolean;
  /**
   * Consentimento por canal. Ausente em cadastro antigo — e ausencia significa
   * "nao enviar", nunca "enviar pelo canal que a organizacao preferir".
   */
  notificationConsent?: NotificationConsent | null;
  fullName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  preferredModality: ServiceModality;
  /** Profissional responsavel dentro da organizacao. */
  assignedProfessionalId: ID | null;
  acquisitionChannel: AcquisitionChannel;
  tags: string[];
  lastAppointmentAt: ISODateString | null;
  nextAppointmentAt: ISODateString | null;
  /**
   * Observacoes ESTRITAMENTE administrativas (preferencia de horario, forma de
   * pagamento, estacionamento). A interface deixa isso explicito e o agente de
   * IA nao escreve neste campo.
   */
  administrativeNotes: string | null;
  totalAppointments: number;
  outstandingBalanceInCents: number;
}
