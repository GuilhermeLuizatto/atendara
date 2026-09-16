import { TRIAL_DAYS } from "@/config/platform";
import { getProfession } from "@/config/professions";
import { APP_MODULES, type AppModule } from "@/types/access";
import type { ISODateString, ProfessionId } from "@/types";

/**
 * Regras do cadastro aberto, como MECANISMO — a politica (prazo do teste,
 * tamanho de senha, tetos) vive em `src/config/platform.ts`.
 *
 * Compartilhado com o backend por `scripts/build-functions.mjs`. A tela e a
 * callable precisam recusar exatamente a mesma coisa: se a tela conferir o
 * registro do conselho de um jeito e o servidor de outro, a diferenca aparece
 * como cadastro que some depois de aceito.
 *
 * Arquivo de dominio: nao importa `firebase/*`.
 */

const DAY_MS = 86_400_000;

/**
 * Tamanho do numero de registro no conselho. Os conselhos usam formatos
 * diferentes (com UF, com barra, com ponto), entao a trava e de FORMA: o
 * suficiente para recusar campo colado errado, nunca para afirmar que o
 * registro existe. Conferir veracidade exigiria consultar cada conselho.
 */
export const COUNCIL_REGISTRATION_LENGTH = { min: 4, max: 20 } as const;

/** Letras, digitos e os separadores que os conselhos usam, sem espaco nas pontas. */
const COUNCIL_REGISTRATION_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 ./-]*[A-Za-z0-9]$/;

/**
 * `null` quando o registro informado cabe na profissao escolhida; senao, a
 * frase que a pessoa le.
 *
 * Quem decide se o campo e obrigatorio e a tabela de profissoes (`council`),
 * nunca uma lista de profissoes aqui dentro.
 */
export function councilRegistrationError(
  professionId: ProfessionId,
  value: string | null | undefined,
): string | null {
  const council = getProfession(professionId).council;
  const registration = (value ?? "").trim();

  if (!council) {
    return registration
      ? "Esta profissão não tem conselho de classe."
      : null;
  }
  if (!registration) return `Informe seu registro no ${council.acronym}.`;
  if (
    registration.length < COUNCIL_REGISTRATION_LENGTH.min ||
    registration.length > COUNCIL_REGISTRATION_LENGTH.max ||
    !COUNCIL_REGISTRATION_SHAPE.test(registration)
  ) {
    return `Confira o formato do registro no ${council.acronym}.`;
  }
  return null;
}

/**
 * O teste abre todas as areas: quem esta avaliando precisa ver o produto
 * inteiro, e recortar modulos no teste transformaria a avaliacao numa versao
 * que nao existe no plano pago.
 */
export function selfServiceModules(): AppModule[] {
  return [...APP_MODULES];
}

/** Fim do teste, a partir do instante da confirmacao do e-mail. */
export function trialUntil(nowMs: number): ISODateString {
  return new Date(nowMs + TRIAL_DAYS * DAY_MS).toISOString();
}
