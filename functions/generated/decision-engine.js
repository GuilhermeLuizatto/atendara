// Gerado por scripts/build-functions.mjs.
import { AI_ENGINE_VERSION } from "./app-config.js";
import { classificationMeta } from "./classifications-config.js";
import { buildEvaluationContext } from "./rules-context.js";
import { resolvePrecedence } from "./rules-precedence.js";
import { classifyMessage } from "./classify.js";
import { INTENT_TO_CATEGORY, composeResponse } from "./ai-responses.js";
function attentionFor(classification) {
    if (classification === "POSSIBLE_RISK")
        return "CRITICAL";
    if (classification === "URGENT")
        return "HIGH";
    return classificationMeta(classification).autoResponseEligible
        ? "NORMAL"
        : "ATTENTION";
}
function withinWindow(hour, start, end) {
    const toMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const startHour = toMinutes(start);
    const endHour = toMinutes(end);
    // Janela que cruza a meia-noite (ex.: 21:00 as 07:00).
    return startHour <= endHour
        ? hour >= startHour && hour < endHour
        : hour >= startHour || hour < endHour;
}
/**
 * Motor de decisao.
 *
 * A ordem dos passos e a hierarquia do produto, e nao ha atalho: classificacao,
 * regras fundamentais, regras da profissao, regras do profissional, contexto,
 * permissao — e so entao responder ou escalar. Toda saida carrega o `trace`
 * usado pela auditoria e pelo simulador.
 *
 * Regra de ouro do arquivo: **na duvida, escalar**. Todo caminho que nao
 * termina numa autorizacao explicita cai em `ESCALATE_TO_PROFESSIONAL`.
 */
