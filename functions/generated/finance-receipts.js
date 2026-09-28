// Gerado por scripts/build-functions.mjs.
import { err, ok } from "./types.js";
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
function upToThousand(value) {
    if (value === 100)
        return "cem";
    const hundred = Math.floor(value / 100);
    const rest = value % 100;
    const parts = [];
    if (hundred)
        parts.push(HUNDREDS[hundred]);
    if (rest >= 10 && rest < 20)
        parts.push(TEENS[rest - 10]);
    else {
        const ten = Math.floor(rest / 10);
        const unit = rest % 10;
        if (ten)
            parts.push(TENS[ten]);
        if (unit)
            parts.push(UNITS[unit]);
    }
    return parts.join(" e ");
}
const SCALES = [
    [1_000_000_000, "bilhão", "bilhões"],
    [1_000_000, "milhão", "milhões"],
    [1_000, "mil", "mil"],
];
/** Inteiro positivo por extenso, na norma do português do Brasil. */
function integerInWords(value) {
    const groups = [];
    let rest = value;
    for (const [size, singular, plural] of SCALES) {
        const amount = Math.floor(rest / size);
        rest %= size;
        if (!amount)
            continue;
        const words = size === 1_000 && amount === 1 ? "mil" : `${upToThousand(amount)} ${amount === 1 ? singular : plural}`;
        groups.push({ words, amount });
    }
    if (rest)
        groups.push({ words: upToThousand(rest), amount: rest });
    // "e" antes do ultimo grupo quando ele e menor que cem ou centena redonda:
    // "mil e cem", "mil e vinte", mas "mil duzentos e trinta".
    return groups
        .map((group, index) => {
        if (index === 0)
            return group.words;
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
export function amountInWords(amountInCents) {
    if (!Number.isInteger(amountInCents) || amountInCents <= 0)
        throw new Error("Valor precisa ser inteiro e positivo.");
    const reais = Math.floor(amountInCents / 100);
    const centavos = amountInCents % 100;
    const parts = [];
    if (reais) {
        const words = integerInWords(reais);
        const roundBig = reais >= 1_000_000 && reais % 1_000_000 === 0;
        parts.push(`${words}${roundBig ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
    }
    if (centavos)
        parts.push(`${integerInWords(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
    return parts.join(" e ");
}
// ------------------------------------------------------------ CPF e CNPJ
export const onlyDigits = (value) => value.replace(/\D/g, "");
/**
 * Letras e numeros, em maiusculas. Desde 31/07/2026 a Receita emite CNPJ com
 * letras nas 12 primeiras posicoes (IN RFB 2.229/2024); os dois digitos
 * verificadores continuam numericos.
 */
export const documentCharacters = (value) => value.toUpperCase().replace(/[^0-9A-Z]/g, "");
const CNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/;
/** No CNPJ com letras, cada posicao vale o codigo ASCII menos 48; para numero da o mesmo de antes. */
function checkDigit(characters, weights) {
    const sum = weights.reduce((total, weight, index) => total + (characters.charCodeAt(index) - 48) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
}
export function isValidCpf(value) {
    const cpf = onlyDigits(value);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf))
        return false;
    const first = checkDigit(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = checkDigit(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return first === Number(cpf[9]) && second === Number(cpf[10]);
}
export function isValidCnpj(value) {
    const cnpj = documentCharacters(value);
    if (!CNPJ_PATTERN.test(cnpj) || /^(.)\1{13}$/.test(cnpj))
        return false;
    const first = checkDigit(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = checkDigit(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}
/** CPF so tem numeros; qualquer letra ou mais de 11 posicoes ja e CNPJ. */
export function documentKind(value) {
    const characters = documentCharacters(value);
    return /^\d{0,11}$/.test(characters) ? "CPF" : "CNPJ";
}
const CPF_GROUPS = [[3, ""], [3, "."], [3, "."], [2, "-"]];
const CNPJ_GROUPS = [[2, ""], [3, "."], [3, "."], [4, "/"], [2, "-"]];
function applyGroups(characters, groups) {
    let result = "";
    let start = 0;
    for (const [size, separator] of groups) {
        if (start >= characters.length)
            break;
        result += separator + characters.slice(start, start + size);
        start += size;
    }
    return result;
}
/**
 * Mascara enquanto se digita: ate 11 numeros, CPF; do 12o caractere em diante
 * ou com letra, CNPJ. Letra nas duas ultimas posicoes some, porque o digito
 * verificador do CNPJ e sempre numero.
 */
export function formatDocumentInput(value) {
    const characters = [...documentCharacters(value)]
        .filter((character, index) => index < 12 || /\d/.test(character))
        .slice(0, 14)
        .join("");
    return applyGroups(characters, documentKind(characters) === "CPF" ? CPF_GROUPS : CNPJ_GROUPS);
}
/** Ao sair do campo: diz o que falta ou o que esta errado, sem esperar o salvar. */
export function documentInputError(value) {
    const characters = documentCharacters(value);
    if (!characters)
        return null;
    if (documentKind(characters) === "CPF") {
        if (characters.length < 11)
            return "CPF incompleto: são 11 números.";
        return isValidCpf(characters) ? null : "CPF inválido: confira os números.";
    }
    if (characters.length < 14)
        return "CNPJ incompleto: são 14 caracteres.";
    return isValidCnpj(characters) ? null : "CNPJ inválido: confira os caracteres.";
}
export function formatDocument(value) {
    const characters = documentCharacters(value);
    if (/^\d{11}$/.test(characters))
        return applyGroups(characters, CPF_GROUPS);
    if (CNPJ_PATTERN.test(characters))
        return applyGroups(characters, CNPJ_GROUPS);
    return value;
}
/** Fora do recibo o documento aparece mascarado: lista, trilha, alerta. */
export function maskDocument(value) {
    if (!value)
        return null;
    const characters = documentCharacters(value);
    if (/^\d{11}$/.test(characters))
        return `***.${characters.slice(3, 6)}.${characters.slice(6, 9)}-**`;
    if (CNPJ_PATTERN.test(characters))
        return `**.${characters.slice(2, 5)}.${characters.slice(5, 8)}/${characters.slice(8, 12)}-**`;
    return "***";
}
// ------------------------------------------------------------ validacao
export const RECEIPT_LIMITS = {
    nameMax: 120,
    addressMax: 200,
    cityMax: 80,
    descriptionMax: 200,
    cancelReasonMax: 200,
};
/**
 * Quem emite: CPF (autonomo) ou CNPJ (clinica, inclusive o com letras), sempre
 * com os digitos verificadores. A cidade escolhida da lista do IBGE e conferida
 * so na tela: a lista nao cabe nas Security Rules nem precisa ir ao backend.
 */
export function validateIssuer(input) {
    const name = input.issuerName?.trim() ?? "";
    const document = documentCharacters(input.issuerDocument ?? "");
    const address = input.issuerAddress?.trim() ?? "";
    const city = input.issuerCity?.trim() ?? "";
    if (!name || name.length > RECEIPT_LIMITS.nameMax)
        return err("Informe o nome de quem emite o recibo.");
    const validDocument = /^\d{11}$/.test(document) ? isValidCpf(document) : isValidCnpj(document);
    if (!validDocument)
        return err("Informe um CPF ou CNPJ válido de quem emite.");
    if (!address)
        return err("Informe o endereço de quem emite.");
    if (address.length > RECEIPT_LIMITS.addressMax) {
        return err(`O endereço tem no máximo ${RECEIPT_LIMITS.addressMax} caracteres; hoje tem ${address.length}.`);
    }
    // O endereco vindo do CEP deixa o lugar do numero vazio ("Rua Um, , Centro");
    // sem esta trava o recibo sairia impresso assim.
    if (/,\s*,/.test(address))
        return err("Complete o número do endereço: há um espaço vazio entre duas vírgulas.");
    if (!city || city.length > RECEIPT_LIMITS.cityMax)
        return err("Informe a cidade da emissão.");
    return ok({ issuerName: name, issuerDocument: document, issuerAddress: address, issuerCity: city });
}
/** Quem paga e, se for outra pessoa, quem foi atendido (por exemplo, o responsavel pelo menor). */
export function validateReceiptRequest(input) {
    const payerName = input.payerName?.trim() ?? "";
    const payerDocument = input.payerDocument ? onlyDigits(input.payerDocument) : null;
    const beneficiaryName = input.beneficiaryName?.trim() || null;
    const beneficiaryDocument = input.beneficiaryDocument ? onlyDigits(input.beneficiaryDocument) : null;
    const description = input.description?.trim() ?? "";
    if (!payerName || payerName.length > RECEIPT_LIMITS.nameMax)
        return err("Informe o nome de quem pagou.");
    if (payerDocument && !isValidCpf(payerDocument) && !isValidCnpj(payerDocument))
        return err("O CPF de quem pagou não é válido.");
    if (beneficiaryName && beneficiaryName.length > RECEIPT_LIMITS.nameMax)
        return err("O nome de quem foi atendido é longo demais.");
    if (beneficiaryDocument && !beneficiaryName)
        return err("Informe o nome de quem foi atendido.");
    if (beneficiaryDocument && !isValidCpf(beneficiaryDocument))
        return err("O CPF de quem foi atendido não é válido.");
    if (!description || description.length > RECEIPT_LIMITS.descriptionMax)
        return err("Descreva a que se refere o pagamento.");
    return ok({ payerName, payerDocument, beneficiaryName, beneficiaryDocument, description });
}
export function cancelReasonError(reason) {
    const text = reason?.trim() ?? "";
    if (!text)
        return "Diga por que o recibo foi cancelado.";
    if (text.length > RECEIPT_LIMITS.cancelReasonMax)
        return `O motivo tem no máximo ${RECEIPT_LIMITS.cancelReasonMax} caracteres.`;
    return null;
}
/**
 * O que foi impresso, numa ordem fixa. O `contentHash` e o SHA-256 disto: uma
 * via reimpressa tem o mesmo codigo; um recibo adulterado, nao.
 */
export function receiptContent(receipt) {
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
export function issueReceiptError(transaction, issuedForTransaction) {
    if (!transaction || transaction.type !== "INCOME")
        return "Recibo só sai de uma receita.";
    if (transaction.status !== "PAID")
        return "Recibo só sai de lançamento pago.";
    if (issuedForTransaction > 0)
        return "Este lançamento já tem recibo. Cancele o anterior para emitir outro.";
    return null;
}
