import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { messagePath, messagesPath, paths } from "../functions/generated/paths.js";

// As ferramentas do emulador ficam fora do bundle e das dependencias do aplicativo.
const requireTools = createRequire(new URL("../.local/firebase-tools/package.json", import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = requireTools("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, collectionGroup, query, where, limit } = requireTools("firebase/firestore");
const environment = await initializeTestEnvironment({ projectId: "demo-atendara", firestore: { host: "127.0.0.1", port: 8085, rules: readFileSync("firestore.rules", "utf8") } });
const account = (org, patch = {}) => ({ platformRole: "PROFESSIONAL", organizationId: org, professionId: "PSYCHOLOGIST", modules: ["clientes", "agenda", "financeiro", "agente", "mensagens"], status: "ACTIVE", mustChangePassword: false, subscriptionStatus: "ACTIVE", accessUntilMs: Date.now() + 86400000, ...patch });

// Tokens de teste com e sem segundo fator. O emulador aceita token nao
// assinado; producao nao. O claim e o mesmo que o Identity Platform grava.
const TOTP = { firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } };
const PHONE = { firebase: { sign_in_provider: "password", sign_in_second_factor: "phone" } };

// Consentimento por canal (Fase 3, 13.1), com datas em ISO como o aplicativo grava.
const consentAct = (userId, extra = {}) => ({ at: "2026-09-12T10:00:00.000Z", recordedBy: { kind: "STAFF", userId }, medium: "FORM", ...extra });
const consentRecord = (userId, extra = {}) => ({ granted: consentAct(userId), textVersion: "2026-09-11-rascunho", subjectIsMinor: false, legalGuardian: null, withdrawn: null, ...extra });
const recordConsent = (channels, legacy = null) => ({ formatVersion: 2, channels, legacy });
const LEGACY_CONSENT = { channels: ["EMAIL"], grantedAt: "2026-09-01T10:00:00.000Z", revokedAt: null, source: "CLIENT_FORM", textVersion: "2026-09-10-rascunho" };
const SEEDED_EMAIL = consentRecord("a");
const SEEDED_SMS = consentRecord("a", { withdrawn: consentAct("a", { medium: "MESSAGE" }) });

let checks = 0;
async function allowed(operation) {
  try { await assertSucceeds(operation); } catch (error) { throw new Error(`verificacao ${checks + 1} deveria passar: ${error.message}`); }
  checks++;
}
async function denied(operation) { await assertFails(operation); checks++; }
async function deniedBecause(reason, operation) {
  try { await denied(operation); } catch (error) { throw new Error(`${reason}: ${error.message}`); }
}
try {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const profiles = {
      // A operadora carrega campos de assinatura validos de proposito: prova
      // que nao e a validade que a mantem fora dos tenants.
      admin: account(null, { platformRole: "PLATFORM_ADMIN" }),
      a: account("org-a"), b: account("org-b"),
      initial: account("org-a", { mustChangePassword: true }),
      suspended: account("org-a", { status: "SUSPENDED" }),
      expired: account("org-a", { accessUntilMs: 0 }),
      restricted: account("org-a", { modules: ["clientes"] }),
      wrongProfession: account("org-a", { professionId: "DENTIST" }),
      // Dono de organizacao com a mensalidade vencida: o painel fecha, mas a
      // propria cobranca precisa continuar alcancavel para ele regularizar.
      ownerExpired: account("org-c", { accessUntilMs: 0 }),
    };
    for (const [uid, profile] of Object.entries(profiles)) {
      await setDoc(doc(db, paths.account(uid)), profile);
      if (profile.organizationId) await setDoc(doc(db, paths.document(profile.organizationId, "members", uid)), { role: "PROFESSIONAL", status: "ACTIVE" });
    }
    // Membros promovidos a OWNER ou ADMIN sem serem o titular (`ownerId`). O
    // papel so alcanca a cobranca com o vinculo ativo.
    for (const [uid, role, status] of [["ownerRole", "OWNER", "ACTIVE"], ["ownerRoleSuspended", "OWNER", "SUSPENDED"], ["adminRole", "ADMIN", "ACTIVE"], ["assistantRole", "ASSISTANT", "ACTIVE"], ["viewerRole", "VIEWER", "ACTIVE"]]) {
      await setDoc(doc(db, paths.account(uid)), account("org-a"));
      await setDoc(doc(db, paths.document("org-a", "members", uid)), { role, status });
    }
    for (const org of ["org-a", "org-b"]) {
      await setDoc(doc(db, paths.organization(org)), { primaryProfession: "PSYCHOLOGIST", ownerId: "a" });
      for (const collection of ["professionals", "clients", "appointments", "transactions", "aiDecisions", "auditLogs"]) await setDoc(doc(db, paths.document(org, collection, "example")), { organizationId: org });
      await setDoc(doc(db, paths.document(org, "aiRules", "immutable")), { organizationId: org, immutable: true, level: "SYSTEM", enabled: true });
      await setDoc(doc(db, paths.document(org, "conversations", "conv")), { organizationId: org, clientId: "example", status: "OPEN" });
      await setDoc(doc(db, messagePath(org, "conv", "m1")), { organizationId: org, conversationId: "conv", body: "Bom dia", sentAt: new Date() });
      await setDoc(doc(db, paths.document(org, "notifications", "alert")), { organizationId: org, status: "UNREAD", title: "Alerta" });
      await setDoc(doc(db, paths.document(org, "notificationDeliveries", "envio")), { organizationId: org, status: "PLANNED", attempts: 0, sentAt: null, channel: "SMS", event: "APPOINTMENT_REMINDER", bodyHash: "abcdef12", contactHint: "***0000" });
      await setDoc(doc(db, paths.document(org, "privacyRequests", "pedido")), { organizationId: org, type: "CLIENT_EXPORT", subjectId: "example", requestedBy: "a" });
    }
    await setDoc(doc(db, paths.initialPassword("a")), { hash: "test-only" });
    await setDoc(doc(db, paths.document("org-a", "clients", "consentido")), { organizationId: "org-a", fullName: "Alex Ficticio", notificationConsent: recordConsent({ EMAIL: [SEEDED_EMAIL], SMS: [SEEDED_SMS] }) });
    await setDoc(doc(db, paths.document("org-a", "clients", "antigo")), { organizationId: "org-a", fullName: "Cadastro Antigo", notificationConsent: LEGACY_CONSENT });
    await setDoc(doc(db, paths.document("org-a", "clients", "tres-canais")), { organizationId: "org-a", fullName: "Tres Canais", notificationConsent: recordConsent({ EMAIL: [consentRecord("a")], SMS: [consentRecord("a")], WHATSAPP: [consentRecord("a")] }) });

    // Cobranca da plataforma: colecoes de raiz, da operadora, fora de qualquer
    // tenant. `org-c` existe so para o caso do dono com mensalidade vencida.
    await setDoc(doc(db, paths.organization("org-c")), { primaryProfession: "PSYCHOLOGIST", ownerId: "ownerExpired" });
    await setDoc(doc(db, paths.platformPlan("profissional-mensal")), { id: "profissional-mensal", priceInCents: 19900 });
    for (const [org, owner] of [["org-a", "a"], ["org-b", "b"], ["org-c", "ownerExpired"]]) {
      await setDoc(doc(db, paths.platformSubscription(org)), { organizationId: org, subscriberUserId: owner, status: "ACTIVE", amountInCents: 19900, currency: "BRL", interval: "MONTH" });
      await setDoc(doc(db, paths.platformInvoice(`in-${org}`)), { id: `in-${org}`, organizationId: org, status: "PAID", amountDueInCents: 19900, issuedAt: new Date().toISOString() });
      await setDoc(doc(db, paths.platformAccessGrant(org)), { organizationId: org, subscriberUserId: owner, kind: "PILOT", reason: "Piloto combinado.", until: "2026-12-01T00:00:00.000Z", revokedAt: null });
    }
    await setDoc(doc(db, paths.platformGatewayEvent("evt-1")), { id: "evt-1", type: "invoice.paid", outcome: "APPLIED", organizationId: "org-a", receivedAt: new Date().toISOString() });
    await setDoc(doc(db, paths.platformCustomer("cus_1")), { customerId: "cus_1", organizationId: "org-a", subscriberUserId: "a" });
    await setDoc(doc(db, paths.platformAuditLog("log-1")), { id: "log-1", action: "ACCESS_GRANTED", actorId: "admin", organizationId: "org-a", createdAt: new Date().toISOString() });
    await setDoc(doc(db, paths.platformRateLimit("createSubscriptionCheckout_a")), { count: 1, windowStartMs: Date.now() });
  });
  const db = uid => environment.authenticatedContext(uid).firestore();
  const withTotp = uid => environment.authenticatedContext(uid, TOTP).firestore();
  const withPhone = uid => environment.authenticatedContext(uid, PHONE).firestore();
  const own = collection => paths.document("org-a", collection, "example");
  await allowed(getDoc(doc(db("a"), own("clients"))));
  // Estas tres afirmavam acesso da operadora aos tenants e foram
  // invertidas: nem com segundo fator ela le cliente, cria vinculo ou regra.
  await denied(getDoc(doc(withTotp("admin"), paths.document("org-b", "clients", "example"))));
  await allowed(getDocs(collection(withTotp("admin"), paths.accounts())));
  await allowed(updateDoc(doc(db("a"), own("clients")), { fullName: "Teste administrativo" }));
  await denied(setDoc(doc(withTotp("admin"), paths.document("org-b", "members", "new")), { role: "PROFESSIONAL", status: "ACTIVE" }));
  await denied(setDoc(doc(withTotp("admin"), paths.document("org-b", "aiRules", "custom")), { organizationId: "org-b", immutable: false, level: "PROFESSIONAL" }));
  await denied(getDoc(doc(db("a"), paths.document("org-b", "clients", "example"))));
  await denied(updateDoc(doc(db("a"), paths.account("a")), { platformRole: "PLATFORM_ADMIN" }));
  await denied(setDoc(doc(db("a"), paths.document("org-a", "members", "forged")), { role: "OWNER", status: "ACTIVE" }));
  for (const uid of ["initial", "suspended", "expired", "wrongProfession"]) await denied(getDoc(doc(db(uid), own("clients"))));
  await allowed(getDoc(doc(db("initial"), paths.account("initial"))));
  await allowed(getDoc(doc(db("restricted"), own("clients"))));
  await denied(getDoc(doc(db("restricted"), own("transactions"))));
  await denied(getDoc(doc(db("restricted"), own("appointments"))));
  // Regra imutavel e trilhas append-only: nem o OWNER da organizacao muda.
  await denied(updateDoc(doc(db("ownerRole"), paths.document("org-a", "aiRules", "immutable")), { enabled: false }));
  await denied(deleteDoc(doc(db("ownerRole"), paths.document("org-a", "aiRules", "immutable"))));
  for (const collection of ["aiDecisions", "auditLogs"]) {
    await denied(updateDoc(doc(db("ownerRole"), own(collection)), { changed: true }));
    await denied(deleteDoc(doc(db("ownerRole"), own(collection))));
  }
  await denied(setDoc(doc(db("a"), paths.document("org-a", "clients", "foreign")), { organizationId: "org-b" }));
  await denied(getDoc(doc(withTotp("admin"), paths.initialPassword("a"))));
  await denied(getDoc(doc(environment.unauthenticatedContext().firestore(), paths.account("a"))));

  // ------------------------------------------------------------- Etapa 1
  // Criterio de conclusao: duas organizacoes nao leem nem alteram os dados uma
  // da outra, inclusive por chamada direta ao SDK.

  const messagesOf = org => query(collectionGroup(db("a"), "messages"), where("organizationId", "==", org));

  // Leitura operacional dentro do proprio tenant, do jeito que o repositorio le.
  for (const name of ["clients", "appointments", "transactions", "conversations", "aiRules", "notifications"]) {
    await allowed(getDocs(query(collection(db("a"), paths.collection("org-a", name)), limit(5))));
  }
  await allowed(getDocs(collection(db("a"), messagesPath("org-a", "conv"))));
  await allowed(getDocs(messagesOf("org-a")));

  // A mesma consulta apontada para outro tenant, e a consulta sem filtro de
  // tenant, sao recusadas inteiras — regra nao filtra resultado.
  await denied(getDocs(messagesOf("org-b")));
  await denied(getDocs(query(collectionGroup(db("a"), "messages"), limit(50))));
  await denied(getDoc(doc(db("a"), messagePath("org-b", "conv", "m1"))));
  await denied(getDocs(collection(db("a"), messagesPath("org-b", "conv"))));

  // Sem o modulo de mensagens a caixa de entrada nao abre nem por collectionGroup.
  await denied(getDocs(query(collectionGroup(db("restricted"), "messages"), where("organizationId", "==", "org-a"))));

  // Listagem cruzada de cada colecao operacional.
  for (const name of ["clients", "appointments", "transactions", "conversations", "aiRules", "notifications", "notificationDeliveries", "auditLogs"]) {
    await denied(getDocs(query(collection(db("a"), paths.collection("org-b", name)), limit(5))));
  }

  // Escrita cruzada, documento a documento.
  for (const name of ["clients", "appointments", "transactions", "conversations", "aiRules", "notifications", "notificationDeliveries", "auditLogs"]) {
    await denied(setDoc(doc(db("a"), paths.document("org-b", name, "intruso")), { organizationId: "org-b" }));
    await denied(updateDoc(doc(db("a"), paths.document("org-b", name, "example")), { alterado: true }));
  }
  await denied(setDoc(doc(db("a"), messagePath("org-b", "conv", "intrusa")), { organizationId: "org-b", conversationId: "conv", body: "oi" }));

  // Mensagem nasce imutavel: cria, nunca altera nem apaga.
  await allowed(setDoc(doc(db("a"), messagePath("org-a", "conv", "m2")), { organizationId: "org-a", conversationId: "conv", body: "resposta", sentAt: new Date() }));
  await denied(updateDoc(doc(db("a"), messagePath("org-a", "conv", "m1")), { body: "reescrita" }));
  await denied(deleteDoc(doc(db("a"), messagePath("org-a", "conv", "m1"))));

  // Atendimento e conversa nao sao apagados: cancelamento e update.
  await allowed(updateDoc(doc(db("a"), own("appointments")), { status: "CANCELLED" }));
  await denied(deleteDoc(doc(db("a"), own("appointments"))));
  await denied(deleteDoc(doc(db("a"), paths.document("org-a", "conversations", "conv"))));

  // Notificacao: o usuario marca como lida, nao reescreve o alerta.
  await allowed(updateDoc(doc(db("a"), paths.document("org-a", "notifications", "alert")), { status: "READ", updatedAt: new Date().toISOString() }));
  await denied(updateDoc(doc(db("a"), paths.document("org-a", "notifications", "alert")), { title: "Outro texto" }));

  // Fila de saida dos avisos ao cliente. Um registro nasce planejado e sem
  // tentativa: gravar uma entrega ja "enviada" faria a trilha afirmar que uma
  // mensagem saiu sem que nada tenha sido tentado.
  const delivery = extra => ({ organizationId: "org-a", status: "PLANNED", attempts: 0, sentAt: null, channel: "SMS", event: "APPOINTMENT_REMINDER", bodyHash: "abcdef12", contactHint: "***0000", ...extra });
  await allowed(setDoc(doc(db("a"), paths.document("org-a", "notificationDeliveries", "novo")), delivery()));
  await denied(setDoc(doc(db("a"), paths.document("org-a", "notificationDeliveries", "forjado")), delivery({ status: "SENT", attempts: 1, sentAt: new Date().toISOString() })));
  await denied(setDoc(doc(db("a"), paths.document("org-a", "notificationDeliveries", "forjado")), delivery({ attempts: 3 })));

  // Depois do planejamento so o resultado da tentativa muda. Destinatario,
  // canal, evento e hash do texto sao fixos — sem isso o registro deixaria de
  // provar o que foi enviado.
  await allowed(updateDoc(doc(db("a"), paths.document("org-a", "notificationDeliveries", "envio")), { status: "SENT", attempts: 1, sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  await denied(updateDoc(doc(db("a"), paths.document("org-a", "notificationDeliveries", "envio")), { bodyHash: "00000000" }));
  await denied(updateDoc(doc(db("a"), paths.document("org-a", "notificationDeliveries", "envio")), { channel: "WHATSAPP" }));
  await denied(deleteDoc(doc(db("a"), paths.document("org-a", "notificationDeliveries", "envio"))));

  // Sem o modulo de agenda a fila de saida nao abre: todo evento que a alimenta
  // vem de la.
  await denied(getDoc(doc(db("restricted"), paths.document("org-a", "notificationDeliveries", "envio"))));

  // A configuracao dos avisos vive na organizacao, e alterar a organizacao
  // continua sendo ato administrativo DA PROPRIA organizacao.
  await allowed(updateDoc(doc(db("ownerRole"), paths.organization("org-a")), { "settings.notifications": { enabled: true, verifiedSenderChannels: ["SMS"], rules: [] }, ownerId: "a" }));

  // Trilha de auditoria: o profissional escreve, so a administracao le.
  await allowed(setDoc(doc(db("a"), paths.document("org-a", "auditLogs", "novo")), { organizationId: "org-a", action: "CREATE" }));
  await denied(getDoc(doc(db("a"), own("auditLogs"))));
  await allowed(getDoc(doc(db("ownerRole"), own("auditLogs"))));
  await allowed(getDoc(doc(db("adminRole"), own("auditLogs"))));

  // Perfil profissional exige papel administrativo: por isso o cadastro de
  // profissional e criado pelo backend, e nao pelo aplicativo.
  await denied(setDoc(doc(db("a"), paths.document("org-a", "professionals", "auto")), { organizationId: "org-a", displayName: "Eu mesmo" }));
  await allowed(getDoc(doc(db("a"), paths.organization("org-a"))));
  await denied(getDoc(doc(db("a"), paths.organization("org-b"))));

  // ------------------------------------------------------------- Etapa 5B
  // A operadora nao alcanca dado operacional. Uma negacao de leitura e
  // uma de escrita por colecao, com a sessao mais forte que ela pode ter.

  const operator = withTotp("admin");
  await denied(getDoc(doc(operator, paths.organization("org-a"))));
  await denied(updateDoc(doc(operator, paths.organization("org-a")), { name: "Alterada pela operadora" }));
  await denied(setDoc(doc(operator, paths.organization("org-nova")), { primaryProfession: "PSYCHOLOGIST", ownerId: "admin" }));
  await denied(getDoc(doc(operator, paths.document("org-a", "members", "a"))));
  await denied(updateDoc(doc(operator, paths.document("org-a", "members", "a")), { role: "OWNER" }));
  await denied(deleteDoc(doc(operator, paths.document("org-a", "members", "restricted"))));
  for (const name of ["professionals", "clients", "appointments", "conversations", "transactions", "aiRules", "aiDecisions", "notifications", "notificationDeliveries", "auditLogs"]) {
    await denied(getDoc(doc(operator, own(name))));
    await denied(setDoc(doc(operator, paths.document("org-a", name, "da-operadora")), { organizationId: "org-a" }));
  }
  await denied(getDoc(doc(operator, messagePath("org-a", "conv", "m1"))));
  await denied(getDocs(query(collectionGroup(operator, "messages"), where("organizationId", "==", "org-a"))));
  await denied(setDoc(doc(operator, messagePath("org-a", "conv", "da-operadora")), { organizationId: "org-a", conversationId: "conv", body: "oi" }));

  // Apagar a organizacao pelo navegador trancaria o tenant. Nem o OWNER.
  await denied(deleteDoc(doc(db("ownerRole"), paths.organization("org-a"))));
  await denied(deleteDoc(doc(operator, paths.organization("org-b"))));

  // MFA: sem o fator exigido, a conta de operadora nao e a operadora. A propria
  // conta continua legivel, que e o que a tela usa para pedir o fator.
  await allowed(getDoc(doc(db("admin"), paths.account("admin"))));
  await denied(getDocs(collection(db("admin"), paths.accounts())));
  await denied(getDocs(collection(withPhone("admin"), paths.accounts())));
  await denied(getDoc(doc(db("admin"), paths.account("a"))));
  await allowed(getDoc(doc(withTotp("admin"), paths.account("a"))));
  await denied(getDocs(collection(db("admin"), paths.platformSubscriptions())));
  await denied(getDoc(doc(db("admin"), paths.platformSubscription("org-b"))));
  await denied(getDocs(collection(db("admin"), paths.platformInvoices())));
  await denied(getDocs(collection(db("admin"), paths.platformGatewayEvents())));
  // E um profissional com TOTP continua sendo profissional.
  await denied(getDocs(collection(withTotp("a"), paths.accounts())));

  // ------------------------------------------------------------- Etapa 3
  // Cobranca da plataforma. Duas coisas para provar: o assinante alcanca a
  // PROPRIA cobranca e nada alem dela, e NINGUEM escreve — nem o administrador
  // da plataforma. Ativar assinatura e estender validade sao consequencia de
  // evento assinado, aplicado pelo backend com o SDK administrativo.

  const invoicesOf = (uid, org) => query(collection(db(uid), paths.platformInvoices()), where("organizationId", "==", org));

  // Leitura: cada um enxerga o que lhe cabe.
  await allowed(getDoc(doc(db("a"), paths.platformSubscription("org-a"))));
  await denied(getDoc(doc(db("a"), paths.platformSubscription("org-b"))));
  await allowed(getDoc(doc(withTotp("admin"), paths.platformSubscription("org-b"))));
  await allowed(getDocs(collection(withTotp("admin"), paths.platformSubscriptions())));
  await denied(getDocs(collection(db("a"), paths.platformSubscriptions())));

  // Membro que nao responde pela organizacao nao ve a cobranca dela.
  await denied(getDoc(doc(db("restricted"), paths.platformSubscription("org-a"))));

  // OWNER por papel: ativo le; suspenso da organizacao nao le nem as faturas.
  await allowed(getDoc(doc(db("ownerRole"), paths.platformSubscription("org-a"))));
  await denied(getDoc(doc(db("ownerRoleSuspended"), paths.platformSubscription("org-a"))));
  await denied(getDocs(invoicesOf("ownerRoleSuspended", "org-a")));

  // Mensalidade vencida: o operacional fecha, a propria cobranca continua
  // aberta. E o unico caminho para quem precisa regularizar.
  await allowed(getDoc(doc(db("ownerExpired"), paths.platformSubscription("org-c"))));
  await denied(getDoc(doc(db("ownerExpired"), paths.document("org-c", "clients", "example"))));
  await allowed(getDocs(collection(db("ownerExpired"), paths.platformPlans())));
  await allowed(getDocs(collection(db("a"), paths.platformPlans())));
  await denied(getDocs(collection(environment.unauthenticatedContext().firestore(), paths.platformPlans())));

  // Faturas: mesmo mecanismo do collectionGroup de mensagens — sem o filtro de
  // tenant o Firestore nao consegue provar a regra e recusa a consulta inteira.
  await allowed(getDocs(invoicesOf("a", "org-a")));
  await denied(getDocs(invoicesOf("a", "org-b")));
  await denied(getDocs(query(collection(db("a"), paths.platformInvoices()), limit(50))));
  await allowed(getDocs(collection(withTotp("admin"), paths.platformInvoices())));

  // Trilha de eventos e indice de clientes: auditoria da operadora.
  await allowed(getDocs(collection(withTotp("admin"), paths.platformGatewayEvents())));
  await denied(getDocs(collection(db("a"), paths.platformGatewayEvents())));
  await denied(getDoc(doc(db("a"), paths.platformCustomer("cus_1"))));
  await denied(getDoc(doc(withTotp("admin"), paths.platformCustomer("cus_1"))));

  // Escrita: negada para todo mundo, em todas as colecoes.
  await denied(setDoc(doc(db("a"), paths.platformSubscription("org-a")), { organizationId: "org-a", status: "ACTIVE" }));
  await denied(setDoc(doc(withTotp("admin"), paths.platformSubscription("org-a")), { organizationId: "org-a", status: "ACTIVE" }));
  await denied(updateDoc(doc(db("a"), paths.platformSubscription("org-a")), { accessUntil: "2099-01-01T00:00:00.000Z" }));
  await denied(updateDoc(doc(withTotp("admin"), paths.platformInvoice("in-org-a")), { status: "PAID" }));
  await denied(setDoc(doc(db("a"), paths.platformInvoice("in-forjada")), { organizationId: "org-a", status: "PAID" }));
  await denied(setDoc(doc(withTotp("admin"), paths.platformGatewayEvent("evt-forjado")), { id: "evt-forjado", outcome: "APPLIED" }));
  await denied(setDoc(doc(withTotp("admin"), paths.platformPlan("plano-forjado")), { priceInCents: 1 }));
  await denied(deleteDoc(doc(db("a"), paths.platformSubscription("org-a"))));
  await denied(setDoc(doc(withTotp("admin"), paths.platformCustomer("cus_2")), { organizationId: "org-a" }));

  // ------------------------------------------------------------- Etapa 5B
  // Concessao manual e trilha da operadora. O titular ve a propria
  // concessao, inclusive vencido; a operadora ve todas; ninguem escreve.

  await allowed(getDoc(doc(db("a"), paths.platformAccessGrant("org-a"))));
  await denied(getDoc(doc(db("a"), paths.platformAccessGrant("org-b"))));
  await allowed(getDoc(doc(db("ownerExpired"), paths.platformAccessGrant("org-c"))));
  await denied(getDoc(doc(db("restricted"), paths.platformAccessGrant("org-a"))));
  await allowed(getDocs(collection(withTotp("admin"), paths.platformAccessGrants())));
  await denied(getDocs(collection(db("admin"), paths.platformAccessGrants())));
  await denied(setDoc(doc(db("a"), paths.platformAccessGrant("org-a")), { organizationId: "org-a", until: "2099-01-01T00:00:00.000Z" }));
  await denied(updateDoc(doc(withTotp("admin"), paths.platformAccessGrant("org-b")), { until: "2099-01-01T00:00:00.000Z" }));
  await denied(deleteDoc(doc(withTotp("admin"), paths.platformAccessGrant("org-b"))));

  await allowed(getDocs(collection(withTotp("admin"), paths.platformAuditLogs())));
  await denied(getDocs(collection(db("admin"), paths.platformAuditLogs())));
  await denied(getDocs(collection(db("a"), paths.platformAuditLogs())));
  await denied(setDoc(doc(withTotp("admin"), paths.platformAuditLog("forjado")), { action: "ACCESS_GRANTED", actorId: "admin" }));
  await denied(updateDoc(doc(withTotp("admin"), paths.platformAuditLog("log-1")), { reason: "reescrito" }));
  await denied(deleteDoc(doc(withTotp("admin"), paths.platformAuditLog("log-1"))));

  // O contador de abuso e mecanismo do backend. Zerar o proprio contador
  // pelo navegador anularia o limite.
  await denied(getDoc(doc(withTotp("admin"), paths.platformRateLimit("createSubscriptionCheckout_a"))));
  await denied(setDoc(doc(db("a"), paths.platformRateLimit("createSubscriptionCheckout_a")), { count: 0, windowStartMs: 0 }));

  // ------------------------------------------------------------- Etapa 5C
  // Pedidos de titulares de dados. O registro e do backend; le quem responde
  // pela organizacao — papel OWNER/ADMIN ativo ou o titular (`ownerId`, aqui
  // "a", nascido PROFESSIONAL) —, e mais ninguem, nem a operadora.
  const privacyRequest = org => paths.document(org, "privacyRequests", "pedido");
  await allowed(getDoc(doc(db("a"), privacyRequest("org-a"))));
  await allowed(getDoc(doc(db("ownerRole"), privacyRequest("org-a"))));
  await allowed(getDoc(doc(db("adminRole"), privacyRequest("org-a"))));
  await denied(getDoc(doc(db("restricted"), privacyRequest("org-a"))));
  await denied(getDoc(doc(db("ownerRoleSuspended"), privacyRequest("org-a"))));
  await denied(getDoc(doc(db("a"), privacyRequest("org-b"))));
  await denied(getDocs(query(collection(db("b"), paths.collection("org-a", "privacyRequests")), limit(5))));
  await denied(getDoc(doc(operator, privacyRequest("org-a"))));
  await denied(setDoc(doc(db("ownerRole"), paths.document("org-a", "privacyRequests", "forjado")), { organizationId: "org-a", type: "CLIENT_ERASURE" }));
  await denied(updateDoc(doc(db("a"), privacyRequest("org-a")), { subjectId: "outro" }));
  await denied(deleteDoc(doc(db("ownerRole"), privacyRequest("org-a"))));
  // A pseudonimizacao e ato do backend: pelo cliente, a decisao continua
  // imutavel, inclusive para "retirar" o conteudo.
  await denied(updateDoc(doc(db("ownerRole"), own("aiDecisions")), { inputPreview: "[conteudo removido a pedido do titular dos dados]" }));

  // ------------------------------------------------------------- Etapa 6
  // O titular da organizacao (`ownerId`) configura os proprios avisos e o
  // proprio horario sem papel administrativo — e nada mais do documento. "a" e PROFESSIONAL e titular de
  // org-a; "b" e PROFESSIONAL de org-b, cujo titular tambem e "a".
  const notificationSettings = { enabled: false, verifiedSenderChannels: [], rules: [] };
  const orgA = () => paths.organization("org-a");
  await allowed(updateDoc(doc(db("a"), orgA()), { "settings.notifications": notificationSettings, updatedAt: new Date().toISOString(), updatedBy: "a" }));
  await denied(updateDoc(doc(db("a"), orgA()), { name: "Renomeada pelo titular" }));
  await denied(updateDoc(doc(db("a"), orgA()), { "settings.notifications": notificationSettings, name: "Junto com os avisos" }));
  await allowed(updateDoc(doc(db("a"), orgA()), { "settings.agenda": { workdayStart: "06:00" }, updatedAt: new Date().toISOString(), updatedBy: "a" }));
  await denied(updateDoc(doc(db("a"), orgA()), { "settings.agenda": "sempre" }));
  await denied(updateDoc(doc(db("a"), orgA()), { "settings.agenda": { workdayStart: "06:00" }, name: "Junto com o horario" }));
  await denied(updateDoc(doc(db("b"), paths.organization("org-b")), { "settings.agenda": { workdayStart: "06:00" } }));
  await denied(updateDoc(doc(db("a"), orgA()), { "settings.ai": { allowAutonomousReplies: true } }));
  await denied(updateDoc(doc(db("a"), orgA()), { "settings.notifications": notificationSettings, ownerId: "b" }));
  await denied(updateDoc(doc(db("a"), orgA()), { "settings.notifications": "ligado" }));
  // Ser `ownerId` sem vinculo ativo naquela organizacao nao abre nada.
  await denied(updateDoc(doc(db("a"), paths.organization("org-b")), { "settings.notifications": notificationSettings }));
  // Nenhum outro membro ganha o caminho, nem com modulo liberado.
  await denied(updateDoc(doc(db("b"), paths.organization("org-b")), { "settings.notifications": notificationSettings }));
  await denied(updateDoc(doc(db("restricted"), orgA()), { "settings.notifications": notificationSettings }));
  await denied(updateDoc(doc(operator, orgA()), { "settings.notifications": notificationSettings }));
  // Titular com a validade vencida perde o caminho junto com o painel.
  await denied(updateDoc(doc(db("ownerExpired"), paths.organization("org-c")), { "settings.notifications": notificationSettings }));
  // O caminho administrativo nao mudou: ADMIN continua alterando a agenda.
  await allowed(updateDoc(doc(db("adminRole"), orgA()), { "settings.agenda": { workdayStart: "07:00" } }));

  // ------------------------------------------------------- Fase 3, 13.1
  // Consentimento por canal. So se acrescenta ou retira registro, o navegador
  // so registra em nome de quem esta nele, e retirar nao apaga o historico.
  const clientOf = (uid, id) => doc(db(uid), paths.document("org-a", "clients", id));
  const withConsent = value => ({ organizationId: "org-a", fullName: "Cadastro Novo", notificationConsent: value });
  const guardian = { fullName: "Rui Ficticio", relationship: "PARENT" };

  await allowed(setDoc(clientOf("a", "novo-adulto"), withConsent(recordConsent({ WHATSAPP: [consentRecord("a")] }))));
  // O caso mais caro de criar: os tres canais, com responsavel legal, de uma vez.
  const minorRecord = () => consentRecord("a", { subjectIsMinor: true, legalGuardian: guardian });
  await allowed(setDoc(clientOf("a", "novo-menor"), withConsent(recordConsent({ EMAIL: [minorRecord()], SMS: [minorRecord()], WHATSAPP: [minorRecord()] }))));
  // A recepcao registra: `notificationConsent:record` acompanha quem escreve cadastro.
  await allowed(setDoc(clientOf("assistantRole", "pela-recepcao"), withConsent(recordConsent({ EMAIL: [consentRecord("assistantRole")] }))));

  for (const [reason, value] of [
    ["menor sem responsavel", recordConsent({ SMS: [consentRecord("a", { subjectIsMinor: true })] })],
    ["responsavel sem vinculo", recordConsent({ SMS: [consentRecord("a", { subjectIsMinor: true, legalGuardian: { fullName: "Rui Ficticio" } })] })],
    ["adulto com responsavel", recordConsent({ SMS: [consentRecord("a", { legalGuardian: guardian })] })],
    ["registrado em nome de outro membro", recordConsent({ SMS: [consentRecord("b")] })],
    ["a propria pessoa pelo navegador", recordConsent({ SMS: [consentRecord("a", { granted: consentAct("a", { recordedBy: { kind: "SUBJECT", userId: null } }) })] })],
    ["sem meio", recordConsent({ SMS: [consentRecord("a", { granted: { at: "2026-09-12T10:00:00.000Z", recordedBy: { kind: "STAFF", userId: "a" } } })] })],
    ["meio desconhecido", recordConsent({ SMS: [consentRecord("a", { granted: consentAct("a", { medium: "PHONE_CALL" }) })] })],
    ["data que nao e instante", recordConsent({ SMS: [consentRecord("a", { granted: consentAct("a", { at: "12/09/2026" }) })] })],
    ["versao do texto como frase", recordConsent({ SMS: [consentRecord("a", { textVersion: "Alex aceitou" })] })],
    ["registro nascido retirado", recordConsent({ SMS: [consentRecord("a", { withdrawn: consentAct("a") })] })],
    ["canal inexistente", recordConsent({ TELEGRAM: [consentRecord("a")] })],
    ["formato antigo pelo navegador", LEGACY_CONSENT],
  ]) await deniedBecause(reason, setDoc(clientOf("a", `negado-${checks}`), withConsent(value)));

  // Mexer em outro campo nao confere nada do consentimento.
  const consentido = uid => clientOf(uid, "consentido");
  await allowed(updateDoc(consentido("a"), { fullName: "Alex Ficticio Atualizado" }));
  // Apagar ou reescrever o historico: nem quem registra.
  await deniedBecause("apagar o consentimento", updateDoc(consentido("a"), { notificationConsent: null }));
  await deniedBecause("apagar o historico de um canal", updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [SEEDED_EMAIL] }) }));
  await deniedBecause("reescrever registro vigente", updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [{ ...SEEDED_EMAIL, textVersion: "outra-versao" }], SMS: [SEEDED_SMS] }) }));
  await deniedBecause("reescrever retirada", updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [SEEDED_EMAIL], SMS: [{ ...SEEDED_SMS, withdrawn: consentAct("a", { medium: "WRITTEN_DOCUMENT" }) }] }) }));
  await deniedBecause("registro novo sobre vigente", updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [SEEDED_EMAIL, consentRecord("a")], SMS: [SEEDED_SMS] }) }));
  await deniedBecause("retirar e autorizar na mesma escrita", updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [{ ...SEEDED_EMAIL, withdrawn: consentAct("a") }, consentRecord("a")], SMS: [SEEDED_SMS] }) }));
  await deniedBecause("retirar em nome de outro membro", updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [{ ...SEEDED_EMAIL, withdrawn: consentAct("b") }], SMS: [SEEDED_SMS] }) }));
  await deniedBecause("quem so le nao retira", updateDoc(consentido("viewerRole"), { notificationConsent: recordConsent({ EMAIL: [{ ...SEEDED_EMAIL, withdrawn: consentAct("viewerRole") }], SMS: [SEEDED_SMS] }) }));

  // Retirar preenche so a retirada; autorizar de novo acrescenta um registro.
  const withdrawnEmail = { ...SEEDED_EMAIL, withdrawn: consentAct("a", { at: "2026-09-12T11:00:00.000Z", medium: "MESSAGE" }) };
  const regrantedSms = consentRecord("a", { granted: consentAct("a", { at: "2026-09-12T12:00:00.000Z", medium: "WRITTEN_DOCUMENT" }) });
  await allowed(updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [withdrawnEmail], SMS: [SEEDED_SMS] }) }));
  await allowed(updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [withdrawnEmail], SMS: [SEEDED_SMS, regrantedSms] }) }));
  await deniedBecause("trocar o registro retirado por um novo", updateDoc(consentido("a"), { notificationConsent: recordConsent({ EMAIL: [consentRecord("a")], SMS: [SEEDED_SMS, regrantedSms] }) }));
  // O caso mais caro de retirar: desmarcar o aceite geral retira os tres canais de uma vez.
  const withdrawnByMessage = () => ({ ...consentRecord("a"), withdrawn: consentAct("a", { medium: "MESSAGE" }) });
  await allowed(updateDoc(clientOf("a", "tres-canais"), { notificationConsent: recordConsent({ EMAIL: [withdrawnByMessage()], SMS: [withdrawnByMessage()], WHATSAPP: [withdrawnByMessage()] }) }));

  // Formato antigo: passar ao registro por canal guarda o antigo inteiro.
  const antigo = () => clientOf("a", "antigo");
  const threeGrants = () => ({ EMAIL: [consentRecord("a")], SMS: [consentRecord("a")], WHATSAPP: [consentRecord("a")] });
  await deniedBecause("perder o formato antigo", updateDoc(antigo(), { notificationConsent: recordConsent(threeGrants()) }));
  await allowed(updateDoc(antigo(), { notificationConsent: recordConsent(threeGrants(), LEGACY_CONSENT) }));
  await deniedBecause("reescrever o formato antigo guardado", updateDoc(antigo(), { notificationConsent: recordConsent(threeGrants(), { ...LEGACY_CONSENT, channels: ["EMAIL", "SMS"] }) }));

  assert.equal(checks, 236);
  console.log(`${checks} verificacoes das Security Rules passaram no emulador.`);
} finally { await environment.cleanup(); }
