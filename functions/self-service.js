import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { paths } from "./generated/paths.js";
import { PROFESSION_IDS } from "./generated/profession.js";
import { getProfession } from "./generated/professions.js";
import { defaultOrganizationKind } from "./generated/organization-config.js";
import { resolveAccountGate } from "./generated/access-gate.js";
import { LEGAL_VERSION } from "./generated/legal-config.js";
import {
  SELF_SERVICE_ACTOR,
  SELF_SERVICE_PASSWORD_LENGTH,
  TRIAL_GRANT_REASON,
} from "./generated/platform-config.js";
import {
  COUNCIL_REGISTRATION_LENGTH,
  councilRegistrationError,
  selfServiceModules,
  trialUntil,
} from "./generated/self-service.js";
import { ACCOUNT_CALL_OPTIONS, parse } from "./platform-auth.js";
import { assertGrantWindow, auditEntry, gateFields, grantDocument } from "./platform.js";
import { consumeRateLimit, networkSubject } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";

/**
 * Cadastro aberto e inicio do teste de 14 dias.
 *
 * Sao DUAS callables porque sao dois momentos: a pessoa se cadastra, e o teste
 * so comeca quando ela confirma o e-mail (decisao do titular em 16/09/2026).
 * Entre um e outro a conta existe, aparece na administracao e nao abre nada —
 * `subscriptionStatus` fica `PENDING` e `accessUntil` fica nulo.
 *
 * A concessao de teste respeita a regra 10 do AGENTS.md: e concessao
 * REGISTRADA, do tipo `TRIAL`, gravada em `platformAccessGrants/{orgId}` com
 * entrada append-only na mesma transacao. O que muda em relacao as manuais e o
 * autor — nao ha humano, e o registro diz isso com todas as letras.
 */

const db = () => getFirestore();

/**
 * `enforceAppCheck` vale mesmo sem login: e o que separa o navegador de alguem
 * com a chave publica do projeto e um laco. Sem conta ainda, e a unica prova de
 * que a chamada saiu do aplicativo.
 */
const SIGNUP_CALL_OPTIONS = { ...ACCOUNT_CALL_OPTIONS, maxInstances: 4, ...runAs("contas") };
const TRIAL_CALL_OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("contas") };

/** Comecar o teste nao recebe dado nenhum: a organizacao sai da conta de quem chama. */
const noInput = z.object({}).strict();

const signupSchema = z
  .object({
    displayName: z.string().trim().min(3).max(100),
    email: z.email().trim().toLowerCase(),
    password: z
      .string()
      .min(SELF_SERVICE_PASSWORD_LENGTH.min)
      .max(SELF_SERVICE_PASSWORD_LENGTH.max)
      .optional(),
    professionId: z.enum(PROFESSION_IDS),
    councilRegistration: z.string().trim().max(COUNCIL_REGISTRATION_LENGTH.max).optional(),
    businessName: z.string().trim().min(2).max(120),
    acceptedLegalVersion: z.string().min(1).max(64),
  })
  .strict();

/**
 * Resposta unica do caminho por senha, tenha a conta sido criada ou nao.
 *
 * Decisao 11: a tela nunca revela se um e-mail ja tem conta. Uma mensagem
 * diferente para e-mail repetido transformaria o cadastro num consultor de
 * "quem usa o Atendara", que e exatamente o que a protecao contra enumeracao
 * do Identity Platform existe para impedir.
 */
const GENERIC_RESULT = { ok: true };

/** A conta do Google chega com e-mail ja confirmado; e o que o token prova. */
function googleIdentity(request) {
  const token = request.auth.token;
  if (token.email_verified !== true || !token.email) {
    throw new HttpsError("failed-precondition", "Entre de novo com sua conta Google.");
  }
  return { uid: request.auth.uid, email: String(token.email).toLowerCase() };
}

function trialGrant({ organizationId, subscriberUserId, nowMs }) {
  const until = trialUntil(nowMs);
  // Prova, a cada execucao, que o teste cabe na janela maxima de uma concessao.
  // Se alguem aumentar TRIAL_DAYS acima de MAX_ACCESS_GRANT_DAYS, falha aqui em
  // vez de abrir acesso mais longo do que a politica admite.
  assertGrantWindow(until, nowMs);
  return grantDocument({
    organizationId,
    subscriberUserId,
    input: { kind: "TRIAL", until, reason: TRIAL_GRANT_REASON },
    actorId: SELF_SERVICE_ACTOR,
    stamp: new Date(nowMs).toISOString(),
  });
}

