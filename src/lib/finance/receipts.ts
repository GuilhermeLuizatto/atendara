import { err, ok, type Result } from "@/types";

/**
 * Recibos (ADR 0004, 14.9 — cobrador C3), sem I/O. A mesma regra decide na
 * callable que emite, no painel e na pagina que imprime.
 */

// ------------------------------------------------------------ por extenso

const UNITS = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const TEENS = ["dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 1 a 999. */
function upToThousand(value: number): string {
  if (value === 100) return "cem";
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundred) parts.push(HUNDREDS[hundred]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const ten = Math.floor(rest / 10);
    const unit = rest % 10;
    if (ten) parts.push(TENS[ten]);
    if (unit) parts.push(UNITS[unit]);
  }
  return parts.join(" e ");
}

const SCALES: Array<[number, string, string]> = [
  [1_000_000_000, "bilhão", "bilhões"],
  [1_000_000, "milhão", "milhões"],
  [1_000, "mil", "mil"],
];

/** Inteiro positivo por extenso, na norma do português do Brasil. */
function integerInWords(value: number): string {
  const groups: Array<{ words: string; amount: number }> = [];
  let rest = value;
  for (const [size, singular, plural] of SCALES) {
    const amount = Math.floor(rest / size);
    rest %= size;
    if (!amount) continue;
    const words = size === 1_000 && amount === 1 ? "mil" : `${upToThousand(amount)} ${amount === 1 ? singular : plural}`;
    groups.push({ words, amount });
  }
  if (rest) groups.push({ words: upToThousand(rest), amount: rest });
  // "e" antes do ultimo grupo quando ele e menor que cem ou centena redonda:
  // "mil e cem", "mil e vinte", mas "mil duzentos e trinta".
  return groups
    .map((group, index) => {
      if (index === 0) return group.words;
      const last = index === groups.length - 1;
      const joins = last && (group.amount < 100 || group.amount % 100 === 0);
      return `${joins ? "e " : ""}${group.words}`;
    })
    .join(" ");
}

/**
 * Valor em centavos por extenso: "cento e cinquenta reais e vinte centavos".
 * "De reais" depois de milhao ou bilhao redondo: "um milhão de reais".
 */
