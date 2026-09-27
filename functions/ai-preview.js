import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { ACCOUNT_CALL_OPTIONS, accountOf, parse } from "./platform-auth.js";
import { runAs } from "./service-accounts.js";
import { consumeRateLimit } from "./rate-limit.js";
import { paths, messagePath } from "./generated/paths.js";
import { ROLE_PERMISSIONS } from "./generated/permissions.js";
import { getProfession, isProfessionId } from "./generated/professions.js";
import { withOrganizationDefaults } from "./generated/organization-config.js";
import { materializeSeededRules } from "./generated/system-rules-config.js";
import { decide } from "./generated/decision-engine.js";
import { GEMINI_POLICY } from "./generated/ai-provider-config.js";
import { fromStored } from "./firestore-dates.js";
import { classifyWithGemini } from "./gemini.js";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const schema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("SIMULATOR"),
      text: z.string().trim().min(1).max(GEMINI_POLICY.maxInputCharacters),
      channel: z.enum(["WEB_CHAT", "WHATSAPP", "EMAIL", "SMS", "INSTAGRAM"]),
      professionalId: id.nullable(),
      at: z.iso.datetime().nullable(),
      humanHandoff: z.boolean(),
      client: z
        .object({
          modality: z
            .enum(["IN_PERSON", "ONLINE", "HOME_VISIT", "HYBRID"])
            .nullable(),
          status: z
            .enum(["LEAD", "ACTIVE", "INACTIVE", "ON_HOLD", "DISCHARGED"])
            .nullable(),
          hasOutstandingBalance: z.boolean().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ mode: z.literal("MESSAGE"), conversationId: id, messageId: id })
    .strict(),
]);

function stored(collection, snapshot) {
  return snapshot.exists
    ? fromStored(collection, snapshot.id, snapshot.data())
    : null;
}

export const previewAI = onCall(
  {
    ...ACCOUNT_CALL_OPTIONS,
    ...runAs("automacao"),
    secrets: ["GEMINI_API_KEY"],
    timeoutSeconds: 30,
    concurrency: 10,
  },
  async (request) => {
    const account = await accountOf(request);
    const input = parse(schema, request.data);
    const requiredModule = input.mode === "MESSAGE" ? "mensagens" : "agente";
    if (
      account.platformRole !== "PROFESSIONAL" ||
      account.mustChangePassword ||
      !account.organizationId ||
      account.subscriptionStatus !== "ACTIVE" ||
      !(account.accessUntilMs > Date.now()) ||
      !account.modules?.includes(requiredModule)
    ) {
      throw new HttpsError(
        "permission-denied",
        "Acesso ao agente não autorizado.",
      );
    }
    const db = getFirestore();
    const organizationId = account.organizationId;
    const [orgSnapshot, memberSnapshot] = await Promise.all([
      db.doc(paths.organization(organizationId)).get(),
      db.doc(paths.document(organizationId, "members", request.auth.uid)).get(),
    ]);
    const rawOrganization = stored("organizations", orgSnapshot);
    const member = memberSnapshot.data();
    const permissions = ROLE_PERMISSIONS[member?.role] ?? [];
    if (
      !rawOrganization ||
      rawOrganization.deletion ||
      member?.status !== "ACTIVE" ||
      rawOrganization.primaryProfession !== account.professionId ||
      !isProfessionId(account.professionId) ||
      !permissions.includes("conversation:reply")
    ) {
      throw new HttpsError(
        "permission-denied",
        "Sem permissão para avaliar mensagens nesta organização.",
      );
    }
    await consumeRateLimit(request.auth.uid, "aiPreview");
    const now = new Date();
    const profession = getProfession(account.professionId);
    const organization = withOrganizationDefaults(
      rawOrganization,
      organizationId,
      profession.id,
      now.toISOString(),
    );
    const seeds = materializeSeededRules(
      organizationId,
      profession,
      now.toISOString(),
    );
    const seedIds = new Set(seeds.map((rule) => rule.id));
    const rulesSnapshot = await db
      .collection(paths.collection(organizationId, "aiRules"))
      .get();
    const rules = [
      ...seeds,
      ...rulesSnapshot.docs
        .map((doc) => stored("aiRules", doc))
        .filter((rule) => !seedIds.has(rule.id)),
    ];
    let context;
    if (input.mode === "SIMULATOR") {
      context = {
        text: input.text,
        channel: input.channel,
        client: input.client,
        professionalId: input.professionalId ?? request.auth.uid,
        humanHandoff: input.humanHandoff,
        now: input.at ? new Date(input.at) : now,
      };
      if (input.professionalId) {
        const professional = (
          await db
            .doc(
              paths.document(
                organizationId,
                "professionals",
                input.professionalId,
              ),
            )
            .get()
        ).data();
        if (!professional || professional.active !== true)
          throw new HttpsError(
            "invalid-argument",
            "Profissional indisponível.",
          );
      }
    } else {
      const conversation = stored(
        "conversations",
        await db
          .doc(
            paths.document(
              organizationId,
              "conversations",
              input.conversationId,
            ),
          )
          .get(),
      );
      // A entrada do WhatsApp existente grava mensagens na coleção do tenant.
      const nested = await db
        .doc(messagePath(organizationId, input.conversationId, input.messageId))
        .get();
      const message = stored(
        "messages",
        nested.exists
          ? nested
          : await db
              .doc(paths.document(organizationId, "messages", input.messageId))
              .get(),
      );
      if (
        !conversation ||
        !message ||
        conversation.organizationId !== organizationId ||
        message.organizationId !== organizationId ||
        message.conversationId !== input.conversationId ||
        message.direction !== "INBOUND" ||
        typeof message.body !== "string" ||
        !message.body.trim() ||
        message.body.length > GEMINI_POLICY.maxInputCharacters
      ) {
        throw new HttpsError(
          "not-found",
          "Mensagem indisponível para avaliação.",
        );
      }
      const client = conversation.clientId
        ? stored(
            "clients",
            await db
              .doc(
                paths.document(
                  organizationId,
                  "clients",
                  conversation.clientId,
                ),
              )
              .get(),
          )
        : null;
      context = {
        text: message.body,
        channel: conversation.channel,
        professionalId: conversation.professionalId ?? null,
        humanHandoff: conversation.escalated === true,
        now,
        // Saldo depende dos lançamentos; não inferimos ausência de dívida do cadastro.
        client: client
          ? {
              modality: client.preferredModality ?? null,
              status: client.status ?? null,
              hasOutstandingBalance: null,
            }
          : null,
      };
    }
    const evaluated = await classifyWithGemini({
      text: context.text,
      profession,
      organizationId,
      enabled: organization.settings.ai.enabled && !context.humanHandoff,
    });
    const result = decide({
      ...context,
      profession,
      organization,
      rules,
      permissions,
      semanticClassification: evaluated.classification,
    });
    result.classifier = evaluated.metadata;
    result.trace.steps.push({
      label: "Interpretação",
      outcome: "info",
      detail: providerLabel(evaluated.metadata),
    });
    return { decision: result, classifier: evaluated.metadata };
  },
);

