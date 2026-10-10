// Gerado por scripts/build-functions.mjs.
import { LEAD_TEAM_TRANSITIONS, LEAD_WHATSAPP_CONSENT } from "./leads-config.js";
import { foldInbound } from "./automation-inbound.js";
import { applyConsentChanges, currentConsentRecord, isCompleteConsentRecord, isRecordFormat, } from "./notifications-consent-record.js";
/**
 * Ciclo de vida do lead, sem I/O: situação, consentimento e quem recebe a
 * resposta. O webhook e o painel chamam as mesmas funções, e as rules espelham
 * `canTeamMoveLead`.
 */
// ------------------------------------------------------------ situação
/**
 * A situação depois de uma mensagem recebida.
 *
 * Mensagem atrasada não mexe em nada: a ordem de chegada não reescreve o que
 * já se sabe. Assumido continua assumido — só a equipe devolve uma conversa.
 * Encerrado que volta a escrever volta para a equipe, nunca para `NEW`.
 */
export function leadStatusAfterInbound(current, input) {
    if (current === null)
        return input.requiresHuman ? "WAITING_TEAM" : "NEW";
    if (!input.newer)
        return current;
    switch (current) {
        case "NEW":
            return input.requiresHuman ? "WAITING_TEAM" : "NEW";
        case "WAITING_TEAM":
        case "TAKEN_OVER":
            return current;
        case "CLOSED":
            return "WAITING_TEAM";
    }
}
/** O que a equipe pode fazer pelo painel. Espelha `leadTeamTransitionOk()`. */
export function canTeamMoveLead(from, to) {
    return LEAD_TEAM_TRANSITIONS[from].includes(to);
}
// ------------------------------------------------------- consentimento
export function leadConsentState(consent) {
    const record = currentConsentRecord(consent, "WHATSAPP");
    if (!record)
        return "ABSENT";
    if (record.withdrawn)
        return "WITHDRAWN";
    if (!isCompleteConsentRecord(record))
        return "ABSENT";
    return record.textVersion === LEAD_WHATSAPP_CONSENT.textVersion
        ? "GRANTED"
        : "OUTDATED";
}
/**
 * Por que a Dara não pode responder a este lead, ou `null` quando pode.
 *
 * Mais estrito que o cadastro: além do registro completo que nomeia o canal,
 * exige a versão VIGENTE do texto. O lead autorizou por uma frase; frase de
 * texto antigo não cobre o que o texto novo promete.
 */
export function leadConsentProblem(consent) {
    switch (leadConsentState(consent)) {
        case "ABSENT":
            return "MISSING_CONSENT";
        case "WITHDRAWN":
            return "CONSENT_REVOKED";
        case "OUTDATED":
            return "CONSENT_TEXT_OUTDATED";
        case "GRANTED":
            return null;
    }
}
/** A mensagem inteira é a frase de autorização, e nada mais. */
export function isLeadConsentAcceptance(text) {
    return LEAD_WHATSAPP_CONSENT.acceptanceTerms.includes(foldInbound(text));
}
function subjectAct(at) {
    // A própria pessoa, pelo canal: o backend afirma, nunca o navegador.
    return { at, recordedBy: { kind: "SUBJECT", userId: null }, medium: "MESSAGE" };
}
/**
 * Registra a autorização para o WhatsApp na versão vigente. Registro de texto
 * anterior é encerrado e um novo é acrescentado: o histórico mostra as duas
 * versões, e nada sai da lista.
 */
export function grantLeadConsent(consent, at) {
    const act = subjectAct(at);
    const grant = {
        textVersion: LEAD_WHATSAPP_CONSENT.textVersion,
        subjectIsMinor: false,
        legalGuardian: null,
    };
    const outdated = leadConsentState(consent) === "OUTDATED";
    const base = outdated
        ? applyConsentChanges(consent, [{ channel: "WHATSAPP", kind: "WITHDRAWN" }], act, grant)
        : consent;
    const result = applyConsentChanges(base, [{ channel: "WHATSAPP", kind: "GRANTED" }], act, grant);
    // `applyConsentChanges` com mudança sempre devolve o formato por canal.
    return isRecordFormat(result)
        ? result
        : { formatVersion: 2, channels: {}, legacy: null };
}
/** Retira só o WhatsApp, pela própria pessoa. Sem registro vigente, nada muda. */
export function withdrawLeadConsent(consent, at) {
    const record = currentConsentRecord(consent, "WHATSAPP");
    if (!record || record.withdrawn)
        return consent ?? null;
    return applyConsentChanges(consent, [{ channel: "WHATSAPP", kind: "WITHDRAWN" }], subjectAct(at), { textVersion: LEAD_WHATSAPP_CONSENT.textVersion, subjectIsMinor: false, legalGuardian: null });
}
// -------------------------------------------------------- destinatário
/**
 * O lead como destinatário de resposta, ou `null` sem consentimento vigente.
 *
 * Sem nome de propósito: o lead não informou nenhum, e a apresentação da
 * assistente usa a forma sem nome. O aceite geral só é afirmado quando o
 * consentimento do lead está vigente — o portão da regra 11 confere o resto
 * (registro do canal, regra, remetente, profissão, contato) como para todos.
 */
export function leadRecipient(lead) {
    if (leadConsentProblem(lead.notificationConsent))
        return null;
    return {
        id: lead.id,
        fullName: "",
        preferredName: null,
        email: null,
        phone: lead.phone,
        appointmentNotificationsEnabled: true,
        notificationConsent: lead.notificationConsent,
    };
}
