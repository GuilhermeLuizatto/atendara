import { describe, expect, it } from "vitest";

import {
  amountInWords,
  cancelReasonError,
  formatDocument,
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

describe("validação", () => {
  const issuer = { issuerName: " Ana Psicologa ", issuerDocument: "529.982.247-25", issuerAddress: "Rua Um, 10", issuerCity: "Santos" };

  it("emissor aceita CPF ou CNPJ válidos e guarda só os dígitos", () => {
    expect(validateIssuer(issuer)).toEqual({ ok: true, value: { issuerName: "Ana Psicologa", issuerDocument: CPF, issuerAddress: "Rua Um, 10", issuerCity: "Santos" } });
    expect(validateIssuer({ ...issuer, issuerDocument: CNPJ }).ok).toBe(true);
    expect(validateIssuer({ ...issuer, issuerDocument: "123" }).ok).toBe(false);
    expect(validateIssuer({ ...issuer, issuerCity: "" }).ok).toBe(false);
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
