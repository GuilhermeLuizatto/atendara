import {
  FORBIDDEN_TEMPLATE_TERMS,
  TEMPLATE_VARIABLES,
  type TemplateVariable,
} from "@/config/notifications";
import {
  err,
  ok,
  type AppointmentDisclosureLevel,
  type Result,
} from "@/types";

/**
 * Renderizacao de modelo — e a barreira de conteudo.
 *
 * Tres recusas, nesta ordem, e todas silenciosas do ponto de vista do
 * destinatario (o texto simplesmente nao e enviado):
 *
 * 1. **Variavel desconhecida.** So a lista fechada de `TEMPLATE_VARIABLES`
 *    existe. Sem isso, um modelo poderia interpolar qualquer campo do cadastro.
 * 2. **Variavel acima do grau de exposicao da profissao.** `TIME_ONLY` nao
 *    interpola o termo do atendimento — e o que impede um lembrete de revelar
 *    tratamento na tela bloqueada do celular.
 * 3. **Vocabulario clinico.** Conferido no modelo e no texto final, porque o
 *    modelo e escrito por pessoas e o valor de uma variavel tambem.
 *
 * Nao ha escape de HTML aqui de proposito: o corpo e texto simples, e todo canal
 * suportado hoje entrega texto simples.
 */

export interface TemplateContext {
  clientName: string;
  organizationName: string;
  professionalName: string;
  serviceTerm: string;
  date: string;
  time: string;
}

export type TemplateRejection =
  | "EMPTY"
  | "UNKNOWN_VARIABLE"
  | "DISCLOSURE_EXCEEDED"
  | "FORBIDDEN_TERM"
  | "TOO_LONG";

/** O que cada grau de exposicao autoriza interpolar. */
const ALLOWED_BY_DISCLOSURE: Record<
  AppointmentDisclosureLevel,
  readonly TemplateVariable[]
> = {
  TIME_ONLY: ["clientName", "organizationName", "date", "time"],
  TIME_AND_PROFESSIONAL: [
    "clientName",
    "organizationName",
    "professionalName",
    "date",
    "time",
  ],
  TIME_PROFESSIONAL_AND_SERVICE: TEMPLATE_VARIABLES,
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Sem acento e em minusculas: o modelo e digitado por gente. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasForbiddenTerm(text: string): boolean {
  const folded = fold(text);
  return FORBIDDEN_TEMPLATE_TERMS.some((term) => folded.includes(term));
}

export interface RenderOptions {
  disclosure: AppointmentDisclosureLevel;
  maxBodyLength: number;
}

export function renderTemplate(
  template: string,
  context: TemplateContext,
  options: RenderOptions,
): Result<string, TemplateRejection> {
  if (!template.trim()) return err("EMPTY");
  if (hasForbiddenTerm(template)) return err("FORBIDDEN_TERM");

  const allowed = new Set<string>(ALLOWED_BY_DISCLOSURE[options.disclosure]);
  const known = new Set<string>(TEMPLATE_VARIABLES);
  let rejection: TemplateRejection | null = null;

  const body = template
    .replace(PLACEHOLDER, (match, name: string) => {
      if (!known.has(name)) {
        rejection ??= "UNKNOWN_VARIABLE";
        return match;
      }
      if (!allowed.has(name)) {
        rejection ??= "DISCLOSURE_EXCEEDED";
        return match;
      }
      return context[name as TemplateVariable];
    })
    .replace(/\s+/g, " ")
    .trim();

  if (rejection) return err(rejection);
  if (!body) return err("EMPTY");
  if (hasForbiddenTerm(body)) return err("FORBIDDEN_TERM");
  if (body.length > options.maxBodyLength) return err("TOO_LONG");

  return ok(body);
}

/**
 * Impressao digital do texto enviado.
 *
 * FNV-1a de 32 bits: deterministico, sem SDK e sem `crypto` — o dominio precisa
 * rodar igual no navegador, no Node e no teste. Nao e hash criptografico e nao
 * precisa ser: o objetivo e comparar duas tentativas ("mandaram o mesmo texto?")
 * sem guardar o texto, nao resistir a adversario.
 */
export function hashBody(body: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
