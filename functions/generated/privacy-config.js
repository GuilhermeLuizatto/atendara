// Gerado por scripts/build-functions.mjs.
import { PROVISIONAL_RETENTION_DAYS } from "./platform-config.js";
/**
 * Mapa de dados pessoais, como DADO.
 *
 * Para cada colecao: que campos descrevem uma pessoa, por quanto tempo ficam, e
 * o que o backend faz com o documento quando um titular pede a eliminacao ou
 * quando a organizacao e excluida. `functions/privacy.js` executa este mapa e
 * nao decide destino de colecao nenhuma por conta propria.
 *
 * `privacy.test.ts` exige uma entrada para TODA colecao de `paths.ts`: uma
 * colecao nova nao entra no produto sem decisao de privacidade.
 *
 * Nenhum prazo nem destino daqui foi aprovado por revisao juridica. Por isso
 * `LEGAL_REVIEW_STATUS` e um valor, e nao so uma ressalva: aprovar muda o
 * contrato, e a mudanca aparece no diff.
 *
 * Compartilhado com o backend por `scripts/build-functions.mjs`.
 */
export const LEGAL_REVIEW_STATUS = "PENDING_LEGAL_REVIEW";
// ----------------------------------------------------------- valores fixos
/** Prefixo do pseudonimo. O resto e aleatorio e nao deriva do `clientId`. */
export const PSEUDONYM_PREFIX = "titular-removido-";
export const REDACTED_TEXT = "[conteudo removido a pedido do titular dos dados]";
export const REDACTED_NAME = "Pessoa removida";
export const MASKED_CONTACT = "***";
/**
 * Papeis que atendem pedido de titular. O titular da organizacao (`ownerId`)
 * atende mesmo com outro papel — o autonomo nasce PROFESSIONAL e e o dono.
 * Espelhado em `ROLE_PERMISSIONS` (`privacy:*`) e em `privacyResponsible()`.
 */
export const PRIVACY_RESPONSIBLE_ROLES = ["OWNER", "ADMIN"];
/** Excluir a organizacao exige login recente, como trocar a senha inicial. */
export const RECENT_LOGIN_SECONDS = 300;
/** Paginas de uma exportacao so valem dentro desta janela a partir do inicio. */
export const ORGANIZATION_EXPORT_WINDOW_MINUTES = 60;
export const ORGANIZATION_EXPORT_PAGE_SIZE = { default: 200, max: 300 };
/**
 * Prazos PROVISORIOS, gravados como `expiresAt` e sem TTL ligado — o mesmo
 * tratamento que a Etapa 5B deu a `platformGatewayEvents`. 730 dias acompanha
 * o `auditRetentionDays` padrao da organizacao.
 */
export const PROVISIONAL_PRIVACY_RETENTION_DAYS = {
    privacyRequests: 730,
    deletedOrganizationTrail: 730,
};
/**
 * Campos que a pseudonimizacao nunca toca nas trilhas append-only. Sao o que
 * torna uma decisao ou uma entrada de auditoria interpretavel depois: tirar
 * qualquer um deles seria apagar a trilha por outro nome.
 */