export const registerSelfService = onCall(SIGNUP_CALL_OPTIONS, async (request) => {
  await consumeRateLimit(networkSubject(request), "selfServiceSignupByNetwork");
  if (request.auth) await consumeRateLimit(request.auth.uid, "selfServiceSignupByAccount");

  const input = parse(signupSchema, request.data);
  if (input.acceptedLegalVersion !== LEGAL_VERSION) {
    throw new HttpsError(
      "failed-precondition",
      "Os Termos e a Política foram atualizados. Recarregue a página e leia antes de continuar.",
    );
  }
  const profession = getProfession(input.professionId);
  // Profissao fora da vitrine nao entra por cadastro aberto. A lista da tela e
  // conveniencia; esta e a trava.
  if (!profession.listed) {
    throw new HttpsError("invalid-argument", "Escolha uma das profissões oferecidas.");
  }
  const councilError = councilRegistrationError(input.professionId, input.councilRegistration);
  if (councilError) throw new HttpsError("invalid-argument", councilError);

  const google = request.auth ? googleIdentity(request) : null;
  if (google && google.email !== input.email) {
    throw new HttpsError("invalid-argument", "Use o mesmo e-mail da sua conta Google.");
  }

  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
  let createdUserId = null;
  let userId;

  if (google) {
    const existing = (await db().doc(paths.account(google.uid)).get()).data();
    if (existing) throw new HttpsError("failed-precondition", "Esta conta já está cadastrada.");
    userId = google.uid;
  } else {
    if (!input.password) throw new HttpsError("invalid-argument", "Escolha uma senha para entrar.");
    try {
      const user = await getAuth().createUser({
        email: input.email,
        displayName: input.displayName,
        password: input.password,
      });
      userId = user.uid;
      createdUserId = user.uid;
    } catch (error) {
      if (error.code === "auth/email-already-exists") return GENERIC_RESULT;
      throw new HttpsError("internal", "Não foi possível concluir o cadastro.");
    }
  }

  const organizationId = randomUUID();
  // Quem entra pelo Google ja chegou com o e-mail confirmado: o teste comeca
  // agora. No caminho por senha a concessao espera a confirmacao (decisao 10).
  const grant = google ? trialGrant({ organizationId, subscriberUserId: userId, nowMs }) : null;
  const gate = resolveAccountGate({ subscription: null, grant, nowMs });
  const stamp = { createdAt, updatedAt: createdAt, createdBy: userId, updatedBy: userId };

  const account = {
    userId,
    email: input.email,
    displayName: input.displayName,
    professionId: input.professionId,
    modules: selfServiceModules(),
    organizationId,
    platformRole: "PROFESSIONAL",
    status: "ACTIVE",
    ...gateFields(gate),
    // Senha escolhida pela propria pessoa: nao ha senha inicial a trocar.
    mustChangePassword: false,
    origin: "SELF_SERVICE",
    // A rotina diaria procura por este campo. Ausente, o documento nao apareceria
    // na consulta e o teste nunca seria dado por encerrado.
    blockedSince: null,
    // Idem: a mesma consulta exclui quem ja assinou, e `== null` nao encontra
    // documento sem o campo.
    subscribedAt: null,
    legal: { version: LEGAL_VERSION, acceptedAt: createdAt },
    createdAt,
  };

  const batch = db().batch();
  batch.create(db().doc(paths.account(userId)), account);
  batch.create(db().doc(paths.organization(organizationId)), {
    id: organizationId,
    name: input.businessName,
    slug: organizationId,
    kind: defaultOrganizationKind(input.professionId),
    primaryProfession: input.professionId,
    professions: [input.professionId],
    ownerId: userId,
    ...stamp,
  });
  batch.create(db().doc(paths.document(organizationId, "members", userId)), {
    id: userId,
    userId,
    organizationId,
    role: "PROFESSIONAL",
    status: "ACTIVE",
    invitedBy: SELF_SERVICE_ACTOR,
    ...stamp,
  });
  // Sem perfil profissional a agenda nasce sem quem atenda, e o cliente nao pode
  // cria-lo: as regras exigem papel administrativo.
  batch.create(db().doc(paths.document(organizationId, "professionals", userId)), {
    id: userId,
    organizationId,
    userId,
    displayName: input.displayName,
    email: input.email,
    phone: null,
    profession: input.professionId,
    licenseNumber: input.councilRegistration ?? null,
    specialties: [],
    avatarUrl: null,
    active: true,
    ...stamp,
  });

  const registered = auditEntry({
    action: "SELF_SERVICE_REGISTERED",
    actorId: SELF_SERVICE_ACTOR,
    organizationId,
    targetUserId: userId,
    details: {
      professionId: input.professionId,
      signInMethod: google ? "GOOGLE" : "PASSWORD",
      legalVersion: LEGAL_VERSION,
    },
    createdAt,
  });
  batch.create(registered.ref, registered.data);

  if (grant) {
    batch.create(db().doc(paths.platformAccessGrant(organizationId)), grant);
    const started = auditEntry({
      action: "TRIAL_STARTED",
      actorId: SELF_SERVICE_ACTOR,
      organizationId,
      targetUserId: userId,
      reason: grant.reason,
      details: { kind: grant.kind, until: grant.until, resultingAccessUntil: gate.accessUntil },
      createdAt,
    });
    batch.create(started.ref, started.data);
  }

  try {
    await batch.commit();
  } catch {
    // So desfazemos o que criamos: a conta do Google e da pessoa, e existia
    // antes desta chamada.
    if (createdUserId) await getAuth().deleteUser(createdUserId);
    throw new HttpsError("internal", "Não foi possível concluir o cadastro.");
  }
  return GENERIC_RESULT;
});

