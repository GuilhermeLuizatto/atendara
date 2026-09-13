// Gerado por scripts/build-functions.mjs.
import { LEGAL_GUARDIAN_NAME_MIN_LENGTH } from "./notifications-config.js";
import { CONSENT_MEDIA, CONSENT_RECORDER_KINDS, LEGAL_GUARDIAN_RELATIONSHIPS, OUTBOUND_CHANNELS, } from "./types.js";
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
/**
 * A versao do texto e identificador, nao frase. O padrao fechado impede que o
 * campo vire texto livre — ele vai para `auditLogs.metadata`, que a
 * pseudonimizacao nunca toca.
 */
export const CONSENT_TEXT_VERSION_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;
const RECORD_KEYS = ["granted", "textVersion", "subjectIsMinor", "legalGuardian", "withdrawn"];
const ACT_KEYS = ["at", "recordedBy", "medium"];
const RECORDER_KEYS = ["kind", "userId"];
const GUARDIAN_KEYS = ["fullName", "relationship"];
export function isRecordFormat(consent) {
    return Boolean(consent) && consent.formatVersion === 2;
}
/** Do registro mais antigo ao atual. Formato antigo nao tem historico por canal. */
export function channelHistory(consent, channel) {
    if (!isRecordFormat(consent))
        return [];
    const history = consent.channels[channel];
    return Array.isArray(history) ? history : [];
}
export function currentConsentRecord(consent, channel) {
    const history = channelHistory(consent, channel);
    return history[history.length - 1] ?? null;
}
function isActive(record) {
    return record !== null && !record.withdrawn;
}
/** Canais com registro vigente, completo ou nao. A elegibilidade confere o resto. */
export function activeConsentChannels(consent) {
    return OUTBOUND_CHANNELS.filter((channel) => isActive(currentConsentRecord(consent, channel)));
}
/** O registro vigente mais recente, de qualquer canal. Serve para sugerir o responsavel. */
export function latestConsentRecord(consent) {
    let latest = null;
    for (const channel of OUTBOUND_CHANNELS) {
        for (const record of channelHistory(consent, channel)) {
            if (!latest || record.granted.at > latest.granted.at)
                latest = record;
        }
    }
    return latest;
}
// ------------------------------------------------------------ completude
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value, keys) {
    if (!isPlainObject(value))
        return false;
    const own = Object.keys(value);
    return own.length === keys.length && keys.every((key) => key in value);
}
export function isCompleteConsentAct(act) {
    if (!isPlainObject(act))
        return false;
    const { at, recordedBy, medium } = act;
    if (typeof at !== "string" || !ISO_INSTANT.test(at) || Number.isNaN(Date.parse(at)))
        return false;
    if (!CONSENT_MEDIA.includes(medium))
        return false;
    if (!isPlainObject(recordedBy))
        return false;
    if (!CONSENT_RECORDER_KINDS.includes(recordedBy.kind))
        return false;
    // Registro da equipe sem autor nao prova nada; o da propria pessoa nao tem uid de equipe.
    return recordedBy.kind === "STAFF"
        ? typeof recordedBy.userId === "string" && recordedBy.userId.length > 0
        : recordedBy.userId === null;
}
function isCompleteGuardian(record) {
    if (record.subjectIsMinor === false)
        return record.legalGuardian === null;
    if (record.subjectIsMinor !== true)
        return false;
    const guardian = record.legalGuardian;
    return (isPlainObject(guardian) &&
        typeof guardian.fullName === "string" &&
        guardian.fullName.trim().length >= LEGAL_GUARDIAN_NAME_MIN_LENGTH &&
        LEGAL_GUARDIAN_RELATIONSHIPS.includes(guardian.relationship));
}
/**
 * O que um registro precisa ter para autorizar envio: data, versao do texto,
 * quem registrou, meio e, para menor de idade, o responsavel legal.
 */
export function isCompleteConsentRecord(record) {
    if (!isPlainObject(record))
        return false;
    const candidate = record;
    return (isCompleteConsentAct(candidate.granted) &&
        typeof candidate.textVersion === "string" &&
        CONSENT_TEXT_VERSION_PATTERN.test(candidate.textVersion) &&
        isCompleteGuardian(candidate) &&
        (candidate.withdrawn === null || isCompleteConsentAct(candidate.withdrawn)));
}
/** O que precisa acontecer para que os canais vigentes passem a ser `desired`. */
export function plannedConsentChanges(saved, desired) {
    return OUTBOUND_CHANNELS.flatMap((channel) => {
        const active = isActive(currentConsentRecord(saved, channel));
        const wanted = desired.includes(channel);
        if (wanted && !active)
            return [{ channel, kind: "GRANTED" }];
        if (!wanted && active)
            return [{ channel, kind: "WITHDRAWN" }];
        return [];
    });
}
/**
 * Aplica as mudancas sem tocar no que ja existe. Formato antigo vira `legacy`,
 * inteiro: passar a registrar por canal nao pode apagar o que havia.
 */
