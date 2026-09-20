// Gerado por scripts/build-functions.mjs.
/**
 * Política de remarcação pela própria pessoa atendida (Fase 3, 13.6), como DADO.
 *
 * **Nasce desligada, e isso não é timidez.** Deixar a pessoa mexer na agenda
 * sozinha é uma decisão de cada organização — em algumas profissões, horário
 * remarcado sem a equipe ver é problema clínico, não conveniência.
 *
 * **Quem liga é quem administra a agenda**, e isso não exigiu permissão nova: a
 * política vive dentro de `settings.agenda`, que já é governado por
 * `agendaSettings:update` (só OWNER e ADMIN) em `src/config/permissions.ts` e
 * pela regra de `settings.agenda` em `firestore.rules`. Criar uma permissão
 * paralela seria duas verdades sobre a mesma tela (regra 8 do AGENTS.md).
 *
 * `lib/agenda/availability.ts` responde **quando** há vaga; este arquivo
 * responde **se** aquele pedido pode virar remarcação.
 */
/**
 * Padrão de toda organização. Tudo desligado ou conservador: a organização
 * escolhe afrouxar, e a escolha aparece na tela e na trilha.
 */
export const DEFAULT_RESCHEDULE_POLICY = {
    enabled: false,
    minimumNoticeHours: 24,
    maxReschedulesPerAppointment: 1,
    offeredSlots: 3,
    allowProfessionalChange: false,
    searchWindowDays: 14,
};
export const RESCHEDULE_LIMITS = {
    minimumNoticeHours: { min: 0, max: 168 },
    maxReschedulesPerAppointment: { min: 1, max: 5 },
    offeredSlots: { min: 2, max: 5 },
    searchWindowDays: { min: 1, max: 60 },
};
/**
 * Quanto tempo o horário escolhido fica segurado enquanto a pessoa confirma.
 *
 * Curto de propósito: reserva parada é horário que ninguém pode marcar. Se a
 * confirmação não vier, o horário volta a ser oferecido a quem quer que seja.
 */
export const RESCHEDULE_HOLD_MINUTES = 10;
export const RESCHEDULE_REFUSAL_REASONS = [
    "POLICY_DISABLED",
    "TOO_LATE",
    "LIMIT_REACHED",
    "APPOINTMENT_NOT_FOUND",
    "APPOINTMENT_NOT_ACTIVE",
    "NO_SLOTS",
];
/** O que a equipe lê no alerta quando o pedido não pôde ser automático. */
export const RESCHEDULE_REFUSAL_LABELS = {
    POLICY_DISABLED: "A organização não permite remarcação pela pessoa atendida.",
    TOO_LATE: "O pedido chegou com menos antecedência do que a política exige.",
    LIMIT_REACHED: "Este atendimento já atingiu o limite de remarcações.",
    APPOINTMENT_NOT_FOUND: "Não há atendimento futuro para remarcar.",
    APPOINTMENT_NOT_ACTIVE: "O atendimento não está mais ativo.",
    NO_SLOTS: "Não há horário livre dentro da janela de busca.",
};
export function rescheduleHoldEndsAt(now) {
    return new Date(Date.parse(now) + RESCHEDULE_HOLD_MINUTES * 60_000).toISOString();
}