export const APPEND_ONLY_PROTECTED_FIELDS = {
    aiDecisions: [
        "organizationId",
        "conversationId",
        "messageId",
        "professionalId",
        "classification",
        "confidence",
        "appliedRules",
        "action",
        "reason",
        "attention",
        "escalated",
        "engineVersion",
        "decidedAt",
        "evaluatedAt",
        "latencyMs",
        "createdAt",
        "createdBy",
    ],
    auditLogs: [
        "organizationId",
        "actorType",
        "actorId",
        "action",
        "resource.type",
        "metadata",
        "occurredAt",
        "createdAt",
        "createdBy",
    ],
};
// ----------------------------------------------------------------- o mapa
const DECISION_CONTENT = {
    clientId: "CLIENT_ID",
    inputPreview: "REDACTED_TEXT",
    responseText: "REDACTED_TEXT",
};
const REQUEST_SUBJECT = { subjectId: "CLIENT_ID" };
const WHILE_ORGANIZATION = { kind: "WHILE_ORGANIZATION_EXISTS" };
const NOT_APPLICABLE = { action: "NOT_APPLICABLE" };
const DELETE = { action: "DELETE" };
export const PERSONAL_DATA_MAP = {
    // -------------------------------------------------------------- raiz
    organizations: {
        // O cadastro usa o nome do profissional como nome da organizacao.
        personalFields: ["name", "ownerId", "address"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: { action: "TOMBSTONE" },
    },
    userMemberships: {
        personalFields: ["userId"],
        retention: { kind: "WHILE_ACCOUNT_EXISTS" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    accounts: {
        personalFields: ["email", "displayName"],
        retention: { kind: "WHILE_ACCOUNT_EXISTS" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    initialPasswords: {
        personalFields: ["salt", "hash"],
        retention: { kind: "UNTIL_INITIAL_PASSWORD_CHANGE" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    // ------------------------------------------------------------ tenant
    members: {
        personalFields: ["userId", "invitedBy"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    professionals: {
        personalFields: ["displayName", "email", "phone", "licenseNumber", "avatarUrl"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    clients: {
        personalFields: [
            "fullName",
            "preferredName",
            "email",
            "phone",
            "administrativeNotes",
            "tags",
            "notificationConsent",
        ],
        retention: WHILE_ORGANIZATION,
        onClientErasure: DELETE,
        onOrganizationDeletion: DELETE,
    },
    appointments: {
        personalFields: [
            "clientId",
            "clientName",
            "professionalName",
            "administrativeNotes",
            "cancellationReason",
            "externalCalendar",
        ],
        retention: WHILE_ORGANIZATION,
        // Horario, valor e profissional ficam: sao a agenda e o financeiro da
        // organizacao. Quem foi atendido deixa de constar.
        onClientErasure: {
            action: "PSEUDONYMIZE",
            fields: {
                clientId: "CLIENT_ID",
                clientName: "REDACTED_NAME",
                administrativeNotes: "NULL",
                cancellationReason: "NULL",
                externalCalendar: "NULL",
            },
        },
        onOrganizationDeletion: DELETE,
    },
    conversations: {
        personalFields: ["clientId", "clientName", "lastMessagePreview", "escalationReason"],
        retention: { kind: "CONFIGURED_NOT_ENFORCED", setting: "messageRetentionDays" },
        onClientErasure: DELETE,
        onOrganizationDeletion: DELETE,
    },
    messages: {
        personalFields: ["clientId", "authorName", "body"],
        retention: { kind: "CONFIGURED_NOT_ENFORCED", setting: "messageRetentionDays" },
        onClientErasure: DELETE,
        onOrganizationDeletion: DELETE,
    },
    transactions: {
        personalFields: ["clientId", "clientName", "description"],
        retention: WHILE_ORGANIZATION,
        // Valor, vencimento e baixa ficam; a descricao e texto livre e costuma
        // levar o nome.
        onClientErasure: {
            action: "PSEUDONYMIZE",
            fields: { clientId: "CLIENT_ID", clientName: "NULL", description: "REDACTED_TEXT" },
        },
        onOrganizationDeletion: DELETE,
    },
    aiRules: {
        personalFields: ["naturalLanguageInput", "createdBy", "updatedBy"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: {
            action: "KEEP",
            why: "Regra do profissional, sem vinculo com titular. O texto livre de origem pode citar alguem e nao e varrido.",
        },
        onOrganizationDeletion: DELETE,
    },
    aiDecisions: {
        personalFields: ["clientId", "inputPreview", "responseText"],
        retention: { kind: "CONFIGURED_NOT_ENFORCED", setting: "auditRetentionDays" },
        // Append-only: a decisao continua existindo, sem o que a pessoa escreveu.
        onClientErasure: { action: "PSEUDONYMIZE", fields: DECISION_CONTENT },
        onOrganizationDeletion: { action: "PSEUDONYMIZE", fields: DECISION_CONTENT },
    },
    notifications: {
        personalFields: ["title", "body"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: {
            action: "PSEUDONYMIZE",
            fields: { title: "REDACTED_TEXT", body: "REDACTED_TEXT" },
        },
        onOrganizationDeletion: DELETE,
    },
    notificationDeliveries: {
        personalFields: ["clientId", "contactHint"],
        // TTL pendente desde a Etapa 5B.
        retention: { kind: "UNDEFINED" },
        onClientErasure: {
            action: "PSEUDONYMIZE",
            fields: { clientId: "CLIENT_ID", contactHint: "MASKED_CONTACT" },
        },
        onOrganizationDeletion: DELETE,
    },
    auditLogs: {
        personalFields: ["actorName", "summary", "resource.id"],
        retention: { kind: "CONFIGURED_NOT_ENFORCED", setting: "auditRetentionDays" },
        // O resumo e montado com o nome do cliente ("Cadastro de ... criado").
        // O nome de quem agiu e da equipe e fica enquanto a organizacao existe.
        onClientErasure: {
            action: "PSEUDONYMIZE",
            fields: { summary: "REDACTED_TEXT", "resource.id": "CLIENT_RESOURCE_ID" },
        },
        onOrganizationDeletion: {
            action: "PSEUDONYMIZE",
            fields: {
                summary: "REDACTED_TEXT",
                actorName: "REDACTED_NAME",
                "resource.id": "CLIENT_RESOURCE_ID",
            },
        },
    },
    privacyRequests: {
        personalFields: ["subjectId", "requestedBy"],
        retention: {
            kind: "PROVISIONAL_DAYS",
            days: PROVISIONAL_PRIVACY_RETENTION_DAYS.privacyRequests,
            ttlEnabled: false,
        },
        onClientErasure: { action: "PSEUDONYMIZE", fields: REQUEST_SUBJECT },
        onOrganizationDeletion: { action: "PSEUDONYMIZE", fields: REQUEST_SUBJECT },
    },
    // -------------------------------------------------------- plataforma
    platformPlans: {
        personalFields: [],
        retention: { kind: "NO_PERSONAL_DATA" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: NOT_APPLICABLE,
    },
    platformSubscriptions: {
        personalFields: ["subscriberUserId", "subscriberEmail"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "PSEUDONYMIZE",
            fields: { subscriberEmail: "NULL" },
        },
    },
    platformInvoices: {
        personalFields: ["hostedInvoiceUrl"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Registro da cobranca da plataforma; prazo fiscal a confirmar. O link leva a pagina do gateway, que mostra nome e e-mail do assinante.",
        },
    },
    platformGatewayEvents: {
        personalFields: [],
        retention: {
            kind: "PROVISIONAL_DAYS",
            days: PROVISIONAL_RETENTION_DAYS.platformGatewayEvents,
            ttlEnabled: false,
        },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Trava de idempotencia do webhook. Guarda ids, tipo e resultado — nunca payload.",
        },
    },
    platformCustomers: {
        personalFields: ["subscriberUserId"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Liga evento tardio do gateway a organizacao excluida, para que seja recusado e nao aplicado a outra.",
        },
    },
    platformAccessGrants: {
        personalFields: ["subscriberUserId", "reason", "grantedBy", "revokedBy", "revokeReason"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Ato registrado da operadora. O motivo e texto livre e deve ser escrito sem dado pessoal.",
        },
    },
    platformAuditLogs: {
        personalFields: ["actorId", "targetUserId", "reason", "details"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Trilha append-only dos atos de plataforma, inclusive da propria exclusao. Guarda ids, nunca nome ou e-mail.",
        },
    },
    platformRateLimits: {
        personalFields: ["userId"],
        retention: { kind: "RATE_LIMIT_WINDOW", ttlEnabled: true },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Janela de minutos, apagada por TTL.",
        },
    },
};