export function providerLabel(metadata) {
  if (metadata.status === "SUCCEEDED")
    return `Gemini (${metadata.model}). Confiança é estimativa do modelo, não acurácia medida.`;
  if (metadata.status === "LOCAL_GUARD")
    return "As regras locais exigiram revisão humana; o texto não foi enviado ao Gemini.";
  if (metadata.status === "LIMITED")
    return "Limite interno do Atendara para o Gemini atingido. Revisão humana necessária.";
  if (metadata.status === "UNAVAILABLE")
    return `Gemini sem resultado: ${failureLabel(metadata.failureReason)}. Revisão humana necessária.`;
  return "Avaliação por regras locais. Gemini não está ativo para esta avaliação.";
}

/**
 * Motivo legível para quem testa a Dara. Só etapa e código HTTP chegam até
 * aqui (`geminiFailureReason`), então nada do provedor é repetido na tela.
 */
export function failureLabel(reason) {
  const http = /^HTTP_(\d{3})$/.exec(reason ?? "");
  if (http) {
    const status = Number(http[1]);
    // 401/403 não provam chave errada: API desligada, restrição da chave ou
    // permissão do projeto dão o mesmo código, e o corpo que diria qual é descartado.
    if (status === 401 || status === 403)
      return `acesso negado pelo Google: credencial ou configuração do projeto (HTTP ${status})`;
    if (status === 404) return "modelo não encontrado (HTTP 404)";
    if (status === 429)
      return "o Google limitou as chamadas: cota, limite por minuto ou faturamento (HTTP 429)";
    if (status >= 500) return `erro no Google (HTTP ${status})`;
    return `o Google recusou o pedido (HTTP ${status})`;
  }
  if (reason?.startsWith("FINISH_"))
    return `resposta interrompida pelo Google (${reason.slice(7)})`;
  const labels = {
    CONFIG: "configuração incompleta no servidor",
    QUOTA_STORE: "falha ao reservar a cota de uso",
    TIMEOUT: "o Google não respondeu a tempo",
    NETWORK: "sem conexão com o Google",
    BLOCKED: "mensagem bloqueada pelo filtro do Google",
    OVERSIZED: "resposta grande demais",
    FORMAT: "resposta em formato inválido",
    INVALID_JSON: "resposta em formato inválido",
    INVALID_CLASSIFICATION: "classificação fora do formato esperado",
  };
  return labels[reason] ?? "erro inesperado";
}