export function amountInWords(amountInCents: number): string {
  if (!Number.isInteger(amountInCents) || amountInCents <= 0) throw new Error("Valor precisa ser inteiro e positivo.");
  const reais = Math.floor(amountInCents / 100);
  const centavos = amountInCents % 100;
  const parts: string[] = [];
  if (reais) {
    const words = integerInWords(reais);
    const roundBig = reais >= 1_000_000 && reais % 1_000_000 === 0;
    parts.push(`${words}${roundBig ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) parts.push(`${integerInWords(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return parts.join(" e ");
}

// ------------------------------------------------------------ CPF e CNPJ

export const onlyDigits = (value: string): string => value.replace(/\D/g, "");

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const first = checkDigit(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cpf[9]) && second === Number(cpf[10]);
}

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const first = checkDigit(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

export function formatDocument(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value;
}

/** Fora do recibo o documento aparece mascarado: lista, trilha, alerta. */
export function maskDocument(value: string | null): string | null {
  if (!value) return null;
  const digits = onlyDigits(value);
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  return "***";
}

// ------------------------------------------------------------ validacao

export const RECEIPT_LIMITS = {
  nameMax: 120,
  addressMax: 200,
  cityMax: 80,
  descriptionMax: 200,
  cancelReasonMax: 200,
} as const;

export interface ReceiptIssuerInput {
  issuerName: string;
  issuerDocument: string;
  issuerAddress: string;
  issuerCity: string;
}

/** Quem emite: CPF (autonomo) ou CNPJ (clinica), sempre com os digitos verificadores. */
export function validateIssuer(input: ReceiptIssuerInput): Result<ReceiptIssuerInput> {
  const name = input.issuerName?.trim() ?? "";
  const document = onlyDigits(input.issuerDocument ?? "");
  const address = input.issuerAddress?.trim() ?? "";
  const city = input.issuerCity?.trim() ?? "";
  if (!name || name.length > RECEIPT_LIMITS.nameMax) return err("Informe o nome de quem emite o recibo.");
  if (!(isValidCpf(document) || isValidCnpj(document))) return err("Informe um CPF ou CNPJ válido de quem emite.");
  if (!address || address.length > RECEIPT_LIMITS.addressMax) return err("Informe o endereço de quem emite.");
  if (!city || city.length > RECEIPT_LIMITS.cityMax) return err("Informe a cidade da emissão.");
  return ok({ issuerName: name, issuerDocument: document, issuerAddress: address, issuerCity: city });
}

export interface ReceiptRequest {
  payerName: string;
  payerDocument: string | null;
  beneficiaryName: string | null;
  beneficiaryDocument: string | null;
  description: string;
}

/** Quem paga e, se for outra pessoa, quem foi atendido (por exemplo, o responsavel pelo menor). */
export function validateReceiptRequest(input: ReceiptRequest): Result<ReceiptRequest> {
  const payerName = input.payerName?.trim() ?? "";
  const payerDocument = input.payerDocument ? onlyDigits(input.payerDocument) : null;
  const beneficiaryName = input.beneficiaryName?.trim() || null;
  const beneficiaryDocument = input.beneficiaryDocument ? onlyDigits(input.beneficiaryDocument) : null;
  const description = input.description?.trim() ?? "";
  if (!payerName || payerName.length > RECEIPT_LIMITS.nameMax) return err("Informe o nome de quem pagou.");
  if (payerDocument && !isValidCpf(payerDocument) && !isValidCnpj(payerDocument)) return err("O CPF de quem pagou não é válido.");
  if (beneficiaryName && beneficiaryName.length > RECEIPT_LIMITS.nameMax) return err("O nome de quem foi atendido é longo demais.");
  if (beneficiaryDocument && !beneficiaryName) return err("Informe o nome de quem foi atendido.");
  if (beneficiaryDocument && !isValidCpf(beneficiaryDocument)) return err("O CPF de quem foi atendido não é válido.");
  if (!description || description.length > RECEIPT_LIMITS.descriptionMax) return err("Descreva a que se refere o pagamento.");
  return ok({ payerName, payerDocument, beneficiaryName, beneficiaryDocument, description });
}

export function cancelReasonError(reason: string): string | null {
  const text = reason?.trim() ?? "";
  if (!text) return "Diga por que o recibo foi cancelado.";
  if (text.length > RECEIPT_LIMITS.cancelReasonMax) return `O motivo tem no máximo ${RECEIPT_LIMITS.cancelReasonMax} caracteres.`;
  return null;
}

/**
 * O que foi impresso, numa ordem fixa. O `contentHash` e o SHA-256 disto: uma
 * via reimpressa tem o mesmo codigo; um recibo adulterado, nao.
 */
export function receiptContent(receipt: {
  number: number;
  issuerName: string;
  issuerDocument: string;
  issuerAddress: string;
  issuerCity: string;
  issuerRegistry: string | null;
  payerName: string;
  payerDocument: string | null;
  beneficiaryName: string | null;
  beneficiaryDocument: string | null;
  amountInCents: number;
  amountInWords: string;
  paidAt: string;
  method: string | null;
  description: string;
  issuedAt: string;
}): string {
  return JSON.stringify([
    receipt.number,
    receipt.issuerName,
    receipt.issuerDocument,
    receipt.issuerAddress,
    receipt.issuerCity,
    receipt.issuerRegistry,
    receipt.payerName,
    receipt.payerDocument,
    receipt.beneficiaryName,
    receipt.beneficiaryDocument,
    receipt.amountInCents,
    receipt.amountInWords,
    receipt.paidAt,
    receipt.method,
    receipt.description,
    receipt.issuedAt,
  ]);
}

/** Recibo so de receita paga, e um valido por lancamento. */
export function issueReceiptError(
  transaction: { type: string; status: string } | null,
  issuedForTransaction: number,
): string | null {
  if (!transaction || transaction.type !== "INCOME") return "Recibo só sai de uma receita.";
  if (transaction.status !== "PAID") return "Recibo só sai de lançamento pago.";
  if (issuedForTransaction > 0) return "Este lançamento já tem recibo. Cancele o anterior para emitir outro.";
  return null;
}