export function decide(request) {
    const { text, profession, organization, rules, channel, client, now } = request;
    const steps = [];
    const classification = classifyMessage(text, profession);
    const meta = classificationMeta(classification.classification);
    const attention = attentionFor(classification.classification);
    steps.push({
        label: "Classificação",
        outcome: "info",
        detail: `${meta.label} · ${Math.round(classification.confidence * 100)}% de confiança${classification.matchedTerms.length
            ? ` · sinais: ${classification.matchedTerms.slice(0, 3).join(", ")}`
            : ""}`,
    });
    const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: organization.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        weekday: "short",
    }).formatToParts(now);
    const hour = Number(local.find((part) => part.type === "hour")?.value);
    const minute = Number(local.find((part) => part.type === "minute")?.value);
    const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(local.find((part) => part.type === "weekday")?.value ?? "");
    const minutes = hour * 60 + minute;
    const context = buildEvaluationContext({
        classification: classification.classification,
        intent: classification.intent,
        channel,
        confidence: classification.confidence,
        clientModality: client?.modality ?? null,
        clientStatus: client?.status ?? null,
        clientHasOutstandingBalance: client?.hasOutstandingBalance ?? false,
        appointmentStatus: null,
        dayOfWeek,
        hour,
        withinBusinessHours: withinWindow(minutes, organization.settings.agenda.workdayStart, organization.settings.agenda.workdayEnd),
    });
    const scopedRules = rules.filter((rule) => rule.organizationId === organization.id &&
        (rule.professionalId === null ||
            rule.professionalId === request.professionalId));
    const { effective, trail } = resolvePrecedence(scopedRules, context);
    steps.push({
        label: "Regras avaliadas",
        outcome: "info",
        detail: `${trail.length} regras percorridas em ordem de precedência; ${effective.length} aplicáveis.`,
    });
    const escalate = (reason, detail) => {
        steps.push({ label: "Decisão", outcome: "blocked", detail });
        return {
            classification: classification.classification,
            confidence: classification.confidence,
            action: "ESCALATE_TO_PROFESSIONAL",
            responseText: null,
            reason,
            attention,
            escalated: true,
            appliedRules: trail,
            engineVersion: AI_ENGINE_VERSION,
            trace: { classification, steps },
        };
    };
    // --- Regras fundamentais. Nao ha configuracao que as contorne. -----------
    if (classification.classification === "POSSIBLE_RISK") {
        return escalate("Possível situação de risco. Automação interrompida e alerta crítico gerado.", "Regra fundamental: nunca ignorar possível situação de risco.");
    }
    if (!meta.autoResponseEligible) {
        return escalate(`Conteúdo classificado como ${meta.label.toLowerCase()}: decisão é do profissional.`, "Regra fundamental: somente assunto administrativo pode ser respondido automaticamente.");
    }
    if (classification.intent === "NONE") {
        return escalate("Intenção não reconhecida com confiança suficiente.", "Regra fundamental: na dúvida, escalar.");
    }
    const threshold = organization.settings.ai.autoResponseConfidenceThreshold;
    if (classification.confidence < threshold) {
        return escalate(`Confiança de ${Math.round(classification.confidence * 100)}% abaixo do limite configurado (${Math.round(threshold * 100)}%).`, "Limite de confiança da organização não atingido.");
    }
    // --- Configuracao do agente ---------------------------------------------
    if (!request.permissions.includes("conversation:reply")) {
        return escalate("Sem permissão para responder conversas.", "Permissão do responsável insuficiente.");
    }
    if (request.humanHandoff) {
        return escalate("Conversa sob responsabilidade humana.", "Automação pausada até a liberação do profissional.");
    }
    if (!organization.settings.ai.enabled) {
        return escalate("Agente desativado nas configurações da organização.", "Agente desligado.");
    }
    const { quietHoursStart, quietHoursEnd } = organization.settings.ai;
    if (quietHoursStart &&
        quietHoursEnd &&
        withinWindow(minutes, quietHoursStart, quietHoursEnd)) {
        return escalate(`Mensagem recebida dentro da janela de silêncio (${quietHoursStart}–${quietHoursEnd}).`, "Janela de silêncio ativa: o agente registra, mas não responde.");
    }
    // --- Autorizacao explicita por regra do profissional ---------------------
    const requiredCategory = INTENT_TO_CATEGORY[classification.intent];
    const restriction = effective.find((rule) => (rule.category === requiredCategory ||
        rule.category === "GENERAL" ||
        (rule.category === "AVAILABILITY" &&
            ["SCHEDULING", "RESCHEDULING"].includes(requiredCategory))) &&
        rule.actions.some((action) => ["DENY_TOPIC", "BLOCK", "ESCALATE", "REQUIRE_HUMAN_APPROVAL"].includes(action.type)));
    if (restriction) {
        return escalate(`A regra "${restriction.name}" exige atendimento humano.`, "Restrição ativa impede a resposta automática.");
    }
    const authorizing = effective.find((rule) => rule.category === requiredCategory &&
        (rule.level === "PROFESSIONAL" ||
            rule.level === "CONTEXTUAL" ||
            rule.level === "PREFERENCE") &&
        rule.actions.some((action) => action.type === "ALLOW_TOPIC" ||
            action.type === "PROVIDE_INFO" ||
            action.type === "AUTO_RESPONSE"));
    if (!authorizing) {
        return escalate(`Nenhuma regra ativa autoriza o agente a tratar "${requiredCategory.toLowerCase()}".`, "Sem autorização explícita, o agente não responde.");
    }
    const responseText = composeResponse(classification.intent, {
        profession,
        organization,
        rule: authorizing,
    });
    if (!responseText) {
        return escalate("Não há informação cadastrada para responder com segurança.", "Regra fundamental: nunca inventar informações.");
    }
    if (!organization.settings.ai.allowAutonomousReplies) {
        steps.push({
            label: "Decisão",
            outcome: "info",
            detail: "Resposta preparada, aguardando aprovação do profissional.",
        });
        return {
            classification: classification.classification,
            confidence: classification.confidence,
            action: "SUGGEST_RESPONSE",
            responseText,
            reason: `Sugestão pronta com base na regra "${authorizing.name}". Envio automático está desligado.`,
            attention,
            escalated: false,
            appliedRules: trail,
            engineVersion: AI_ENGINE_VERSION,
            trace: { classification, steps },
        };
    }
    steps.push({
        label: "Decisão",
        outcome: "ok",
        detail: `Resposta automática autorizada pela regra "${authorizing.name}" (v${authorizing.version}).`,
    });
    return {
        classification: classification.classification,
        confidence: classification.confidence,
        action: "AUTO_RESPONSE",
        responseText,
        reason: `Pergunta exclusivamente administrativa coberta pela regra "${authorizing.name}".`,
        attention,
        escalated: false,
        appliedRules: trail,
        engineVersion: AI_ENGINE_VERSION,
        trace: { classification, steps },
    };
}