/**
 * Comeca o teste depois que o e-mail foi confirmado.
 *
 * Idempotente por construcao: a concessao e um documento unico por organizacao
 * (`platformAccessGrants/{orgId}`). Chamar de novo — por recarregar a pagina ou
 * por insistencia — devolve o que ja existe e nao emenda mais catorze dias.
 */
export const activateTrial = onCall(TRIAL_CALL_OPTIONS, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Entre na sua conta.");
  if (!noInput.safeParse(request.data ?? {}).success) throw new HttpsError("invalid-argument", "Confira os dados informados.");
  await consumeRateLimit(request.auth.uid, "selfServiceTrialActivation");
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Confirme seu e-mail para começar o teste.");
  }

  const userId = request.auth.uid;
  const accountRef = db().doc(paths.account(userId));
  const nowMs = Date.now();

  return await db().runTransaction(async (transaction) => {
    const account = (await transaction.get(accountRef)).data();
    if (!account || account.status !== "ACTIVE" || account.platformRole !== "PROFESSIONAL") {
      throw new HttpsError("permission-denied", "Cadastro não liberado.");
    }
    if (account.origin !== "SELF_SERVICE" || !account.organizationId) {
      throw new HttpsError("failed-precondition", "Este cadastro não tem teste a começar.");
    }

    const organizationId = account.organizationId;
    const grantRef = db().doc(paths.platformAccessGrant(organizationId));
    const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
    const existing = (await transaction.get(grantRef)).data() ?? null;
    const subscription = (await transaction.get(subscriptionRef)).data() ?? null;
    // Uma concessao por organizacao: um segundo pedido nao emenda outro teste.
    if (existing) return { ok: true, accessUntil: account.accessUntil ?? null };

    const grant = trialGrant({ organizationId, subscriberUserId: userId, nowMs });
    const gate = resolveAccountGate({
      subscription: subscription
        ? { status: subscription.status, accessUntil: subscription.accessUntil ?? null }
        : null,
      grant,
      nowMs,
    });
    const entry = auditEntry({
      action: "TRIAL_STARTED",
      actorId: SELF_SERVICE_ACTOR,
      organizationId,
      targetUserId: userId,
      reason: grant.reason,
      details: { kind: grant.kind, until: grant.until, resultingAccessUntil: gate.accessUntil },
      createdAt: grant.grantedAt,
    });

    transaction.create(grantRef, grant);
    transaction.update(accountRef, gateFields(gate));
    transaction.create(entry.ref, entry.data);
    return { ok: true, accessUntil: gate.accessUntil };
  });
});
