import { err, ok, type Result } from "@/types";

/**
 * Endereco pelo CEP no ViaCEP (decisao do titular em 27/09/2026). So o CEP sai
 * do navegador, e so quando a pessoa o completa; ele nao e gravado. O ViaCEP
 * consta da Politica de Privacidade e da CSP (`connect-src`).
 */

export const VIACEP_ORIGIN = "https://viacep.com.br";

export const cepDigits = (value: string): string => value.replace(/\D/g, "").slice(0, 8);

/** "11010000" vira "11010-000"; tambem enquanto se digita. */
export function formatCepInput(value: string): string {
  const digits = cepDigits(value);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export interface CepAddress {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Resposta do ViaCEP: `{ erro: true }` quando o CEP nao existe. */
export function parseViaCepResponse(body: unknown): Result<CepAddress> {
  if (!body || typeof body !== "object") return err("Resposta inesperada ao buscar o CEP.");
  const data = body as Record<string, unknown>;
  if (data.erro === true || data.erro === "true") return err("CEP não encontrado. Confira os números ou preencha o endereço à mão.");
  const address = { street: text(data.logradouro), neighborhood: text(data.bairro), city: text(data.localidade), state: text(data.uf) };
  if (!address.city || !/^[A-Z]{2}$/.test(address.state)) return err("Resposta inesperada ao buscar o CEP.");
  return ok(address);
}

/**
 * Uma linha pronta para completar: "Rua Um, |, Centro, CEP 11010-000", com o
 * cursor onde entra o numero. CEP unico de cidade pequena nao traz rua; ai o
 * cursor fica no comeco, para a rua e o numero entrarem antes.
 */
export function addressFromCep(address: CepAddress, cep: string): { text: string; caret: number } {
  const tail = [address.neighborhood, `CEP ${formatCepInput(cep)}`].filter(Boolean).join(", ");
  if (!address.street) return { text: tail, caret: 0 };
  const head = `${address.street}, `;
  return { text: `${head}, ${tail}`, caret: head.length };
}

export async function lookupCep(
  cep: string,
  { fetchImpl = fetch, timeoutMs = 6000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Result<CepAddress>> {
  const digits = cepDigits(cep);
  if (digits.length !== 8) return err("O CEP tem 8 números.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${VIACEP_ORIGIN}/ws/${digits}/json/`, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 400) return err("CEP inválido. Confira os números.");
    if (!response.ok) return err("Não foi possível buscar o CEP agora. Preencha o endereço à mão.");
    return parseViaCepResponse(await response.json());
  } catch {
    return err("Não foi possível buscar o CEP agora. Preencha o endereço à mão.");
  } finally {
    clearTimeout(timer);
  }
}
