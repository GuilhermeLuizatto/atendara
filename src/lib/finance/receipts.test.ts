import { describe, expect, it } from "vitest";

import {
  amountInWords,
  cancelReasonError,
  documentInputError,
  documentKind,
  formatDocument,
  formatDocumentInput,
  isValidCnpj,
  isValidCpf,
  maskDocument,
  validateIssuer,
  validateReceiptRequest,
} from "./receipts";

// Documentos gerados só para teste: dígitos verificadores válidos, sem dono.
const CPF = "52998224725";
const CNPJ = "11222333000181";

describe("valor por extenso", () => {
  it.each([
    [1, "um centavo"],
    [99, "noventa e nove centavos"],
    [100, "um real"],
    [101, "um real e um centavo"],
    [200, "dois reais"],
    [1_500, "quinze reais"],
    [10_000, "cem reais"],
    [10_100, "cento e um reais"],
    [15_020, "cento e cinquenta reais e vinte centavos"],
    [100_000, "mil reais"],
    [100_100, "mil e um reais"],
    [110_000, "mil e cem reais"],
    [123_400, "mil duzentos e trinta e quatro reais"],
    [200_000, "dois mil reais"],
    [1_999_999, "dezenove mil novecentos e noventa e nove reais e noventa e nove centavos"],
    [100_000_000, "um milhão de reais"],
    [250_000_000, "dois milhões e quinhentos mil reais"],
    [100_050_000, "um milhão e quinhentos reais"],
    [45_000, "quatrocentos e cinquenta reais"],
    [1_700, "dezessete reais"],
    [1_400, "catorze reais"],
  ])("%i centavos → %s", (cents, words) => {
    expect(amountInWords(cents)).toBe(words);
  });

  it("recusa zero, negativo e fração de centavo", () => {
    expect(() => amountInWords(0)).toThrow();
    expect(() => amountInWords(-100)).toThrow();
    expect(() => amountInWords(10.5)).toThrow();
  });
});

describe("CPF e CNPJ", () => {
  it("confere os dígitos verificadores", () => {
    expect(isValidCpf(CPF)).toBe(true);
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCnpj(CNPJ)).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });

  it("formata e mascara", () => {
    expect(formatDocument(CPF)).toBe("529.982.247-25");
    expect(formatDocument(CNPJ)).toBe("11.222.333/0001-81");
    expect(maskDocument(CPF)).toBe("***.982.247-**");
    expect(maskDocument(CNPJ)).toBe("**.222.333/0001-**");
    expect(maskDocument(null)).toBeNull();
  });
});

describe("CNPJ com letras (Receita, desde 31/07/2026)", () => {
  // Exemplo da documentação da Receita e o primeiro CNPJ emitido no formato novo.
  const ALPHA = "12ABC34501DE35";
  const FIRST_ISSUED = "00.000.000/E08G-12";

  it("confere os dígitos verificadores pelo código ASCII menos 48", () => {
    expect(isValidCnpj(ALPHA)).toBe(true);
    expect(isValidCnpj(FIRST_ISSUED)).toBe(true);
    expect(isValidCnpj("12.abc.345/01de-35")).toBe(true);
    expect(isValidCnpj("12ABC34501DE36")).toBe(false);
    expect(isValidCnpj("12ABC34501DE3X")).toBe(false);
    expect(isValidCnpj("AAAAAAAAAAAAAA")).toBe(false);
  });

  it("formata e mascara", () => {
    expect(formatDocument(ALPHA)).toBe("12.ABC.345/01DE-35");
    expect(maskDocument(ALPHA)).toBe("**.ABC.345/01DE-**");
  });

  it("emissor guarda o CNPJ em maiúsculas, sem pontuação", () => {
    const issuer = { issuerName: "Clínica Nova", issuerDocument: "12.abc.345/01de-35", issuerAddress: "Rua Um, 10", issuerCity: "Santos/SP" };
    expect(validateIssuer(issuer)).toMatchObject({ ok: true, value: { issuerDocument: ALPHA } });
  });

  it("CPF não aceita letra no meio", () => {
    const issuer = { issuerName: "Ana", issuerDocument: "529.982.247-2A5", issuerAddress: "Rua Um, 10", issuerCity: "Santos/SP" };
    expect(validateIssuer(issuer).ok).toBe(false);
  });
});

describe("máscara enquanto se digita", () => {
  it.each([
    ["", ""],
    ["529", "529"],
    ["5299", "529.9"],
    ["5299822", "529.982.2"],
    ["52998224725", "529.982.247-25"],
    ["529982247250", "52.998.224/7250"],
    ["11222333000181", "11.222.333/0001-81"],
    ["112223330001819999", "11.222.333/0001-81"],
    ["12abc", "12.ABC"],
    ["12ABC34501DE35", "12.ABC.345/01DE-35"],
    ["12ABC34501DEX5", "12.ABC.345/01DE-5"],
    [" 529.982.247-25 ", "529.982.247-25"],
  ])("%j vira %j", (typed, shown) => {
    expect(formatDocumentInput(typed)).toBe(shown);
  });

  it("limita o campo a 18 caracteres, o tamanho do CNPJ formatado", () => {
    expect(formatDocumentInput("x".repeat(60) + "1".repeat(60)).length).toBeLessThanOrEqual(18);
  });

  it("reconhece o tipo pelo que foi digitado", () => {
    expect(documentKind("529.982.247-25")).toBe("CPF");
    expect(documentKind("529982247250")).toBe("CNPJ");
    expect(documentKind("12A")).toBe("CNPJ");
  });

  it("explica o erro ao sair do campo", () => {
    expect(documentInputError("")).toBeNull();
    expect(documentInputError("529.982")).toBe("CPF incompleto: são 11 números.");
    expect(documentInputError("529.982.247-24")).toBe("CPF inválido: confira os números.");
    expect(documentInputError("529.982.247-25")).toBeNull();
    expect(documentInputError("11.222.333/0001")).toBe("CNPJ incompleto: são 14 caracteres.");
    expect(documentInputError("11.222.333/0001-80")).toBe("CNPJ inválido: confira os caracteres.");
    expect(documentInputError("12.ABC.345/01DE-35")).toBeNull();
  });
});

