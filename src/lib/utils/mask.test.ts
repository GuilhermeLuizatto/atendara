import { describe, expect, it } from "vitest";

import { formatDocumentInput } from "@/lib/finance/receipts";
import { formatCepInput } from "@/lib/geo/cep";

import { applyMask } from "./mask";

const CPF = "529.982.247-25";

describe("edição com máscara", () => {
  it("digitar no fim acompanha a máscara", () => {
    expect(applyMask("5299", 4, "529", "insertText", formatDocumentInput)).toEqual({ value: "529.9", caret: 5 });
  });

  it("corrigir um dígito no meio mantém o cursor no lugar", () => {
    // Apagou o "8" de "529.982…": o cursor estava depois dele (posição 6).
    expect(applyMask("529.92.247-25", 5, CPF, "deleteContentBackward", formatDocumentInput)).toEqual({ value: "529.922.472-5", caret: 5 });
  });

  it("Backspace logo depois do ponto apaga o dígito antes dele", () => {
    // "529.|982…": o navegador tirou só o ponto.
    expect(applyMask("529982.247-25", 3, CPF, "deleteContentBackward", formatDocumentInput)).toEqual({ value: "529.822.472-5", caret: 2 });
  });

  it("Delete logo antes do ponto apaga o dígito depois dele", () => {
    // "529|.982…": o navegador tirou só o ponto.
    expect(applyMask("529982.247-25", 3, CPF, "deleteContentForward", formatDocumentInput)).toEqual({ value: "529.822.472-5", caret: 3 });
  });

  it("Backspace no hífen do CEP apaga o último número antes dele", () => {
    expect(applyMask("11010000", 5, "11010-000", "deleteContentBackward", formatCepInput)).toEqual({ value: "11010-00", caret: 4 });
  });

  it("caractere recusado pela máscara não mexe no valor e devolve o cursor", () => {
    // Letra no dígito verificador do CNPJ some.
    expect(applyMask("12.ABC.345/01DEX", 16, "12.ABC.345/01DE", "insertText", formatDocumentInput)).toEqual({ value: "12.ABC.345/01DE", caret: 15 });
  });

  it("Backspace no começo não apaga nada", () => {
    expect(applyMask(CPF, 0, CPF, "deleteContentBackward", formatDocumentInput)).toEqual({ value: CPF, caret: 0 });
  });
});
