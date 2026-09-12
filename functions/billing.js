import { getFirestore } from "firebase-admin/firestore";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { paths } from "./generated/paths.js";
import { findPlan } from "./generated/billing-config.js";
import {
  computeAccessUntil,
  fromUnixSeconds,
  isFullRefund,
  isOutOfOrder,
  toPlatformStatus,
} from "./generated/billing-policy.js";
import { resolveAccountGate } from "./generated/access-gate.js";
import { PROVISIONAL_RETENTION_DAYS } from "./generated/platform-config.js";
import { GatewayError, stripeRequest, verifyWebhookSignature } from "./gateway.js";
import { consumeRateLimit } from "./rate-limit.js";

/**
 * Cobranca DA PLATAFORMA: a mensalidade que a Three Devs cobra dos assinantes.
 *
 * Tres garantias que este arquivo existe para sustentar:
 *
 * 1. **O navegador nunca ativa uma assinatura.** As callables criam sessao de
 *    checkout e de portal, e so. Quem escreve `subscriptionStatus`,
 *    `accessUntil` e as colecoes `platform*` e o webhook, depois de conferir a
 *    assinatura criptografica do evento. Voltar da tela de pagamento nao muda
 *    documento nenhum.
 * 2. **Ninguem escolhe a organizacao que recebe o beneficio.** O
 *    `organizationId` sai de `accounts/{uid}` no servidor, nunca do payload; e
 *    o webhook ainda reconfere o vinculo antes de associar.
 * 3. **Evento repetido ou fora de ordem nao muda nada.** O documento em
 *    `platformGatewayEvents/{eventId}` e criado na MESMA transacao do efeito;
 *    a segunda entrega aborta. Evento com carimbo anterior ao ultimo aplicado
 *    e registrado e descartado.
 *
 * Nada aqui toca `organizations/{orgId}/transactions`. O financeiro do
 * assinante e outra contabilidade, com outro dono.
 */

const REGION = "southamerica-east1";
const SECRETS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];
// App Check obrigatorio: sem atestado do aplicativo nao se abre sessao no
// gateway. O webhook fica fora — quem o chama e o gateway, e ele prova a origem
// pela assinatura do evento.
const callOptions = { region: REGION, maxInstances: 3, cors: true, secrets: SECRETS, enforceAppCheck: true };
const webhookOptions = { region: REGION, maxInstances: 5, secrets: SECRETS };

// `getFirestore()` preguicoso: os modulos sao avaliados antes de
// `initializeApp()` do index.js, entao chamar no topo quebraria o carregamento.
const db = () => getFirestore();

function now() {
  return new Date().toISOString();
}

/**
 * Para onde o gateway devolve o assinante. Fora do emulador, falha fechada:
 * sem a variavel, ou sem `https:`, o assinante pagaria e voltaria para um
 * endereco que nao e o aplicativo. Conferida antes de qualquer chamada ao
 * gateway, para nao abrir sessao que ja nasce com retorno errado.
 */
function appBaseUrl() {
  const emulator = process.env.FUNCTIONS_EMULATOR === "true";
  const configured = process.env.APP_BASE_URL?.trim();
  if (!configured) {
    if (emulator) return "http://127.0.0.1:3000";
    throw new HttpsError("failed-precondition", "O endereço de retorno da cobrança (APP_BASE_URL) não está configurado neste ambiente.");
  }
  if (!emulator && !configured.startsWith("https://")) {
    throw new HttpsError("failed-precondition", "O endereço de retorno da cobrança (APP_BASE_URL) precisa usar https.");
  }
  return configured.replace(/\/$/, "");
}

