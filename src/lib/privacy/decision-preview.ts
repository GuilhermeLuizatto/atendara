import { DECISION_INPUT_PREVIEW_CHARS } from "@/config/privacy";
import type { SensitiveDataProfile } from "@/types/profession";

/**
 * Trecho da mensagem que a decisao do agente guarda. Vazio quando a profissao
 * nao guarda nenhum: a trilha nao pode virar uma segunda copia do que o
 * paciente escreveu.
 */
export function decisionInputPreview(body: string, profile: SensitiveDataProfile): string {
  return body.slice(0, DECISION_INPUT_PREVIEW_CHARS[profile]);
}