describe("validação", () => {
  const issuer = { issuerName: " Ana Psicologa ", issuerDocument: "529.982.247-25", issuerAddress: "Rua Um, 10", issuerCity: "Santos" };

  it("emissor aceita CPF ou CNPJ válidos e guarda só os dígitos", () => {
    expect(validateIssuer(issuer)).toEqual({ ok: true, value: { issuerName: "Ana Psicologa", issuerDocument: CPF, issuerAddress: "Rua Um, 10", issuerCity: "Santos" } });
    expect(validateIssuer({ ...issuer, issuerDocument: CNPJ }).ok).toBe(true);
    expect(validateIssuer({ ...issuer, issuerDocument: "123" }).ok).toBe(false);
    expect(validateIssuer({ ...issuer, issuerCity: "" }).ok).toBe(false);
  });

  it("emissor explica o que falta no endereço", () => {
    expect(validateIssuer({ ...issuer, issuerAddress: "  " })).toEqual({ ok: false, error: "Informe o endereço de quem emite." });
    expect(validateIssuer({ ...issuer, issuerAddress: "R".repeat(201) })).toEqual({
      ok: false,
      error: "O endereço tem no máximo 200 caracteres; hoje tem 201.",
    });
    expect(validateIssuer({ ...issuer, issuerAddress: "Praça da Sé, , Sé, CEP 01001-000" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Complete o número"),
    });
    expect(validateIssuer({ ...issuer, issuerAddress: "Praça da Sé, 100, Sé, CEP 01001-000" }).ok).toBe(true);
  });

  const request = { payerName: "Bruno", payerDocument: null, beneficiaryName: null, beneficiaryDocument: null, description: "Sessão" };

  it("quem paga: nome obrigatório, CPF opcional e conferido", () => {
    expect(validateReceiptRequest(request).ok).toBe(true);
    expect(validateReceiptRequest({ ...request, payerName: " " }).ok).toBe(false);
    expect(validateReceiptRequest({ ...request, payerDocument: "529.982.247-25" })).toMatchObject({ ok: true, value: { payerDocument: CPF } });
    expect(validateReceiptRequest({ ...request, payerDocument: "12345678900" }).ok).toBe(false);
  });

  it("quem foi atendido: CPF só com nome", () => {
    expect(validateReceiptRequest({ ...request, beneficiaryDocument: CPF }).ok).toBe(false);
    expect(validateReceiptRequest({ ...request, beneficiaryName: "Carla, filha", beneficiaryDocument: CPF }).ok).toBe(true);
  });

  it("cancelamento exige motivo curto", () => {
    expect(cancelReasonError(" ")).not.toBeNull();
    expect(cancelReasonError("x".repeat(201))).not.toBeNull();
    expect(cancelReasonError("Valor digitado errado")).toBeNull();
  });
});

describe("conteúdo e emissão", () => {
  it("conteúdo canônico muda quando qualquer campo impresso muda", async () => {
    const { receiptContent } = await import("./receipts");
    const base = {
      number: 1, issuerName: "Ana", issuerDocument: CPF, issuerAddress: "Rua", issuerCity: "Santos", issuerRegistry: "CRP 06/1",
      payerName: "Bruno", payerDocument: null, beneficiaryName: null, beneficiaryDocument: null, amountInCents: 45000,
      amountInWords: "quatrocentos e cinquenta reais", paidAt: "2026-09-25T12:00:00.000Z", method: "PIX", description: "Sessão", issuedAt: "2026-09-25T12:00:00.000Z",
    };
    expect(receiptContent(base)).toBe(receiptContent({ ...base }));
    expect(receiptContent({ ...base, amountInCents: 45001 })).not.toBe(receiptContent(base));
    expect(receiptContent({ ...base, payerName: "Bruna" })).not.toBe(receiptContent(base));
  });

  it("só receita paga, e um recibo válido por lançamento", async () => {
    const { issueReceiptError } = await import("./receipts");
    expect(issueReceiptError({ type: "INCOME", status: "PAID" }, 0)).toBeNull();
    expect(issueReceiptError({ type: "INCOME", status: "PENDING" }, 0)).toContain("pago");
    expect(issueReceiptError({ type: "EXPENSE", status: "PAID" }, 0)).toContain("receita");
    expect(issueReceiptError({ type: "INCOME", status: "PAID" }, 1)).toContain("Cancele");
    expect(issueReceiptError(null, 0)).not.toBeNull();
  });
});
