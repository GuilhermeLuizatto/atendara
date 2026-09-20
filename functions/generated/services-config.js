// Gerado por scripts/build-functions.mjs.
/**
 * Política do catálogo de serviços (Estética, E2.1), como DADO.
 *
 * `lib/agenda` e as telas executam; este arquivo decide o que vale.
 */
export const SERVICE_LIMITS = {
    name: { min: 2, max: 80 },
    description: { max: 240 },
    /** De 5 minutos a um dia inteiro de trabalho. */
    durationMinutes: { min: 5, max: 600 },
    /** Teto alto de propósito: quem cobra sabe quanto cobra. */
    priceInCents: { min: 0, max: 10_000_000 },
    returnIntervalDays: { min: 1, max: 365 },
    /** Quantos serviços uma organização pode ter. */
    count: 100,
};
/**
 * Catálogo inicial, criado junto com a organização de Estética.
 *
 * **Sem preço e desligado**, por decisão do titular em 13/09. São sugestões de
 * nome, para ela apagar, renomear ou ignorar — e nenhuma delas vale como
 * serviço até que ela diga o preço e a duração.
 */
export const AESTHETICS_SERVICE_SEEDS = [
    { name: "Manicure", description: null, durationMinutes: null, priceInCents: null, enabled: false, returnIntervalDays: null },
    { name: "Pedicure", description: null, durationMinutes: null, priceInCents: null, enabled: false, returnIntervalDays: null },
    { name: "Design de sobrancelha", description: null, durationMinutes: null, priceInCents: null, enabled: false, returnIntervalDays: null },
    { name: "Extensão de cílios", description: null, durationMinutes: null, priceInCents: null, enabled: false, returnIntervalDays: null },
    { name: "Depilação", description: null, durationMinutes: null, priceInCents: null, enabled: false, returnIntervalDays: null },
    { name: "Maquiagem", description: null, durationMinutes: null, priceInCents: null, enabled: false, returnIntervalDays: null },
];
export const SERVICE_ERRORS = {
    NAME_REQUIRED: "Dê um nome ao serviço.",
    NAME_TOO_LONG: "O nome do serviço está longo demais.",
    DUPLICATE_NAME: "Já existe um serviço com este nome.",
    DURATION_RANGE: "A duração precisa ficar entre 5 minutos e 10 horas.",
    PRICE_RANGE: "O valor precisa ser um número em reais, sem centavos negativos.",
    RETURN_RANGE: "O intervalo de retorno precisa ficar entre 1 e 365 dias.",
    /**
     * A regra que o titular escolheu em 20/09: ligado significa "pronto para
     * usar". Sem duração, a agenda não sabe quanto reservar; sem preço, o
     * atendimento nasce sem valor e o financeiro fica furado.
     */
    ENABLED_NEEDS_PRICE_AND_DURATION: "Para ligar o serviço, preencha a duração e o valor.",
    LIMIT_REACHED: "Este catálogo já tem o número máximo de serviços.",
};
