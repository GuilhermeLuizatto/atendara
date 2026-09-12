import { formatCurrency } from "@/lib/utils/format";
import type {
  AIRule,
  Organization,
  ProfessionConfig,
  RuleCategory,
} from "@/types";

import type { AdminIntent } from "./classify";

/**
 * Composicao da resposta automatica.
 *
 * O texto e montado a partir de dados reais da organizacao (preco, duracao,
 * endereco) — nunca inventado. Quando nao ha dado para responder, a funcao
 * devolve `null` e o motor escala: e a materializacao da regra fundamental
 * "nunca inventar informacoes".
 *
 * Toda resposta se identifica como assistente, atendendo a regra "nunca se
 * passar pelo profissional".
 */

/** Categoria de regra que autoriza cada intencao administrativa. */
export const INTENT_TO_CATEGORY: Record<AdminIntent, RuleCategory> = {
  PRICING: "PRICING",
  SCHEDULING: "SCHEDULING",
  RESCHEDULING: "RESCHEDULING",
  CONFIRMATION: "CONFIRMATION",
  CANCELLATION: "CANCELLATION",
  LOCATION: "LOCATION",
  PAYMENT: "PAYMENT",
  SERVICES: "SERVICES",
};

export interface ResponseContext {
  profession: ProfessionConfig;
  organization: Organization;
  rule: AIRule;
}

export function composeResponse(
  intent: AdminIntent,
  { profession, organization, rule }: ResponseContext,
): string | null {
  const agent = organization.settings.ai.displayName;
  const appointment = profession.terminology.appointment.singularLower;
  const professional = profession.terminology.professional.singularLower;
  const signature = `Sou o assistente virtual do consultório — ${agent}.`;
  const payload = rule.actions.find((action) =>
    ["ALLOW_TOPIC", "PROVIDE_INFO", "AUTO_RESPONSE"].includes(action.type),
  )?.payload;
  const price =
    typeof payload?.priceInCents === "number"
      ? payload.priceInCents
      : profession.defaultPriceInCents;
  const duration =
    typeof payload?.durationMinutes === "number"
      ? payload.durationMinutes
      : profession.defaultAppointmentDurationMinutes;

  switch (intent) {
    case "PRICING":
      return [
        `O valor do ${appointment} é ${formatCurrency(price)}`,
        `e a duração é de ${duration} minutos.`,
        signature,
      ].join(" ");

    case "SCHEDULING":
      return [
        `Informe o dia e turno desejados para o ${appointment}.`,
        `A disponibilidade e a reserva precisam ser confirmadas pelo ${professional}.`,
        signature,
      ].join(" ");

    case "RESCHEDULING":
      return [
        `Para solicitar a remarcação do ${appointment}, informe o dia e horário desejados.`,
        `A alteração depende da confirmação do ${professional}.`,
        signature,
      ].join(" ");

    case "CONFIRMATION":
      return [
        `Informe a data e o horário do ${appointment} que deseja confirmar.`,
        `O ${professional} verificará a confirmação na agenda.`,
        signature,
      ].join(" ");

    case "CANCELLATION":
      return [
        `Informe qual ${appointment} deseja cancelar.`,
        `O cancelamento precisa ser registrado pelo ${professional}.`,
        signature,
      ].join(" ");

    case "LOCATION":
      // Sem endereco cadastrado nao ha o que informar: devolve null e escala.
      if (!organization.address) return null;
      return [
        `O atendimento acontece em ${organization.address}.`,
        signature,
      ].join(" ");

    case "PAYMENT":
      return null;

    case "SERVICES":
      return [
        `Posso explicar como funciona o atendimento e o que levar na primeira vez.`,
        `Detalhes específicos ficam com o ${professional}.`,
        signature,
      ].join(" ");
  }
}
