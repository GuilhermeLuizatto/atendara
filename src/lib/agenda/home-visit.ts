import { HOME_VISIT_ERRORS, HOME_VISIT_LIMITS } from "@/config/home-visit";
import type { ServiceModality } from "@/types";

/**
 * Regras do atendimento a domicílio (E2.3), sem I/O.
 *
 * O endereço é dado pessoal: existe só onde a profissão registra domicílio,
 * só em atendimento de modalidade `HOME_VISIT`, e nunca sai do painel.
 */

export interface HomeVisitInput {
  visitAddress: string | null;
  travelFeeInCents: number | null;
}

export type HomeVisitValidation =
  { ok: true; value: HomeVisitInput } | { ok: false; error: string };

export function validateHomeVisit(input: {
  modality: ServiceModality;
  visitAddress: string | null;
  travelFeeInCents: number | null;
  available: boolean;
}): HomeVisitValidation {
  const address = input.visitAddress?.trim() ?? "";
  const fee = input.travelFeeInCents;
  const vazio = address.length === 0;

  if (vazio && (fee === null || fee === 0)) {
    return { ok: true, value: { visitAddress: null, travelFeeInCents: null } };
  }

  if (!input.available)
    return { ok: false, error: HOME_VISIT_ERRORS.NOT_AVAILABLE };
  if (input.modality !== "HOME_VISIT") {
    return {
      ok: false,
      error: vazio
        ? HOME_VISIT_ERRORS.TRAVEL_FEE_WITHOUT_VISIT
        : HOME_VISIT_ERRORS.MODALITY_MISMATCH,
    };
  }

  if (!vazio && address.length < HOME_VISIT_LIMITS.address.min) {
    return { ok: false, error: HOME_VISIT_ERRORS.ADDRESS_TOO_SHORT };
  }
  if (address.length > HOME_VISIT_LIMITS.address.max) {
    return { ok: false, error: HOME_VISIT_ERRORS.ADDRESS_TOO_LONG };
  }

  if (
    fee !== null &&
    (!Number.isInteger(fee) ||
      fee < HOME_VISIT_LIMITS.travelFeeInCents.min ||
      fee > HOME_VISIT_LIMITS.travelFeeInCents.max)
  ) {
    return { ok: false, error: HOME_VISIT_ERRORS.TRAVEL_FEE_RANGE };
  }

  return {
    ok: true,
    value: {
      visitAddress: vazio ? null : address,
      travelFeeInCents: fee === null || fee === 0 ? null : fee,
    },
  };
}
