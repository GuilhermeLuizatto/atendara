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
/**
 * Quanto da mensagem avaliada a decisao do agente guarda em `inputPreview`, por
 * grau de sensibilidade da profissao. Decisao do titular em 11/09/2026:
 * profissoes de saude (`ELEVATED` e `HIGH`) nao guardam trecho nenhum. A
 * decisao continua explicada por classificacao, confianca, regras e motivo, e
 * a mensagem inteira fica na conversa, que eliminacao e retencao ja alcancam.
 */
export const DECISION_INPUT_PREVIEW_CHARS = {
    STANDARD: 200,
    ELEVATED: 0,
    HIGH: 0,
};
// ----------------------------------------------------------- valores fixos
/** Prefixo do pseudonimo. O resto e aleatorio e nao deriva do `clientId`. */
export const PSEUDONYM_PREFIX = "titular-removido-";
export const REDACTED_TEXT = "[conteúdo removido a pedido do titular dos dados]";
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
        "classifier",
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
    memberRequests: {
        personalFields: ["requestedBy", "displayName", "email", "decidedBy", "decisionReason"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    memberInvitations: {
        personalFields: ["email", "displayName", "invitedBy", "tokenHash"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    importMappings: {
        personalFields: ["createdBy", "updatedBy"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    professionals: {
        personalFields: ["displayName", "email", "phone", "licenseNumber", "specialties", "avatarUrl"],
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
            // Historico do consentimento por canal. Guarda dado de outras pessoas: o
            // uid de quem da equipe registrou e, para menor de idade, o nome do
            // responsavel legal.
            "notificationConsent",
            "notificationConsent.channels.*.granted.recordedBy.userId",
            "notificationConsent.channels.*.withdrawn.recordedBy.userId",
            "notificationConsent.channels.*.legalGuardian.fullName",
        ],
        retention: WHILE_ORGANIZATION,
        // O historico do consentimento sai junto com o cadastro. Fica a trilha de
        // cada ato (`auditLogs.metadata.consent`: canal, ato, meio e versao do
        // texto, sem nome de ninguem), pseudonimizada como o resto da trilha.
        // Guardar a prova por mais tempo depende de D23 e D24.
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
            // Endereco do atendimento a domicilio (E2.3). Diz onde a pessoa mora.
            "visitAddress",
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
                visitAddress: "NULL",
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
    // Mensalidade (cobrador, C1). Mesmo destino dos lancamentos que ela gera:
    // o financeiro fica, sem o que identifica a pessoa. Eliminar exige a
    // mensalidade encerrada antes, para nao nascer mes novo sem titular.
    recurringCharges: {
        personalFields: ["clientId", "clientName", "description"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: {
            action: "PSEUDONYMIZE",
            fields: { clientId: "CLIENT_ID", clientName: "NULL", description: "REDACTED_TEXT" },
        },
        onOrganizationDeletion: DELETE,
    },
    // Link de pagamento (C2): so ids e o token. Nada da pessoa atendida.
    paymentLinks: {
        personalFields: [],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    // Comprovante (C2). O arquivo e dado financeiro da pessoa, e nao e o que
    // prova a cobranca — o lancamento pago continua. Por isso sai inteiro no
    // pedido do titular, e o backend apaga o arquivo junto.
    paymentProofs: {
        personalFields: ["clientId", "storagePath"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: { action: "DELETE" },
        onOrganizationDeletion: DELETE,
    },
    // Recibo (C3). Documento do profissional — livro-caixa e comprovacao de
    // renda —, emitido em nome de quem pagou. Fica inteiro no pedido do titular
    // (decisao de 25/09), ate o juridico responder o prazo de guarda (pergunta
    // 16 do ADR 0004). Entra na exportacao.
    receipts: {
        personalFields: ["clientId", "payerName", "payerDocument", "beneficiaryName", "beneficiaryDocument", "description"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: {
            action: "KEEP",
            why: "Recibo emitido é documento do profissional (livro-caixa, comprovação de renda). Prazo de guarda a confirmar com o jurídico (ADR 0004, pergunta 16); segue a linha da D21: reter o necessário.",
        },
        onOrganizationDeletion: DELETE,
    },
    // Emissor da organizacao: nome e CPF de quem emite, que e da equipe.
    receiptSettings: {
        personalFields: ["issuerName", "issuerDocument", "issuerAddress"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    receiptCounters: {
        personalFields: [],
        retention: WHILE_ORGANIZATION,
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: DELETE,
    },
    aiRules: {
        personalFields: ["naturalLanguageInput", "createdBy", "updatedBy"],
        retention: WHILE_ORGANIZATION,
        onClientErasure: {
            action: "KEEP",
            why: "Regra do profissional, sem vínculo com titular. O texto livre de origem pode citar alguém e não é varrido.",
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
    // Revisao da classificacao (Fase 4). So ids e enums: o que a pessoa escreveu
    // fica na decisao, que e quem responde ao pedido do titular.
    aiDecisionReviews: {
        personalFields: ["createdBy", "updatedBy"],
        retention: { kind: "CONFIGURED_NOT_ENFORCED", setting: "auditRetentionDays" },
        onClientErasure: {
            action: "KEEP",
            why: "Guarda só o veredito e a classificação esperada, sem texto da pessoa atendida. Os ids são de quem revisou, da equipe.",
        },
        onOrganizationDeletion: DELETE,
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
    // Chave de emergencia da organizacao (13.9). Nenhum dado de pessoa: um
    // liga-desliga, o motivo escrito pela equipe e quem mexeu.
    automationSwitches: {
        personalFields: [],
        retention: { kind: "WHILE_ORGANIZATION_EXISTS" },
        onClientErasure: { action: "NOT_APPLICABLE" },
        onOrganizationDeletion: DELETE,
    },
    // Chave de emergencia GERAL. Documento da plataforma, sem dado de tenant.
    platformAutomationSwitch: {
        personalFields: [],
        retention: { kind: "WHILE_ORGANIZATION_EXISTS" },
        onClientErasure: { action: "NOT_APPLICABLE" },
        onOrganizationDeletion: { action: "NOT_APPLICABLE" },
    },
    // Conexao com a agenda externa (13.7). O que ha de pessoal e de quem ATENDE,
    // nao de quem e atendido: por isso pedido de titular de dados nao alcanca.
    // O token cifrado sai inteiro na desconexao, nao na pseudonimizacao. Apagar
    // o documento (exclusao da organizacao) dispara a limpeza no Google: a agenda
    // "Atendara" some e a credencial e revogada.
    calendarConnections: {
        personalFields: ["professionalId"],
        retention: { kind: "WHILE_ORGANIZATION_EXISTS" },
        onClientErasure: { action: "NOT_APPLICABLE" },
        onOrganizationDeletion: DELETE,
    },
    // Ocupado lido da agenda externa: so faixas de tempo. Nao identifica ninguem
    // — nem quem atende, alem do proprio id, nem quem e atendido.
    calendarBusyBlocks: {
        personalFields: ["professionalId"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: { action: "NOT_APPLICABLE" },
        onOrganizationDeletion: DELETE,
    },
    // Pedido de remarcacao em andamento (13.6). Guarda horarios e ids; o texto
    // da conversa fica em `messages`, e o pedido morre quando a escolha vence.
    rescheduleRequests: {
        personalFields: ["clientId"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: { action: "PSEUDONYMIZE", fields: { clientId: "CLIENT_ID" } },
        onOrganizationDeletion: DELETE,
    },
    // Catalogo de servicos (E2.1). Nome, preco e duracao do TRABALHO da
    // organizacao — nenhum dado de quem e atendido passa por aqui.
    services: {
        personalFields: [],
        retention: { kind: "WHILE_ORGANIZATION_EXISTS" },
        onClientErasure: { action: "NOT_APPLICABLE" },
        onOrganizationDeletion: DELETE,
    },
    // Remetente comprovado de cada canal (13.4). O que ha de pessoal aqui e
    // contato da PROPRIA equipe — numeros de testadores —, nunca de quem e
    // atendido; por isso pedido de titular de dados nao alcanca esta colecao.
    messagingSenders: {
        personalFields: ["testRecipients"],
        retention: { kind: "WHILE_ORGANIZATION_EXISTS" },
        onClientErasure: { action: "NOT_APPLICABLE" },
        onOrganizationDeletion: DELETE,
    },
    whatsappConnections: {
        personalFields: ["displayNumber", "displayName"],
        retention: { kind: "WHILE_ORGANIZATION_EXISTS" },
        onClientErasure: { action: "NOT_APPLICABLE" },
        onOrganizationDeletion: DELETE,
    },
    automationTasks: {
        // Ids e estado da execucao. Texto, contato e nome nunca sao gravados: o
        // despachante recompoe os dois primeiros no envio e os descarta.
        personalFields: ["clientId"],
        // `expiresAt` e a validade da execucao, nao prazo de retencao: nenhuma
        // politica de TTL pode ser ligada nele. Retencao pendente, como a da fila de
        // avisos.
        retention: { kind: "UNDEFINED" },
        onClientErasure: {
            action: "PSEUDONYMIZE",
            fields: { clientId: "CLIENT_ID" },
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
            why: "Registro da cobrança da plataforma; prazo fiscal a confirmar. O link leva à página do gateway, que mostra nome e e-mail do assinante.",
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
            why: "Trava de idempotência do webhook. Guarda ids, tipo e resultado — nunca payload.",
        },
    },
    platformCustomers: {
        personalFields: ["subscriberUserId"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Liga evento tardio do gateway à organização excluída, para que seja recusado e não aplicado à outra.",
        },
    },
    platformAccessGrants: {
        personalFields: ["subscriberUserId", "reason", "grantedBy", "revokedBy", "revokeReason"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Ato registrado da operadora. O motivo é texto livre e deve ser escrito sem dado pessoal.",
        },
    },
    platformProfessionRequests: {
        personalFields: ["requestedBy", "reason", "decidedBy", "decisionReason"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Ato registrado da operadora sobre a organização, não sobre quem ela atende. A justificativa é texto livre e deve ser escrita sem dado pessoal.",
        },
    },
    platformAuditLogs: {
        personalFields: ["actorId", "targetUserId", "reason", "details"],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "KEEP",
            why: "Trilha append-only dos atos de plataforma, inclusive da própria exclusão. Guarda ids, nunca nome ou e-mail.",
        },
    },
    platformSupportTickets: {
        personalFields: [
            "openedBy",
            "openedByName",
            "openedByEmail",
            "subject",
            "messages.authorId",
            "messages.authorName",
            "messages.body",
            "messages.attachments",
        ],
        retention: { kind: "UNDEFINED" },
        onClientErasure: NOT_APPLICABLE,
        onOrganizationDeletion: {
            action: "PSEUDONYMIZE",
            fields: {
                openedByName: "REDACTED_NAME",
                openedByEmail: "MASKED_CONTACT",
                subject: "REDACTED_TEXT",
            },
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
