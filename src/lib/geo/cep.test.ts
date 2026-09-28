import { describe, expect, it, vi } from "vitest";

import { addressFromCep, cepDigits, formatCepInput, lookupCep, parseViaCepResponse } from "./cep";

// CEP ficticio: nenhuma chamada real sai destes testes.
const CEP = "11010-000";
const VIACEP_BODY = { cep: CEP, logradouro: "Rua Um", bairro: "Centro", localidade: "Santos", uf: "SP" };

const response = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("máscara do CEP", () => {
  it.each([
    ["", ""],
    ["110", "110"],
    ["11010", "11010"],
    ["110100", "11010-0"],
    ["11010000", "11010-000"],
    ["11.010-000999", "11010-000"],
    ["abc", ""],
  ])("%j vira %j", (typed, shown) => {
    expect(formatCepInput(typed)).toBe(shown);
  });

  it("guarda no máximo 8 números", () => {
    expect(cepDigits("11010-000-12")).toBe("11010000");
  });
});

describe("resposta do ViaCEP", () => {
  it("lê rua, bairro, cidade e UF", () => {
    expect(parseViaCepResponse(VIACEP_BODY)).toEqual({
      ok: true,
      value: { street: "Rua Um", neighborhood: "Centro", city: "Santos", state: "SP" },
    });
  });

  it("diz quando o CEP não existe", () => {
    expect(parseViaCepResponse({ erro: true })).toMatchObject({ ok: false, error: expect.stringContaining("CEP não encontrado") });
    expect(parseViaCepResponse({ erro: "true" }).ok).toBe(false);
  });

  it("recusa resposta fora do formato", () => {
    expect(parseViaCepResponse(null).ok).toBe(false);
    expect(parseViaCepResponse({ localidade: "Santos", uf: "São Paulo" }).ok).toBe(false);
  });
});

describe("endereço montado a partir do CEP", () => {
  it("deixa o cursor onde entra o número", () => {
    const line = addressFromCep({ street: "Rua Um", neighborhood: "Centro", city: "Santos", state: "SP" }, "11010000");
    expect(line.text).toBe("Rua Um, , Centro, CEP 11010-000");
    expect(line.text.slice(0, line.caret)).toBe("Rua Um, ");
  });

  it("CEP da cidade inteira começa sem rua", () => {
    expect(addressFromCep({ street: "", neighborhood: "", city: "Serra da Saudade", state: "MG" }, "35617000")).toEqual({
      text: "CEP 35617-000",
      caret: 0,
    });
  });
});

describe("consulta ao ViaCEP", () => {
  it("envia só o CEP, sem cookie nem referência da página", async () => {
    const fetchImpl = vi.fn(async () => response(200, VIACEP_BODY));
    const result = await lookupCep(CEP, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://viacep.com.br/ws/11010000/json/");
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("não chama o serviço com CEP incompleto", async () => {
    const fetchImpl = vi.fn();
    expect((await lookupCep("1101", { fetchImpl })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falha de rede ou de serviço vira mensagem para preencher à mão", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await lookupCep(CEP, { fetchImpl: offline })).toMatchObject({ ok: false, error: expect.stringContaining("à mão") });
    expect(await lookupCep(CEP, { fetchImpl: vi.fn(async () => response(503, {})) })).toMatchObject({ ok: false });
    expect(await lookupCep(CEP, { fetchImpl: vi.fn(async () => response(400, {})) })).toMatchObject({ error: "CEP inválido. Confira os números." });
  });

  it("desiste quando o serviço demora", async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    expect(await lookupCep(CEP, { fetchImpl: hanging as unknown as typeof fetch, timeoutMs: 10 })).toMatchObject({ ok: false });
  });
});
