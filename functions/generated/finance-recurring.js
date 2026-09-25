// Gerado por scripts/build-functions.mjs.
import { atTime, toDateKey } from "./datetime.js";
import { err, ok } from "./types.js";
/**
 * Mensalidades (cobrador dos clientes, etapa C1), sem I/O.
 *
 * O mesmo codigo decide no painel e na rotina diaria do backend: o id do
 * lancamento do mes e deterministico, entao os dois lados podem tentar lancar
 * o mesmo mes sem nunca duplicar.
 */
export const RECURRING_LIMITS = {
    descriptionMax: 120,
    dueDayMin: 1,
    // 28 cabe em todo mes: "dia 31" viraria dia 3 de marco em fevereiro.
    dueDayMax: 28,
    maxAmountInCents: 100_000_000,
};
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isPeriod(value) {
    return typeof value === "string" && PERIOD.test(value);
}
/** Mes (`AAAA-MM`) do instante, no fuso do produto. */
export function periodOf(at) {
    return toDateKey(typeof at === "string" ? new Date(at) : at).slice(0, 7);
}
export function shiftPeriod(period, months) {
    const [year, month] = period.split("-").map(Number);
    const index = year * 12 + (month - 1) + months;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export function recurringTransactionId(chargeId, period) {
    return `${chargeId}-${period.replace("-", "")}`;
}
/** Meio-dia do dia de vencimento: longe da virada do dia em qualquer fuso. */
export function dueDateFor(period, dueDay) {
    return atTime(`${period}-${String(dueDay).padStart(2, "0")}`, 12);
}
export function validateRecurringCharge(input) {
    const description = input.description?.trim() ?? "";
    if (!input.clientId)
        return err("Escolha o cadastro que paga a mensalidade.");
    if (!description)
        return err("Descreva a mensalidade.");
    if (description.length > RECURRING_LIMITS.descriptionMax)
        return err(`A descrição tem no máximo ${RECURRING_LIMITS.descriptionMax} caracteres.`);
    if (!Number.isInteger(input.amountInCents) ||
        input.amountInCents <= 0 ||
        input.amountInCents > RECURRING_LIMITS.maxAmountInCents)
        return err("Informe um valor maior que zero.");
    if (!Number.isInteger(input.dueDay) ||
        input.dueDay < RECURRING_LIMITS.dueDayMin ||
        input.dueDay > RECURRING_LIMITS.dueDayMax)
        return err("O vencimento vai do dia 1 ao dia 28.");
    if (!isPeriod(input.startPeriod))
        return err("Escolha o mês de início.");
    return ok({ ...input, description });
}
/**
 * O lancamento que a mensalidade gera no mes, ou `null` quando ela nao cobra
 * aquele mes: pausada, encerrada ou ainda nao comecada.
 */
export function monthlyTransaction(charge, period, meta) {
    if (charge.status !== "ACTIVE" || period < charge.startPeriod)
        return null;
    return {
        id: recurringTransactionId(charge.id, period),
        organizationId: charge.organizationId,
        type: "INCOME",
        clientId: charge.clientId,
        clientName: charge.clientName,
        professionalId: charge.professionalId,
        appointmentId: null,
        appointmentPart: null,
        description: `${charge.description} — ${periodLabel(period)}`,
        amountInCents: charge.amountInCents,
        status: "PENDING",
        method: charge.method,
        dueDate: dueDateFor(period, charge.dueDay),
        paidAt: null,
        gateway: null,
        recurringChargeId: charge.id,
        period,
        createdAt: meta.now,
        updatedAt: meta.now,
        createdBy: meta.userId,
        updatedBy: meta.userId,
    };
}
const MONTHS = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
export function periodLabel(period) {
    const [year, month] = period.split("-").map(Number);
    return `${MONTHS[month - 1]} de ${year}`;
}
/**
 * O painel do mes. "Previsto" e o que as mensalidades lancaram para o mes, sem
 * cancelados; a taxa de recebimento e recebido sobre previsto, e fica `null`
 * quando nao ha nada previsto — zero por cento diria que ninguem pagou.
 */
export function summarizeMonth(charges, transactions, period) {
    const ofMonth = transactions.filter((item) => item.recurringChargeId && item.period === period && item.status !== "CANCELLED");
    const sum = (items) => items.reduce((total, item) => total + item.amountInCents, 0);
    const expected = sum(ofMonth);
    const received = sum(ofMonth.filter((item) => item.status === "PAID"));
    const byCharge = new Map(ofMonth.map((item) => [item.recurringChargeId, item]));
    const rows = charges
        .filter((charge) => charge.startPeriod <= period && (charge.status !== "ENDED" || byCharge.has(charge.id)))
        .map((charge) => ({ charge, transaction: byCharge.get(charge.id) ?? null }))
        .sort((a, b) => a.charge.dueDay - b.charge.dueDay || (a.charge.clientName ?? "").localeCompare(b.charge.clientName ?? "", "pt-BR"));
    return {
        expectedInCents: expected,
        receivedInCents: received,
        pendingInCents: sum(ofMonth.filter((item) => item.status === "PENDING")),
        overdueInCents: sum(ofMonth.filter((item) => item.status === "OVERDUE")),
        collectionRate: expected ? received / expected : null,
        activeCharges: charges.filter((charge) => charge.status === "ACTIVE").length,
        rows,
    };
}
/** Meses ja lancados de uma mensalidade, do mais recente para o mais antigo. */
export function chargeHistory(chargeId, transactions) {
    return transactions
        .filter((item) => item.recurringChargeId === chargeId)
        .sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));
}
/** Encerrada e terminal: o historico fica, e cobrar de novo e outra mensalidade. */
export function statusTransitionError(from, to) {
    if (from === "ENDED")
        return "Mensalidade encerrada não muda. Crie outra, se voltar a cobrar.";
    if (from === to)
        return "A mensalidade já está nessa situação.";
    return null;
}
export const RECURRING_STATUS_AUDIT = {
    ACTIVE: "Mensalidade retomada.",
    PAUSED: "Mensalidade pausada.",
    ENDED: "Mensalidade encerrada.",
};
/**
 * O lancamento do mes corrente, se ainda nao foi lancado.
 *
 * Quem diz o que ja foi lancado e a propria mensalidade (`lastLaunchedPeriod`),
 * nao a lista de lancamentos: ela vem paginada, e um mes apagado de proposito
 * pelo profissional nao pode renascer. Painel e rotina diaria usam esta mesma
 * funcao e gravam o mes junto com o marcador.
 */
export function currentMonthLaunch(charge, meta) {
    const period = periodOf(meta.now);
    if (charge.lastLaunchedPeriod && charge.lastLaunchedPeriod >= period)
        return null;
    return monthlyTransaction(charge, period, meta);
}
/**
 * Cadastro com mensalidade ativa ou pausada nao sai: o mes seguinte nasceria
 * sem titular. Mesma trava na tela e no pedido de eliminacao do backend.
 */
export function openRecurringChargeError(charges, clientId) {
    return charges.some((charge) => charge.clientId === clientId && charge.status !== "ENDED")
        ? "Há mensalidade ativa ou pausada para este cadastro. Encerre-a antes."
        : null;
}
