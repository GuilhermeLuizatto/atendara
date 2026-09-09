import type {
  MessageClassificationId,
  RuleConditionField,
  ServiceModality,
} from "@/types";

/**
 * Contexto de avaliacao: o unico "mundo" que uma condicao de regra enxerga.
 *
 * As chaves sao exatamente os `RuleConditionField`. Manter essa correspondencia
 * significa que uma condicao nunca pode referenciar algo que o motor nao sabe
 * resolver — o compilador recusa antes.
 */
export type EvaluationContext = Record<
  RuleConditionField,
  string | number | boolean | null
>;

export interface ContextSource {
  classification: MessageClassificationId;
  intent: string;
  channel: string;
  confidence: number;
  clientModality: ServiceModality | null;
  clientStatus: string | null;
  clientHasOutstandingBalance: boolean;
  appointmentStatus: string | null;
  /** Momento avaliado, ja convertido para dia da semana e hora locais. */
  dayOfWeek: number;
  hour: number;
  withinBusinessHours: boolean;
}

export function buildEvaluationContext(
  source: ContextSource,
): EvaluationContext {
  return {
    "message.classification": source.classification,
    "message.intent": source.intent,
    "message.channel": source.channel,
    "client.modality": source.clientModality,
    "client.status": source.clientStatus,
    "client.hasOutstandingBalance": source.clientHasOutstandingBalance,
    "appointment.status": source.appointmentStatus,
    "context.dayOfWeek": source.dayOfWeek,
    "context.hour": source.hour,
    "context.withinBusinessHours": source.withinBusinessHours,
    "agent.confidence": source.confidence,
  };
}