export function applyConsentChanges(saved, changes, act, grant) {
    if (changes.length === 0)
        return saved ?? null;
    const base = isRecordFormat(saved)
        ? saved
        : { formatVersion: 2, channels: {}, legacy: saved ?? null };
    const channels = { ...base.channels };
    const stamp = () => ({ ...act, recordedBy: { ...act.recordedBy } });
    for (const change of changes) {
        const history = [...(channels[change.channel] ?? [])];
        const last = history[history.length - 1] ?? null;
        if (change.kind === "GRANTED" && !isActive(last)) {
            history.push({
                granted: stamp(),
                textVersion: grant.textVersion,
                subjectIsMinor: grant.subjectIsMinor,
                legalGuardian: grant.subjectIsMinor && grant.legalGuardian ? { ...grant.legalGuardian } : null,
                withdrawn: null,
            });
        }
        else if (change.kind === "WITHDRAWN" && last && isActive(last)) {
            history[history.length - 1] = { ...last, withdrawn: stamp() };
        }
        channels[change.channel] = history;
    }
    return { formatVersion: 2, channels, legacy: base.legacy ?? null };
}
/** O que mudou entre dois estados, pelo mesmo criterio das regras. */
export function consentChangesBetween(before, after) {
    return OUTBOUND_CHANNELS.flatMap((channel) => {
        const previous = channelHistory(before, channel);
        const next = channelHistory(after, channel);
        if (next.length > previous.length)
            return [{ channel, kind: "GRANTED" }];
        const old = previous[previous.length - 1];
        const last = next[next.length - 1];
        if (old && last && next.length === previous.length && !old.withdrawn && last.withdrawn) {
            return [{ channel, kind: "WITHDRAWN" }];
        }
        return [];
    });
}
/**
 * Resumo para `auditLogs.metadata`: canal, ato, meio e versao do texto.
 *
 * Nunca o nome do responsavel nem outro dado de pessoa — `metadata` e campo
 * protegido da trilha e sobrevive, sem pseudonimizacao, a eliminacao do
 * cadastro. E essa sobrevivencia que mantem a prova de que houve consentimento
 * depois que o historico sai junto com o cadastro.
 */
export function consentAuditMetadata(before, after) {
    const parts = consentChangesBetween(before, after).map(({ channel, kind }) => {
        const record = currentConsentRecord(after, channel);
        if (kind === "WITHDRAWN")
            return `${channel}:WITHDRAWN:${record.withdrawn.medium}`;
        const guardian = record.subjectIsMinor ? ":LEGAL_GUARDIAN" : "";
        return `${channel}:GRANTED:${record.granted.medium}:${record.textVersion}${guardian}`;
    });
    return parts.length > 0 ? parts.join(", ") : null;
}
// ------------------------------------------------- trava (espelho das rules)
function sameValue(a, b) {
    if (a === b)
        return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return (Array.isArray(a) &&
            Array.isArray(b) &&
            a.length === b.length &&
            a.every((item, index) => sameValue(item, b[index])));
    }
    if (!isPlainObject(a) || !isPlainObject(b))
        return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameValue(a[key], b[key]));
}
export function sameConsent(a, b) {
    return sameValue(a ?? null, b ?? null);
}
function isActBy(act, userId) {
    return (hasExactKeys(act, ACT_KEYS) &&
        hasExactKeys(act.recordedBy, RECORDER_KEYS) &&
        isCompleteConsentAct(act) &&
        act.recordedBy.kind === "STAFF" &&
        act.recordedBy.userId === userId);
}
function isNewRecordBy(record, userId) {
    if (!hasExactKeys(record, RECORD_KEYS) || !isCompleteConsentRecord(record))
        return false;
    if (record.legalGuardian !== null && !hasExactKeys(record.legalGuardian, GUARDIAN_KEYS))
        return false;
    return record.withdrawn === null && isActBy(record.granted, userId);
}
function channelTransitionAllowed(before, after, userId) {
    if (!Array.isArray(after))
        return false;
    const kept = before.length;
    if (sameValue(after, before))
        return true;
    if (after.length === kept + 1) {
        return (sameValue(after.slice(0, kept), before) &&
            (kept === 0 || Boolean(before[kept - 1].withdrawn)) &&
            isNewRecordBy(after[kept], userId));
    }
    if (kept > 0 && after.length === kept) {
        const previous = before[kept - 1];
        const next = after[kept - 1];
        return (sameValue(after.slice(0, kept - 1), before.slice(0, kept - 1)) &&
            !previous.withdrawn &&
            isPlainObject(next) &&
            sameValue({ ...next, withdrawn: null }, { ...previous, withdrawn: null }) &&
            isActBy(next.withdrawn, userId));
    }
    return false;
}
/**
 * A escrita de `after` sobre `before`, feita por `userId`, preserva o
 * historico? E a mesma pergunta de `consentWriteOk()` nas rules.
 */
export function isAllowedConsentTransition(before, after, userId) {
    if (sameConsent(before, after))
        return true;
    if (!userId || !isRecordFormat(after) || !hasExactKeys(after, ["formatVersion", "channels", "legacy"])) {
        return false;
    }
    const expectedLegacy = isRecordFormat(before) ? before.legacy : (before ?? null);
    if (!sameValue(after.legacy ?? null, expectedLegacy ?? null))
        return false;
    if (!isPlainObject(after.channels))
        return false;
    if (Object.keys(after.channels).some((key) => !OUTBOUND_CHANNELS.includes(key))) {
        return false;
    }
    return OUTBOUND_CHANNELS.every((channel) => channelTransitionAllowed(channelHistory(before, channel), after.channels[channel] ?? [], userId));
}