/** `planId -> price` do gateway. So o servidor conhece: o cliente pede plano. */
function gatewayPriceFor(planId) {
  try {
    const map = JSON.parse(process.env.STRIPE_PRICE_MAP ?? "{}");
    const price = map[planId];
    return typeof price === "string" && price.length > 0 ? price : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- autorizacao

async function callerAccount(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Entre na sua conta.");
  const snapshot = await db().doc(paths.account(request.auth.uid)).get();
  const account = snapshot.data();
  if (!account || account.status !== "ACTIVE" || account.mustChangePassword) {
    throw new HttpsError("permission-denied", "Cadastro não liberado.");
  }
  return account;
}

/**
 * Quem responde pela assinatura: o dono da organizacao.
 *
 * O `organizationId` vem de `accounts/{uid}`, lido no servidor. Nao existe
 * parametro de organizacao em nenhuma callable deste arquivo — e assim que
 * "escolher outra organizacao para receber o beneficio" deixa de ser uma
 * possibilidade em vez de ser uma validacao que alguem pode esquecer.
 */
async function subscriptionOwner(request) {
  const account = await callerAccount(request);
  const organizationId = account.organizationId;
  if (!organizationId) {
    throw new HttpsError("failed-precondition", "Esta conta não tem organização para assinar.");
  }

  const organization = (await db().doc(paths.organization(organizationId)).get()).data();
  if (!organization) throw new HttpsError("failed-precondition", "Organização não encontrada.");

  const member = (
    await db().doc(paths.document(organizationId, "members", request.auth.uid)).get()
  ).data();
  // Papel OWNER so conta com o vinculo ativo: quem foi suspenso da organizacao
  // nao pode seguir trocando cartao ou cancelando a assinatura dela.
  const owns =
    organization.ownerId === request.auth.uid ||
    (member?.role === "OWNER" && member?.status === "ACTIVE");
  if (!owns) {
    throw new HttpsError("permission-denied", "Somente o responsável pela organização gerencia a assinatura.");
  }

  return { account, organizationId, organization };
}

function gatewayFailure(error) {
  if (error instanceof GatewayError) {
    logger.error("Gateway recusou a chamada.", { status: error.status, message: error.message });
    return new HttpsError(
      error.status === 503 ? "failed-precondition" : "internal",
      error.status === 503 ? error.message : "Não foi possível falar com o gateway agora.",
    );
  }
  logger.error("Falha inesperada na cobrança.", { message: String(error) });
  return new HttpsError("internal", "Não foi possível concluir a operação.");
}

// ------------------------------------------------------------------ callables

const checkoutInput = z.object({ planId: z.string().trim().min(1).max(80) }).strict();

/**
 * Abre o checkout HOSPEDADO do gateway.
 *
 * Hospedado de proposito: dado de cartao nunca passa por este codigo nem pelo
 * nosso dominio. O que devolvemos e uma URL; o que volta e um evento assinado.
 */
export const createSubscriptionCheckout = onCall(callOptions, async (request) => {
  const { account, organizationId, organization } = await subscriptionOwner(request);
  // O webhook so aceita vinculo do `ownerId` (`handleCheckoutCompleted`). Abrir
  // checkout para outro membro cobraria um cartao cujo vinculo seria recusado
  // depois: dinheiro capturado sem acesso liberado.
  if (organization.ownerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Somente o titular da organização contrata a assinatura.");
  }
  const baseUrl = appBaseUrl();
  await consumeRateLimit(request.auth.uid, "createSubscriptionCheckout");
  const parsed = checkoutInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Escolha um plano válido.");

  const plan = findPlan(parsed.data.planId);
  if (!plan || !plan.active) throw new HttpsError("invalid-argument", "Plano indisponível.");

  const price = gatewayPriceFor(plan.id);
  if (!price) {
    throw new HttpsError("failed-precondition", "O catálogo de preços do gateway não está configurado neste ambiente.");
  }

  const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
  const current = (await subscriptionRef.get()).data();
  if (current && (current.status === "ACTIVE" || current.status === "TRIALING")) {
    throw new HttpsError("failed-precondition", "Esta organização já tem uma assinatura vigente.");
  }
  // Inadimplente ainda e assinatura viva: o gateway segue retentando o cartao.
  // Uma segunda cobraria duas vezes, e os eventos da antiga continuariam mexendo
  // no acesso da nova. Regulariza-se pelo portal.
  if (current?.status === "PAST_DUE") {
    throw new HttpsError("failed-precondition", "Há uma cobrança pendente. Atualize o pagamento em Gerenciar pagamento.");
  }

  try {
    let customerId = current?.gateway?.customerId ?? null;
    if (!customerId) {
      const customer = await stripeRequest(
        "customers",
        {
          email: account.email,
          name: account.displayName,
          metadata: { organizationId, subscriberUserId: account.userId },
        },
        // Um cliente por organizacao, mesmo que a chamada seja repetida.
        { idempotencyKey: `customer:${organizationId}` },
      );
      customerId = customer.id;
    }

    const session = await stripeRequest(
      "checkout/sessions",
      {
        mode: "subscription",
        customer: customerId,
        // O gateway devolve isto no evento; e a primeira das duas pontas do
        // vinculo, e o webhook confere a outra contra `accounts/{uid}`.
        client_reference_id: organizationId,
        line_items: [{ price, quantity: 1 }],
        locale: "pt-BR",
        success_url: `${baseUrl}/assinatura/?retorno=concluído`,
        cancel_url: `${baseUrl}/assinatura/?retorno=cancelado`,
        metadata: { organizationId, subscriberUserId: account.userId, planId: plan.id },
        subscription_data: {
          metadata: { organizationId, subscriberUserId: account.userId, planId: plan.id },
          ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
        },
      },
      { idempotencyKey: `checkout:${organizationId}:${plan.id}:${randomUUID()}` },
    );

    return { url: session.url };
  } catch (error) {
    throw gatewayFailure(error);
  }
});

/**
 * Portal do assinante hospedado pelo gateway: trocar cartao, ver recibos.
 *
 * A sessao e criada para UM cliente e nao alcanca nenhum outro — o isolamento
 * dessa tela e garantia do fornecedor, nao codigo nosso.
 */
export const openBillingPortal = onCall(callOptions, async (request) => {
  const { organizationId } = await subscriptionOwner(request);
  const baseUrl = appBaseUrl();
  await consumeRateLimit(request.auth.uid, "openBillingPortal");
  const subscription = (await db().doc(paths.platformSubscription(organizationId)).get()).data();
  const customerId = subscription?.gateway?.customerId;
  if (!customerId) throw new HttpsError("failed-precondition", "Esta organização ainda não tem assinatura.");

  try {
    const session = await stripeRequest("billing_portal/sessions", {
      customer: customerId,
      return_url: `${baseUrl}/assinatura/`,
    });
    return { url: session.url };
  } catch (error) {
    throw gatewayFailure(error);
  }
});

/**
 * Cancela ao fim do ciclo. Note o que esta funcao NAO faz: escrever o estado
 * local. Ela pede o cancelamento ao gateway e para; o `accessUntil` muda quando
 * o evento assinado chegar. Antecipar aqui criaria um segundo caminho de
 * escrita, e dois caminhos divergem.
 */
export const cancelPlatformSubscription = onCall(callOptions, async (request) => {
  const { organizationId } = await subscriptionOwner(request);
  await consumeRateLimit(request.auth.uid, "cancelPlatformSubscription");
  const subscription = (await db().doc(paths.platformSubscription(organizationId)).get()).data();
  const subscriptionId = subscription?.gateway?.subscriptionId;
  if (!subscriptionId) throw new HttpsError("failed-precondition", "Não há assinatura para cancelar.");

  try {
    await stripeRequest(`subscriptions/${encodeURIComponent(subscriptionId)}`, {
      cancel_at_period_end: true,
    });
    return { ok: true };
  } catch (error) {
    throw gatewayFailure(error);
  }
});

// -------------------------------------------------------------------- webhook

/** Onde o evento guarda a organizacao, nas varias formas que a API usa. */
function organizationFromEvent(object) {
  return (
    object?.metadata?.organizationId ??
    object?.subscription_details?.metadata?.organizationId ??
    object?.parent?.subscription_details?.metadata?.organizationId ??
    object?.lines?.data?.[0]?.metadata?.organizationId ??
    null
  );
}

function customerIdOf(object) {
  const customer = object?.customer;
  if (typeof customer === "string") return customer;
  return customer?.id ?? null;
}

/**
 * Assinatura de uma fatura. A versao fixada da API (`2026-04-22.dahlia`, que
 * herda a `2025-03-31.basil`) removeu `invoice.subscription` e o levou para
 * `invoice.parent.subscription_details.subscription`; o campo antigo fica como
 * alternativa para eventos de versoes anteriores.
 */
function invoiceSubscriptionId(invoice) {
  const value = invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription;
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

/** O mais recente de dois instantes ISO. Carimbo aplicado nunca volta no tempo. */
function latestInstant(current, incoming) {
  if (!current) return incoming;
  return Date.parse(incoming) > Date.parse(current) ? incoming : current;
}

/** Estados em que a assinatura registrada ainda vale ou ainda pode se recuperar. */
const LIVE_SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE"];

/**
 * O evento fala de OUTRA assinatura do gateway enquanto a registrada segue
 * viva — um checkout duplicado, ou uma assinatura criada a mao no painel.
 * Aplicar deixaria o cancelamento de uma derrubar o acesso pago pela outra.
 */
function supersededBy(registered, subscriptionId) {
  const current = registered?.gateway?.subscriptionId;
  return Boolean(
    current &&
      subscriptionId &&
      current !== subscriptionId &&
      LIVE_SUBSCRIPTION_STATUSES.includes(registered.status),
  );
}

/**
 * Resolve a organizacao pelo indice `platformCustomers`, quando o evento nao
 * traz a metadata. Le dentro da transacao para nao misturar snapshots.
 */
async function resolveOrganization(transaction, object) {
  const fromMetadata = organizationFromEvent(object);
  if (fromMetadata) return fromMetadata;

  const customerId = customerIdOf(object);
  if (!customerId) return null;
  const mapping = await transaction.get(db().doc(paths.platformCustomer(customerId)));
  return mapping.exists ? (mapping.data().organizationId ?? null) : null;
}

function subscriptionPeriod(subscription) {
  const item = subscription?.items?.data?.[0];
  return {
    start: fromUnixSeconds(subscription?.current_period_start ?? item?.current_period_start),
    end: fromUnixSeconds(subscription?.current_period_end ?? item?.current_period_end),
  };
}

function invoicePeriodEnd(invoice) {
  const line = invoice?.lines?.data?.[0];
  return fromUnixSeconds(line?.period?.end ?? invoice?.period_end);
}

/**
 * Localiza a conta que recebe o portao de acesso e a concessao vigente da
 * organizacao.
 *
 * Separado de `applyAccountGate` porque uma transacao do Firestore recusa
 * leitura depois de escrita: todo `get` precisa acontecer antes do primeiro
 * `set`. Devolve `null` — e nao lanca — quando a conta nao pode ser tocada:
 * conta inexistente, conta administrativa, ou conta de outra organizacao.
 *
 * A concessao e lida NA MESMA transacao: sem isso, uma concessao gravada entre
 * a leitura e a escrita seria sobrescrita por um portao calculado sem ela.
 */
async function readAccountGate(transaction, subscriberUserId, organizationId) {
  if (!subscriberUserId) return null;

  const accountRef = db().doc(paths.account(subscriberUserId));
  const account = (await transaction.get(accountRef)).data();
  if (!account) return null;
  if (account.platformRole !== "PROFESSIONAL") return null;
  if (account.organizationId !== organizationId) return null;
  const grant = (await transaction.get(db().doc(paths.platformAccessGrant(organizationId)))).data() ?? null;
  return { accountRef, grant };
}

/**
 * Reflete a assinatura em `accounts/{uid}` — o portao que as Security Rules
 * leem. Um dos dois caminhos que escrevem `subscriptionStatus` e `accessUntil`;
 * o outro e a concessao registrada da operadora (`platform.js`). O portao usa a
 * maior validade entre os dois, entao um evento nunca fecha uma concessao
 * vigente, e uma concessao nunca encurta ciclo pago.
 */
function applyAccountGate(transaction, target, subscription, planId) {
  if (!target) return;

  const gate = resolveAccountGate({
    subscription: { status: subscription.status, accessUntil: subscription.accessUntil ?? null },
    grant: target.grant,
    nowMs: Date.now(),
  });
  const changes = {
    subscriptionStatus: gate.subscriptionStatus,
    accessUntil: gate.accessUntil,
    accessUntilMs: gate.accessUntil ? Date.parse(gate.accessUntil) : 0,
  };

  // Os modulos do plano so entram enquanto a assinatura da direito a eles.
  const plan = planId ? findPlan(planId) : null;
  if (plan && (subscription.status === "ACTIVE" || subscription.status === "TRIALING")) {
    changes.modules = plan.modules;
  }

  transaction.update(target.accountRef, changes);
}

const SKIP = (reason, organizationId = null) => ({ outcome: "IGNORED", reason, organizationId });
const REJECT = (reason, organizationId = null) => ({ outcome: "REJECTED", reason, organizationId });

/**
 * `checkout.session.completed` estabelece o VINCULO — e so ele.
 *
 * Deliberadamente nao concede acesso: sessao concluida nao e pagamento
 * confirmado. Quem libera e `invoice.paid` / `customer.subscription.*`.
 */
async function handleCheckoutCompleted(transaction, event) {
  const session = event.data.object;
  if (session.mode !== "subscription") return SKIP("Checkout que não é de assinatura.");

  const organizationId = session.client_reference_id ?? organizationFromEvent(session);
  const subscriberUserId = session.metadata?.subscriberUserId ?? null;
  const planId = session.metadata?.planId ?? null;
  const customerId = customerIdOf(session);
  if (!organizationId || !subscriberUserId || !customerId) {
    return SKIP("Sessão sem vínculo declarado.", organizationId);
  }

  const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
  const customerRef = db().doc(paths.platformCustomer(customerId));
  const [account, organization, existing, mapping] = await Promise.all([
    transaction.get(db().doc(paths.account(subscriberUserId))),
    transaction.get(db().doc(paths.organization(organizationId))),
    transaction.get(subscriptionRef),
    transaction.get(customerRef),
  ]);

  // As duas pontas do vinculo, conferidas contra o nosso proprio banco. Nada
  // do que veio no evento e aceito como prova de quem manda em qual tenant.
  if (!account.exists || account.data().organizationId !== organizationId) {
    return REJECT("Assinante não pertence à organização declarada.", organizationId);
  }
  if (!organization.exists || organization.data().ownerId !== subscriberUserId) {
    return REJECT("Assinante não é o responsável pela organização.", organizationId);
  }
  if (mapping.exists && mapping.data().organizationId !== organizationId) {
    return REJECT("Cliente do gateway já pertence à outra organização.", organizationId);
  }
  const currentCustomer = existing.data()?.gateway?.customerId;
  if (currentCustomer && currentCustomer !== customerId) {
    return REJECT("Organização já associada a outro cliente do gateway.", organizationId);
  }

  const stamp = now();
  const gatewayCreatedAt = fromUnixSeconds(event.created) ?? stamp;

  transaction.set(customerRef, { customerId, organizationId, subscriberUserId, linkedAt: stamp });
  transaction.set(
    subscriptionRef,
    {
      organizationId,
      subscriberUserId,
      subscriberEmail: account.data().email ?? null,
      planId: planId ?? existing.data()?.planId ?? null,
      // Sem evento de pagamento confirmado, a assinatura nasce incompleta —
      // e `computeAccessUntil` devolve `null` para esse estado.
      status: existing.data()?.status ?? "INCOMPLETE",
      accessUntil: existing.data()?.accessUntil ?? null,
      cancelAtPeriodEnd: existing.data()?.cancelAtPeriodEnd ?? false,
      canceledAt: existing.data()?.canceledAt ?? null,
      currentPeriodStart: existing.data()?.currentPeriodStart ?? null,
      currentPeriodEnd: existing.data()?.currentPeriodEnd ?? null,
      amountInCents: existing.data()?.amountInCents ?? findPlan(planId)?.priceInCents ?? 0,
      currency: existing.data()?.currency ?? findPlan(planId)?.currency ?? "BRL",
      interval: existing.data()?.interval ?? findPlan(planId)?.interval ?? "MONTH",
      gateway: {
        provider: "STRIPE",
        customerId,
        subscriptionId:
          (typeof session.subscription === "string" ? session.subscription : session.subscription?.id) ??
          existing.data()?.gateway?.subscriptionId ??
          null,
      },
      createdAt: existing.data()?.createdAt ?? stamp,
      updatedAt: stamp,
      // O vinculo nao e estado de ciclo: nao mexe em `lastEventAt`, para nao
      // fazer o proximo evento de assinatura parecer atrasado.
      lastEventAt: existing.data()?.lastEventAt ?? null,
      lastEventId: existing.data()?.lastEventId ?? null,
      linkedAt: gatewayCreatedAt,
    },
    { merge: true },
  );

  return { outcome: "APPLIED", reason: null, organizationId };
}

/** Criacao, renovacao de ciclo, falha e cancelamento da assinatura. */
async function handleSubscriptionEvent(transaction, event) {
  const object = event.data.object;
  const organizationId = await resolveOrganization(transaction, object);
  if (!organizationId) return SKIP("Evento sem organização associada.");

  const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
  const existing = (await transaction.get(subscriptionRef)).data() ?? null;
  const gatewayCreatedAt = fromUnixSeconds(event.created) ?? now();

  if (isOutOfOrder(existing?.lastEventAt ?? null, gatewayCreatedAt)) {
    return { outcome: "OUT_OF_ORDER", reason: "Evento anterior ao último aplicado.", organizationId };
  }
  if (supersededBy(existing, object.id)) {
    return REJECT("Evento de outra assinatura, diferente da vigente nesta organização.", organizationId);
  }

  const subscriberUserId = object.metadata?.subscriberUserId ?? existing?.subscriberUserId ?? null;
  if (!subscriberUserId) return SKIP("Assinatura sem assinante conhecido.", organizationId);
  if (existing?.subscriberUserId && existing.subscriberUserId !== subscriberUserId) {
    return REJECT("Assinante divergente do vínculo registrado.", organizationId);
  }
  // Sem vinculo anterior, este evento seria o primeiro a apontar a organizacao
  // para alguem — e `customer.subscription.created` costuma chegar ANTES do
  // checkout concluido. A mesma conferencia do vinculo vale aqui.
  if (!existing?.subscriberUserId) {
    const organization = (await transaction.get(db().doc(paths.organization(organizationId)))).data();
    if (organization?.ownerId !== subscriberUserId) {
      return REJECT("Assinante não é o responsável pela organização.", organizationId);
    }
  }

  const accountRef = await readAccountGate(transaction, subscriberUserId, organizationId);

  const deleted = event.type === "customer.subscription.deleted";
  const status = toPlatformStatus(deleted ? "canceled" : object.status);
  const period = subscriptionPeriod(object);
  const planId = object.metadata?.planId ?? existing?.planId ?? null;
  const plan = planId ? findPlan(planId) : null;
  const currentPeriodEnd = period.end ?? existing?.currentPeriodEnd ?? null;
  const accessUntil = computeAccessUntil({ status, currentPeriodEnd });
  const gatewayInterval = object.items?.data?.[0]?.price?.recurring?.interval;

  const next = {
    organizationId,
    subscriberUserId,
    subscriberEmail: existing?.subscriberEmail ?? null,
    planId,
    status,
    amountInCents: object.items?.data?.[0]?.price?.unit_amount ?? plan?.priceInCents ?? existing?.amountInCents ?? 0,
    currency: (object.currency ?? plan?.currency ?? existing?.currency ?? "BRL").toUpperCase(),
    interval:
      gatewayInterval === "year"
        ? "YEAR"
        : gatewayInterval === "month"
          ? "MONTH"
          : (plan?.interval ?? existing?.interval ?? "MONTH"),
    currentPeriodStart: period.start ?? existing?.currentPeriodStart ?? null,
    currentPeriodEnd,
    accessUntil,
    cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
    canceledAt: fromUnixSeconds(object.canceled_at) ?? (deleted ? gatewayCreatedAt : null),
    gateway: {
      provider: "STRIPE",
      customerId: customerIdOf(object) ?? existing?.gateway?.customerId ?? null,
      subscriptionId: object.id ?? existing?.gateway?.subscriptionId ?? null,
    },
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    lastEventAt: gatewayCreatedAt,
    lastEventId: event.id,
  };

  applyAccountGate(transaction, accountRef, next, planId);
  transaction.set(subscriptionRef, next, { merge: true });
  return { outcome: "APPLIED", reason: null, organizationId };
}

const INVOICE_STATUS_BY_EVENT = {
  "invoice.paid": "PAID",
  "invoice.payment_succeeded": "PAID",
  "invoice.payment_failed": "PAST_DUE",
  "invoice.marked_uncollectible": "UNCOLLECTIBLE",
  "invoice.voided": "VOID",
};

/**
 * Faturas. `invoice.paid` tambem estende o acesso: e o que faz a RENOVACAO
 * funcionar mesmo se o evento de assinatura demorar ou nao vier.
 */
async function handleInvoiceEvent(transaction, event) {
  const invoice = event.data.object;
  const invoiceId = invoice.id;
  if (!invoiceId) return SKIP("Fatura sem identificador.");

  const organizationId = await resolveOrganization(transaction, invoice);
  if (!organizationId) return SKIP("Fatura sem organização associada.");

  const invoiceRef = db().doc(paths.platformInvoice(invoiceId));
  const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
  const [invoiceSnapshot, subscriptionSnapshot] = await Promise.all([
    transaction.get(invoiceRef),
    transaction.get(subscriptionRef),
  ]);
  const stored = invoiceSnapshot.data() ?? null;
  const subscription = subscriptionSnapshot.data() ?? null;
  const gatewayCreatedAt = fromUnixSeconds(event.created) ?? now();

  if (isOutOfOrder(stored?.lastEventAt ?? null, gatewayCreatedAt)) {
    return { outcome: "OUT_OF_ORDER", reason: "Fatura já refletiu um evento mais recente.", organizationId };
  }
  if (stored && stored.organizationId !== organizationId) {
    return REJECT("Fatura pertence à outra organização.", organizationId);
  }

  const status = INVOICE_STATUS_BY_EVENT[event.type] ?? stored?.status ?? "OPEN";
  const amountPaid = invoice.amount_paid ?? (status === "PAID" ? (invoice.amount_due ?? 0) : 0);
  const periodEnd = invoicePeriodEnd(invoice);
  const planId = invoice.lines?.data?.[0]?.metadata?.planId ?? subscription?.planId ?? null;

  // Toda leitura antes de qualquer escrita: e exigencia da transacao.
  const accountRef = await readAccountGate(
    transaction,
    subscription?.subscriberUserId ?? null,
    organizationId,
  );

  transaction.set(
    invoiceRef,
    {
      id: invoiceId,
      organizationId,
      subscriptionId: invoiceSubscriptionId(invoice) ?? subscription?.gateway?.subscriptionId ?? null,
      planId: planId ?? subscription?.planId ?? null,
      status,
      amountDueInCents: invoice.amount_due ?? stored?.amountDueInCents ?? 0,
      amountPaidInCents: amountPaid,
      amountRefundedInCents: stored?.amountRefundedInCents ?? 0,
      currency: (invoice.currency ?? subscription?.currency ?? "BRL").toUpperCase(),
      periodStart: fromUnixSeconds(invoice.lines?.data?.[0]?.period?.start ?? invoice.period_start),
      periodEnd,
      issuedAt: stored?.issuedAt ?? fromUnixSeconds(invoice.created) ?? gatewayCreatedAt,
      paidAt: status === "PAID" ? (fromUnixSeconds(invoice.status_transitions?.paid_at) ?? gatewayCreatedAt) : (stored?.paidAt ?? null),
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? stored?.hostedInvoiceUrl ?? null,
      gatewayInvoiceId: invoiceId,
      lastEventAt: gatewayCreatedAt,
      lastEventId: event.id,
    },
    { merge: true },
  );

  // Pagamento confirmado estende o ciclo. E o unico caminho pelo qual o acesso
  // cresce: nem a tela, nem o retorno do checkout, nem o cadastro manual.
  //
  // A fatura tem a propria ordem (`stored.lastEventAt`); a assinatura tem outra.
  // Um `invoice.paid` reentregue depois de um estado mais novo da assinatura
  // nao pode reabrir acesso nem fazer o carimbo dela voltar no tempo. Cancelada
  // nao renasce por fatura, e fatura de outra assinatura nao estende a vigente.
  const extendsSubscription =
    status === "PAID" &&
    subscription &&
    periodEnd &&
    subscription.status !== "CANCELED" &&
    !isOutOfOrder(subscription.lastEventAt ?? null, gatewayCreatedAt) &&
    !supersededBy(subscription, invoiceSubscriptionId(invoice));
  if (extendsSubscription) {
    const longer = !subscription.currentPeriodEnd || Date.parse(periodEnd) > Date.parse(subscription.currentPeriodEnd);
    if (longer) {
      const nextStatus = subscription.status === "TRIALING" ? "TRIALING" : "ACTIVE";
      const next = {
        ...subscription,
        status: nextStatus,
        currentPeriodEnd: periodEnd,
        accessUntil: computeAccessUntil({ status: nextStatus, currentPeriodEnd: periodEnd }),
        updatedAt: now(),
        lastEventAt: gatewayCreatedAt,
        lastEventId: event.id,
      };
      applyAccountGate(transaction, accountRef, next, next.planId ?? planId);
      transaction.set(subscriptionRef, next, { merge: true });
    }
  }

  return { outcome: "APPLIED", reason: null, organizationId };
}

/**
 * Reembolso. Integral do ciclo corrente fecha o acesso no instante do
 * reembolso — o periodo deixou de estar pago. Parcial fica registrado e nao
 * mexe no acesso.
 */
async function handleRefundEvent(transaction, event) {
  const charge = event.data.object;
  const invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id;
  if (!invoiceId) return SKIP("Reembolso sem fatura associada.");

  const invoiceRef = db().doc(paths.platformInvoice(invoiceId));
  const invoiceSnapshot = await transaction.get(invoiceRef);
  if (!invoiceSnapshot.exists) return SKIP("Reembolso de fatura desconhecida.");
  const stored = invoiceSnapshot.data();
  const organizationId = stored.organizationId;

  const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
  const subscription = (await transaction.get(subscriptionRef)).data() ?? null;
  const gatewayCreatedAt = fromUnixSeconds(event.created) ?? now();

  if (isOutOfOrder(stored.lastEventAt ?? null, gatewayCreatedAt)) {
    return { outcome: "OUT_OF_ORDER", reason: "Fatura já refletiu um evento mais recente.", organizationId };
  }

  const refunded = charge.amount_refunded ?? 0;
  const full = isFullRefund(stored.amountPaidInCents ?? 0, refunded);
  const accountRef = await readAccountGate(
    transaction,
    subscription?.subscriberUserId ?? null,
    organizationId,
  );

  transaction.set(
    invoiceRef,
    {
      amountRefundedInCents: refunded,
      status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
      lastEventAt: gatewayCreatedAt,
      lastEventId: event.id,
    },
    { merge: true },
  );

  const coversCurrentPeriod =
    subscription && stored.periodEnd && subscription.currentPeriodEnd === stored.periodEnd;

  if (full && coversCurrentPeriod) {
    const next = {
      ...subscription,
      // A assinatura pode seguir viva no gateway; quem a encerra e o evento de
      // cancelamento. Aqui so o acesso para, porque o dinheiro voltou.
      // Cancelada continua cancelada: o reembolso fecha o acesso, nao reabre a
      // possibilidade de a assinatura se recuperar.
      status: subscription.status === "CANCELED" ? "CANCELED" : "PAST_DUE",
      accessUntil: gatewayCreatedAt,
      updatedAt: now(),
      // Fecha mesmo chegando atrasado — o dinheiro voltou —, mas sem fazer o
      // carimbo da assinatura voltar no tempo.
      lastEventAt: latestInstant(subscription.lastEventAt, gatewayCreatedAt),
      lastEventId: event.id,
    };
    applyAccountGate(transaction, accountRef, next, next.planId);
    transaction.set(subscriptionRef, next, { merge: true });
  }

  return { outcome: "APPLIED", reason: null, organizationId };
}

const HANDLERS = {
  "checkout.session.completed": handleCheckoutCompleted,
  "customer.subscription.created": handleSubscriptionEvent,
  "customer.subscription.updated": handleSubscriptionEvent,
  "customer.subscription.deleted": handleSubscriptionEvent,
  "invoice.paid": handleInvoiceEvent,
  "invoice.payment_succeeded": handleInvoiceEvent,
  "invoice.payment_failed": handleInvoiceEvent,
  "invoice.marked_uncollectible": handleInvoiceEvent,
  "invoice.voided": handleInvoiceEvent,
  "charge.refunded": handleRefundEvent,
};

/**
 * Aplica um evento exatamente uma vez.
 *
 * O `create` do documento do evento e a trava: se o webhook for reentregue, a
 * transacao inteira aborta e nenhum efeito acontece duas vezes. Por isso ele e
 * criado JUNTO do efeito, e nao antes nem depois.
 */
export async function applyGatewayEvent(event) {
  const eventRef = db().doc(paths.platformGatewayEvent(event.id));

  return db().runTransaction(async (transaction) => {
    const already = await transaction.get(eventRef);
    if (already.exists) {
      return { outcome: "DUPLICATE", reason: "Evento já processado.", organizationId: already.data().organizationId ?? null };
    }

    const handler = HANDLERS[event.type];
    const result = handler
      ? await handler(transaction, event)
      : SKIP("Tipo de evento sem efeito sobre acesso ou cobrança.");

    transaction.create(eventRef, {
      id: event.id,
      type: event.type,
      organizationId: result.organizationId ?? null,
      outcome: result.outcome,
      reason: result.reason ?? null,
      gatewayCreatedAt: fromUnixSeconds(event.created) ?? now(),
      receivedAt: now(),
      // Para a politica de TTL, que so sera ligada com prazo aprovado. Muito
      // alem da janela de reenvio: apagar cedo reabriria a idempotencia.
      expiresAt: new Date(Date.now() + PROVISIONAL_RETENTION_DAYS.platformGatewayEvents * 86_400_000),
    });

    return result;
  });
}

/**
 * Endpoint do webhook.
 *
 * Precisa ser `onRequest`: com `output: "export"` no Next nao existe rota de
 * servidor, e a verificacao da assinatura exige o corpo BRUTO — que so uma
 * function HTTP entrega.
 */
export const stripeWebhook = onRequest(webhookOptions, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).send("Método não suportado.");
    return;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("Webhook sem segredo configurado.");
    response.status(503).send("Cobrança não configurada.");
    return;
  }

  const event = verifyWebhookSignature(request.rawBody, request.get("stripe-signature"), secret);
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    // Sem detalhe na resposta: quem nao assina corretamente nao merece pista.
    logger.warn("Webhook recusado por assinatura inválida.");
    response.status(400).send("Assinatura inválida.");
    return;
  }

  try {
    const result = await applyGatewayEvent(event);
    logger.info("Evento do gateway processado.", {
      eventId: event.id,
      type: event.type,
      outcome: result.outcome,
    });
    response.status(200).json({ outcome: result.outcome });
  } catch (error) {
    // 500 faz o gateway retentar; a idempotencia garante que retentar e seguro.
    logger.error("Falha ao aplicar evento do gateway.", { eventId: event.id, message: String(error) });
    response.status(500).send("Falha ao processar o evento.");
  }
});
