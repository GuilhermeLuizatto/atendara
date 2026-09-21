import type { RuleConditionField } from "@/types";
import { CLASSIFICATION_META } from "./classifications";
import {
  APPOINTMENT_STATUS_LABELS,
  CHANNEL_LABELS,
  CLIENT_STATUS_LABELS,
  MODALITY_LABELS,
} from "./labels";

/** Tipos e limites compartilhados pelo editor e pelo validador. */
export const CONDITION_FIELDS: Record<
  RuleConditionField,
  {
    label: string;
    kind: "text" | "number" | "boolean";
    min?: number;
    max?: number;
    options?: Record<string, string>;
  }
> = {
  "message.classification": {
    label: "Classificação",
    kind: "text",
    options: Object.fromEntries(
      Object.entries(CLASSIFICATION_META).map(([id, meta]) => [id, meta.label]),
    ),
  },
  "message.intent": {
    label: "Intenção administrativa",
    kind: "text",
    options: {
      PRICING: "Preço",
      SCHEDULING: "Agendamento",
      RESCHEDULING: "Remarcação",
      CONFIRMATION: "Confirmação",
      CANCELLATION: "Cancelamento",
      LOCATION: "Localização",
      PAYMENT: "Pagamento",
      SERVICES: "Serviços",
      NONE: "Não reconhecida",
    },
  },
  "message.channel": { label: "Canal", kind: "text", options: CHANNEL_LABELS },
  "client.modality": {
    label: "Modalidade",
    kind: "text",
    options: MODALITY_LABELS,
  },
  "client.status": {
    label: "Situação do cadastro",
    kind: "text",
    options: CLIENT_STATUS_LABELS,
  },
  "client.hasOutstandingBalance": { label: "Saldo pendente", kind: "boolean" },
  "appointment.status": {
    label: "Situação do atendimento",
    kind: "text",
    options: APPOINTMENT_STATUS_LABELS,
  },
  "context.dayOfWeek": {
    label: "Dia da semana (0 = domingo)",
    kind: "number",
    min: 0,
    max: 6,
  },
  "context.hour": {
    label: "Hora local (0 a 23)",
    kind: "number",
    min: 0,
    max: 23,
  },
  "context.withinBusinessHours": {
    label: "Dentro do expediente",
    kind: "boolean",
  },
  "agent.confidence": {
    label: "Confiança (0 a 1)",
    kind: "number",
    min: 0,
    max: 1,
  },
};
