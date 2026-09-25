import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { messagePath, messagesPath, paths } from "../functions/generated/paths.js";

// As ferramentas do emulador ficam fora do bundle e das dependencias do aplicativo.
const requireTools = createRequire(new URL("../.local/firebase-tools/package.json", import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = requireTools("@firebase/rules-unit-testing");
const firestoreSdk = requireTools("firebase/firestore");
const { doc, collection, collectionGroup, query, where, limit } = firestoreSdk;

// Cobertura por papel (H.6). Cada operacao guarda o alvo; cada negacao registra
// o alvo com QUEM tentou. No fim, toda colecao de `firestore.rules` precisa de
// negacao testada para sessao de tenant e para a operadora — uma colecao nova
// sem essas duas provas quebra a suite, em vez de nascer protegida so no papel.
const roleOf = new WeakMap();
let lastTarget = null;
const tracked = (name) => (target, ...rest) => { lastTarget = target; return firestoreSdk[name](target, ...rest); };
const getDoc = tracked("getDoc");
const setDoc = tracked("setDoc");
const updateDoc = tracked("updateDoc");
const deleteDoc = tracked("deleteDoc");
const getDocs = tracked("getDocs");
// O contexto de teste entrega a instancia de compatibilidade; a referencia criada
// por `doc()` aponta para a instancia modular por dentro dela. As duas levam o papel.
const tag = (firestore, role) => { roleOf.set(firestore, role); if (firestore._delegate) roleOf.set(firestore._delegate, role); return firestore; };
function collectionOf(target) {
  if (target.type === "document") return target.parent.id;
  if (target.type === "collection") return target.id;
  return target._query.collectionGroup ?? target._query.path.lastSegment();
}
const deniedBy = new Map();
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
async function denied(operation) {
  const target = lastTarget;
  await assertFails(operation);
  checks++;
  const role = target ? roleOf.get(target.firestore) ?? "desconhecido" : "desconhecido";
  const name = target ? collectionOf(target) : "desconhecida";
  if (!deniedBy.has(name)) deniedBy.set(name, new Set());
  deniedBy.get(name).add(role);
}
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
      for (const collection of ["professionals", "clients", "appointments", "transactions", "aiDecisions", "automationTasks", "auditLogs"]) await setDoc(doc(db, paths.document(org, collection, "example")), { organizationId: org });
      await setDoc(doc(db, paths.document(org, "aiRules", "immutable")), { organizationId: org, immutable: true, level: "SYSTEM", enabled: true });
      await setDoc(doc(db, paths.document(org, "aiDecisions", "revisada")), { organizationId: org, classification: "ADMINISTRATIVE" });
      await setDoc(doc(db, paths.document(org, "receipts", "r1")), { organizationId: org, number: 1, status: "ISSUED", amountInCents: 45000 });
      await setDoc(doc(db, paths.document(org, "paymentLinks", "m1-202609")), { organizationId: org, transactionId: "m1-202609", token: "t", tokenHash: "h" });
      await setDoc(doc(db, paths.document(org, "paymentProofs", "p1")), { organizationId: org, transactionId: "m1-202609", status: "SUBMITTED", storagePath: `paymentProofs/${org}/m1-202609/p1`, reviewedAt: null, reviewedBy: null, rejectionReason: null });
      await setDoc(doc(db, paths.document(org, "conversations", "conv")), { organizationId: org, clientId: "example", status: "OPEN" });
      await setDoc(doc(db, messagePath(org, "conv", "m1")), { organizationId: org, conversationId: "conv", body: "Bom dia", sentAt: new Date() });
      await setDoc(doc(db, paths.document(org, "notifications", "alert")), { organizationId: org, status: "UNREAD", title: "Alerta" });
      await setDoc(doc(db, paths.document(org, "notificationDeliveries", "envio")), { organizationId: org, status: "PLANNED", attempts: 0, sentAt: null, channel: "SMS", event: "APPOINTMENT_REMINDER", bodyHash: "abcdef12", contactHint: "***0000" });
      await setDoc(doc(db, paths.document(org, "privacyRequests", "pedido")), { organizationId: org, type: "CLIENT_EXPORT", subjectId: "example", requestedBy: "a" });
      await setDoc(doc(db, paths.document(org, "services", "manicure")), { organizationId: org, name: "Manicure", durationMinutes: 60, priceInCents: 5000, enabled: true, position: 0, archivedAt: null });
      await setDoc(doc(db, paths.document(org, "automationSwitches", "organization")), { organizationId: org, enabled: false, reason: "Investigando" });
      await setDoc(doc(db, paths.document(org, "calendarConnections", "a")), { organizationId: org, professionalId: "a", provider: "GOOGLE", status: "CONNECTED", refreshTokenCiphertext: "cifrado" });
      await setDoc(doc(db, paths.document(org, "calendarBusyBlocks", "a")), { organizationId: org, professionalId: "a", blocks: [] });
      await setDoc(doc(db, paths.document(org, "rescheduleRequests", "conversa")), { organizationId: org, clientId: "example", appointmentId: "example", status: "OFFERED" });
      await setDoc(doc(db, paths.document(org, "messagingSenders", "WHATSAPP")), { organizationId: org, channel: "WHATSAPP", providerId: "N8N_BRIDGE", providerSenderId: "123", displayNumber: "+5513999990000", displayName: "Clinica", status: "APPROVED", mode: "TEST", testRecipients: ["+5513999990000"] });
      await setDoc(doc(db, paths.document(org, "memberRequests", "example")), { organizationId: org });
      await setDoc(doc(db, paths.document(org, "memberInvitations", "example")), { organizationId: org });
      await setDoc(doc(db, paths.document(org, "importMappings", "example")), { organizationId: org });
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
      await setDoc(doc(db, paths.platformProfessionRequest(org)), { organizationId: org, requestedBy: owner, from: "PSYCHOLOGIST", to: "AESTHETICS", reason: "Mudei de area de atuacao.", status: "PENDING", requestedAt: new Date().toISOString(), decidedAt: null, decidedBy: null, decisionReason: null });
    }
    await setDoc(doc(db, paths.platformGatewayEvent("evt-1")), { id: "evt-1", type: "invoice.paid", outcome: "APPLIED", organizationId: "org-a", receivedAt: new Date().toISOString() });
    await setDoc(doc(db, paths.platformCustomer("cus_1")), { customerId: "cus_1", organizationId: "org-a", subscriberUserId: "a" });
    await setDoc(doc(db, paths.platformAuditLog("log-1")), { id: "log-1", action: "ACCESS_GRANTED", actorId: "admin", organizationId: "org-a", createdAt: new Date().toISOString() });
    await setDoc(doc(db, paths.platformRateLimit("createSubscriptionCheckout_a")), { count: 1, windowStartMs: Date.now() });
    await setDoc(doc(db, paths.platformSupportTicket("example")), { organizationId: "org-a" });
  });
  const db = uid => tag(environment.authenticatedContext(uid).firestore(), uid === "admin" ? "operadora-sem-fator" : "tenant");
  const withTotp = uid => tag(environment.authenticatedContext(uid, TOTP).firestore(), uid === "admin" ? "operadora" : "tenant");
  const withPhone = uid => tag(environment.authenticatedContext(uid, PHONE).firestore(), uid === "admin" ? "operadora-sem-fator" : "tenant");
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
  for (const name of ["memberRequests", "memberInvitations", "importMappings"]) {
    await denied(getDoc(doc(db("a"), own(name))));
    await denied(getDoc(doc(withTotp("admin"), own(name))));
  }
  await denied(getDoc(doc(db("a"), paths.platformSupportTicket("example"))));
  await denied(getDoc(doc(withTotp("admin"), paths.platformSupportTicket("example"))));
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

  // Revisao da classificacao (Fase 4): so OWNER e ADMIN, so sobre decisao que
  // existe, e sem tocar na decisao.
  const reviewOf = (uid, org = "org-a", id = "revisada") => doc(db(uid), paths.document(org, "aiDecisionReviews", id));
  const review = (uid, patch = {}) => ({
    id: "revisada", organizationId: "org-a", decisionId: "revisada", verdict: "CORRECT", expectedClassification: null,
    createdAt: new Date("2026-09-25T10:00:00.000Z"), updatedAt: new Date(), createdBy: uid, updatedBy: uid, ...patch,
  });
  await deniedBecause("titular PROFESSIONAL revisando", setDoc(reviewOf("a"), review("a")));
  await deniedBecause("secretaria revisando", setDoc(reviewOf("assistantRole"), review("assistantRole")));
  await deniedBecause("visualizador revisando", setDoc(reviewOf("viewerRole"), review("viewerRole")));
  await deniedBecause("decisao inexistente", setDoc(reviewOf("ownerRole", "org-a", "fantasma"), review("ownerRole", { id: "fantasma", decisionId: "fantasma" })));
  await deniedBecause("id diferente da decisao", setDoc(reviewOf("ownerRole"), review("ownerRole", { decisionId: "example" })));
  await deniedBecause("autor forjado", setDoc(reviewOf("ownerRole"), review("ownerRole", { createdBy: "adminRole", updatedBy: "adminRole" })));
  await deniedBecause("campo a mais", setDoc(reviewOf("ownerRole"), review("ownerRole", { note: "texto livre" })));
  await deniedBecause("correta com classificacao esperada", setDoc(reviewOf("ownerRole"), review("ownerRole", { expectedClassification: "CLINICAL" })));
  await deniedBecause("errada sem classificacao esperada", setDoc(reviewOf("ownerRole"), review("ownerRole", { verdict: "INCORRECT" })));
  await deniedBecause("errada com a mesma classificacao", setDoc(reviewOf("ownerRole"), review("ownerRole", { verdict: "INCORRECT", expectedClassification: "ADMINISTRATIVE" })));
  await deniedBecause("classificacao inexistente", setDoc(reviewOf("ownerRole"), review("ownerRole", { verdict: "INCORRECT", expectedClassification: "OUTRA" })));
  await deniedBecause("outro tenant", setDoc(reviewOf("ownerRole", "org-b"), review("ownerRole", { organizationId: "org-b" })));
  await allowed(setDoc(reviewOf("ownerRole"), review("ownerRole")));
  await allowed(getDoc(reviewOf("a")));
  await allowed(getDoc(reviewOf("viewerRole")));
  await denied(getDoc(reviewOf("restricted")));
  await deniedBecause("reescrever quem revisou primeiro", setDoc(reviewOf("adminRole"), review("adminRole", { verdict: "INCORRECT", expectedClassification: "CLINICAL" })));
  await allowed(setDoc(reviewOf("adminRole"), review("ownerRole", { verdict: "INCORRECT", expectedClassification: "CLINICAL", updatedBy: "adminRole" })));
  await denied(deleteDoc(reviewOf("ownerRole")));

  // Mensalidades (cobrador, C1): financeiro, valor inteiro, dia 1 a 28,
  // nasce ativa, encerrada nao muda e nada se apaga.
  const chargeOf = (uid, org = "org-a", id = "nova") => doc(db(uid), paths.document(org, "recurringCharges", id));
  const charge = (uid, patch = {}) => ({
    id: "nova", organizationId: "org-a", clientId: "consentido", clientName: "Alex Ficticio", professionalId: null,
    description: "Mensalidade", amountInCents: 45000, method: "PIX", dueDay: 10, startPeriod: "2026-09", lastLaunchedPeriod: "2026-09", status: "ACTIVE",
    endedAt: null, createdAt: new Date("2026-09-25T10:00:00.000Z"), updatedAt: new Date(), createdBy: uid, updatedBy: uid, ...patch,
  });
  await deniedBecause("visualizador criando mensalidade", setDoc(chargeOf("viewerRole"), charge("viewerRole")));
  await deniedBecause("sem modulo financeiro", setDoc(chargeOf("restricted"), charge("restricted")));
  await deniedBecause("valor quebrado", setDoc(chargeOf("a"), charge("a", { amountInCents: 450.5 })));
  await deniedBecause("dia 29", setDoc(chargeOf("a"), charge("a", { dueDay: 29 })));
  await deniedBecause("mes invalido", setDoc(chargeOf("a"), charge("a", { startPeriod: "2026-13" })));
  await deniedBecause("marcador fora do formato", setDoc(chargeOf("a"), charge("a", { lastLaunchedPeriod: "setembro" })));
  await deniedBecause("nascendo pausada", setDoc(chargeOf("a"), charge("a", { status: "PAUSED" })));
  await deniedBecause("campo a mais", setDoc(chargeOf("a"), charge("a", { pixKey: "chave" })));
  await deniedBecause("outro tenant", setDoc(chargeOf("a", "org-b"), charge("a", { organizationId: "org-b" })));
  await allowed(setDoc(chargeOf("assistantRole"), charge("assistantRole")));
  await allowed(getDoc(chargeOf("viewerRole")));
  await denied(getDoc(chargeOf("restricted")));
  await deniedBecause("secretaria pausando", updateDoc(chargeOf("assistantRole"), { status: "PAUSED" }));
  await deniedBecause("trocar o cliente", updateDoc(chargeOf("a"), { clientId: "antigo" }));
  await allowed(updateDoc(chargeOf("a"), { status: "PAUSED", amountInCents: 50000 }));
  await allowed(updateDoc(chargeOf("a"), { status: "ENDED", endedAt: new Date() }));
  await deniedBecause("mexer em encerrada", updateDoc(chargeOf("ownerRole"), { status: "ACTIVE", endedAt: null }));
  await denied(deleteDoc(chargeOf("ownerRole")));

  // Link e comprovante (cobrador, C2): so o backend cria; a conferencia muda
  // so a situacao, de aguardando para aprovado ou recusado.
  const linkOf = (uid) => doc(db(uid), paths.document("org-a", "paymentLinks", "m1-202609"));
  const proofOf = (uid, id = "p1") => doc(db(uid), paths.document("org-a", "paymentProofs", id));
  const proofReview = (uid, patch = {}) => ({ status: "APPROVED", reviewedAt: new Date(), reviewedBy: uid, updatedAt: new Date(), updatedBy: uid, ...patch });
  await allowed(getDoc(linkOf("a")));
  await denied(getDoc(linkOf("restricted")));
  await deniedBecause("titular gravando link", setDoc(linkOf("ownerRole"), { organizationId: "org-a", transactionId: "m1-202609", token: "t", tokenHash: "h" }));
  await deniedBecause("criar comprovante pelo navegador", setDoc(proofOf("ownerRole", "forjado"), { organizationId: "org-a", status: "SUBMITTED" }));
  await allowed(getDoc(proofOf("viewerRole")));
  await deniedBecause("secretaria aprovando", updateDoc(proofOf("assistantRole"), proofReview("assistantRole")));
  await deniedBecause("aprovando em nome de outro", updateDoc(proofOf("a"), proofReview("a", { reviewedBy: "ownerRole" })));
  await deniedBecause("trocando o arquivo", updateDoc(proofOf("a"), proofReview("a", { storagePath: "outro" })));
  await deniedBecause("recusa sem motivo", updateDoc(proofOf("a"), proofReview("a", { status: "REJECTED", rejectionReason: "" })));
  await deniedBecause("voltando a aguardando", updateDoc(proofOf("a"), proofReview("a", { status: "SUBMITTED" })));
  await allowed(updateDoc(proofOf("a"), proofReview("a", { status: "REJECTED", rejectionReason: "Valor diferente" })));
  await deniedBecause("reconferir o que ja foi conferido", updateDoc(proofOf("ownerRole"), proofReview("ownerRole")));
  await denied(deleteDoc(proofOf("ownerRole")));

  // Recibos (C3): recibo e contador so pelo backend; emissor por OWNER, ADMIN
  // e o titular, no formato certo.
  const receiptOf = (uid) => doc(db(uid), paths.document("org-a", "receipts", "r1"));
  const counterOf = (uid) => doc(db(uid), paths.document("org-a", "receiptCounters", "organization"));
  const issuerOf = (uid, org = "org-a", id = "organization") => doc(db(uid), paths.document(org, "receiptSettings", id));
  const issuer = (patch = {}) => ({ id: "organization", organizationId: "org-a", issuerName: "Ana Emissora", issuerDocument: "52998224725", issuerAddress: "Rua Um, 10", issuerCity: "Santos", ...patch });
  await allowed(getDoc(receiptOf("viewerRole")));
  await denied(getDoc(receiptOf("restricted")));
  await deniedBecause("titular reescrevendo recibo", updateDoc(receiptOf("ownerRole"), { amountInCents: 1 }));
  await deniedBecause("emitindo pelo navegador", setDoc(doc(db("ownerRole"), paths.document("org-a", "receipts", "forjado")), { organizationId: "org-a", number: 1 }));
  await denied(getDoc(counterOf("ownerRole")));
  await deniedBecause("mexendo no contador", setDoc(counterOf("ownerRole"), { organizationId: "org-a", next: 1 }));
  await deniedBecause("secretaria configurando emissor", setDoc(issuerOf("assistantRole"), issuer()));
  await deniedBecause("documento com letras", setDoc(issuerOf("a"), issuer({ issuerDocument: "529.982.247-25" })));
  await deniedBecause("outro id de emissor", setDoc(issuerOf("a", "org-a", "segundo"), issuer({ id: "segundo" })));
  await deniedBecause("emissor de outro tenant", setDoc(issuerOf("a", "org-b"), issuer({ organizationId: "org-b" })));
  await allowed(setDoc(issuerOf("a"), issuer()));
  await allowed(setDoc(issuerOf("adminRole"), issuer({ issuerDocument: "11222333000181" })));
  await denied(deleteDoc(issuerOf("ownerRole")));
  await denied(setDoc(doc(db("a"), paths.document("org-a", "clients", "foreign")), { organizationId: "org-b" }));
  await denied(getDoc(doc(withTotp("admin"), paths.initialPassword("a"))));
  await denied(getDoc(doc(tag(environment.unauthenticatedContext().firestore(), "anonimo"), paths.account("a"))));

  // Lacunas achadas pela cobertura por papel (H.6). Nenhuma regra mudou: estas
  // negacoes ja valiam, so nao estavam provadas para este papel.
  await denied(setDoc(doc(withTotp("admin"), paths.account("a")), { ...account("org-a"), modules: ["clientes"] }));
  await denied(getDoc(doc(db("a"), paths.initialPassword("a"))));
  await denied(setDoc(doc(db("a"), paths.platformPlan("plano-inventado")), { id: "plano-inventado", priceInCents: 1 }));
  await denied(getDoc(doc(db("a"), paths.userMembership("b"))));
  await denied(setDoc(doc(db("a"), paths.userMembership("a")), { organizations: { "org-b": "OWNER" } }));
  await denied(getDoc(doc(withTotp("admin"), paths.userMembership("a"))));

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
  for (const name of ["clients", "appointments", "transactions", "conversations", "aiRules", "notifications", "notificationDeliveries", "automationTasks", "messagingSenders", "whatsappConnections", "rescheduleRequests", "calendarConnections", "calendarBusyBlocks", "services", "auditLogs"]) {
    await denied(getDocs(query(collection(db("a"), paths.collection("org-b", name)), limit(5))));
  }

  // Escrita cruzada, documento a documento.
  for (const name of ["clients", "appointments", "transactions", "conversations", "aiRules", "notifications", "notificationDeliveries", "automationTasks", "auditLogs"]) {
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

  // Fila de saida dos avisos ao cliente (S-05, Fase 3, 13.2). O navegador so
  // le: planejar e disparar sao atos do backend. Nem uma entrega "PLANNED" nasce
  // pelo cliente, e nenhum papel marca envio, zera tentativa, cancela ou troca o
  // registro. Antes da 13.2 as duas primeiras escritas abaixo passavam.
  const delivery = extra => ({ organizationId: "org-a", status: "PLANNED", attempts: 0, sentAt: null, channel: "SMS", event: "APPOINTMENT_REMINDER", bodyHash: "abcdef12", contactHint: "***0000", ...extra });
  const deliveryOf = (uid, id) => doc(db(uid), paths.document("org-a", "notificationDeliveries", id));
  await allowed(getDoc(deliveryOf("a", "envio")));
  await allowed(getDocs(query(collection(db("a"), paths.collection("org-a", "notificationDeliveries")), limit(5))));
  for (const uid of ["a", "ownerRole", "adminRole", "assistantRole"]) {
    await deniedBecause(`${uid} planejando entrega pelo navegador`, setDoc(deliveryOf(uid, `planejada-${uid}`), delivery()));
    await deniedBecause(`${uid} marcando envio que nao saiu`, updateDoc(deliveryOf(uid, "envio"), { status: "SENT", attempts: 1, sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    await deniedBecause(`${uid} zerando tentativas`, updateDoc(deliveryOf(uid, "envio"), { attempts: 0, nextAttemptAt: null }));
    await deniedBecause(`${uid} cancelando pelo navegador`, updateDoc(deliveryOf(uid, "envio"), { status: "CANCELLED", cancelledAt: new Date().toISOString() }));
  }
  await denied(setDoc(deliveryOf("a", "forjado"), delivery({ status: "SENT", attempts: 1, sentAt: new Date().toISOString() })));
  await denied(setDoc(deliveryOf("a", "forjado"), delivery({ attempts: 3 })));
  await denied(updateDoc(deliveryOf("a", "envio"), { bodyHash: "00000000" }));
  await denied(updateDoc(deliveryOf("a", "envio"), { channel: "WHATSAPP" }));
  await denied(deleteDoc(deliveryOf("ownerRole", "envio")));

  // Fila de automacao: mecanismo do backend. Ninguem le nem escreve pelo
  // cliente — nem o OWNER, nem para forjar alerta ou trilha como se viessem da
  // automacao.
  const task = extra => ({ organizationId: "org-a", type: "SEND_REMINDER", status: "PLANNED", attempt: 1, ...extra });
  const taskOf = (uid, id) => doc(db(uid), paths.document("org-a", "automationTasks", id));
  // O painel da fila (13.9): quem tem `automationQueue:read` LE.
  await allowed(getDoc(taskOf("a", "example")));
  await allowed(getDoc(taskOf("adminRole", "example")));
  await deniedBecause("assistente lendo a fila", getDoc(taskOf("assistantRole", "example")));
  await deniedBecause("fila de outra organizacao", getDoc(doc(db("a"), paths.document("org-b", "automationTasks", "example"))));
  // A chave de emergencia: administracao e titular leem; ninguem escreve.
  await allowed(getDoc(doc(db("adminRole"), paths.document("org-a", "automationSwitches", "organization"))));
  await deniedBecause("assistente lendo a chave", getDoc(doc(db("assistantRole"), paths.document("org-a", "automationSwitches", "organization"))));
  await deniedBecause("desligando a chave pelo navegador", setDoc(doc(db("ownerRole"), paths.document("org-a", "automationSwitches", "organization")), { organizationId: "org-a", enabled: false }));

  for (const uid of ["a", "ownerRole", "adminRole"]) {
    await deniedBecause(`${uid} criando tarefa`, setDoc(taskOf(uid, `nova-${uid}`), task()));
    await deniedBecause(`${uid} concluindo tarefa`, updateDoc(taskOf(uid, "example"), { status: "SUCCEEDED" }));
    await deniedBecause(`${uid} apagando tarefa`, deleteDoc(taskOf(uid, "example")));
  }
  await deniedBecause("alerta forjado pelo navegador", setDoc(taskOf("ownerRole", "alerta-forjado"), task({ type: "RAISE_ALERT", status: "SUCCEEDED" })));
  await deniedBecause("trilha forjada pelo navegador", setDoc(taskOf("adminRole", "trilha-forjada"), task({ type: "WRITE_AUDIT", status: "SUCCEEDED" })));
  await deniedBecause("fila sem o modulo de agenda", getDoc(taskOf("restricted", "example")));

  // Catalogo de servicos (E2.1): quem tem a agenda LE; quem atende ou
  // administra ESCREVE; quem so apoia nao mexe no preco do trabalho.
  const servicoOf = (uid, id = "manicure") => doc(db(uid), paths.document("org-a", "services", id));
  const servico = (extra) => ({ organizationId: "org-a", name: "Novo servico", durationMinutes: 30, priceInCents: 4000, enabled: false, position: 1, archivedAt: null, ...extra });
  await allowed(getDoc(servicoOf("a")));
  await allowed(getDoc(servicoOf("assistantRole")));
  await allowed(setDoc(servicoOf("a", "novo-do-profissional"), servico()));
  await allowed(updateDoc(servicoOf("adminRole"), { priceInCents: 6000 }));
  await deniedBecause("assistente criando servico", setDoc(servicoOf("assistantRole", "do-assistente"), servico()));
  await deniedBecause("assistente mudando preco", updateDoc(servicoOf("assistantRole"), { priceInCents: 1 }));
  await deniedBecause("leitor apagando servico", deleteDoc(servicoOf("viewerRole")));
  await deniedBecause("catalogo sem o modulo de agenda", getDoc(servicoOf("restricted")));
  await deniedBecause("servico de outra organizacao", getDoc(doc(db("a"), paths.document("org-b", "services", "manicure"))));
  await deniedBecause(
    "servico gravado dentro de outro tenant",
    setDoc(doc(db("a"), paths.document("org-a", "services", "tenant-trocado")), servico({ organizationId: "org-b" })),
  );

  // Endereco do atendimento a domicilio (E2.3). E dado pessoal, entao o
  // formato passa pelas regras tambem: a tela nao e a barreira.
  const visita = (extra) => ({ organizationId: "org-a", clientId: "cliente-1", professionalId: "a", startsAt: "2027-01-01T13:00:00.000Z", modality: "HOME_VISIT", status: "SCHEDULED", priceInCents: 20000, ...extra });
  const agendaDe = (uid, id) => doc(db(uid), paths.document("org-a", "appointments", id));
  await allowed(
    setDoc(agendaDe("a", "visita-valida"), visita({ visitAddress: "Rua das Flores, 100, apto 2" })),
  );
  await allowed(setDoc(agendaDe("a", "visita-sem-endereco"), visita({ visitAddress: null })));
  await deniedBecause(
    "endereco curto demais",
    setDoc(agendaDe("a", "visita-curta"), visita({ visitAddress: "Rua A" })),
  );
  await deniedBecause(
    "endereco longo demais",
    setDoc(agendaDe("a", "visita-longa"), visita({ visitAddress: "R".repeat(201) })),
  );
  await deniedBecause(
    "endereco que nao e texto",
    setDoc(agendaDe("a", "visita-numero"), visita({ visitAddress: 12345 })),
  );
  await deniedBecause(
    "endereco invalido chegando por alteracao",
    updateDoc(agendaDe("a", "visita-valida"), { visitAddress: "curto" }),
  );
  // Agenda externa (13.7). A conexao guarda token cifrado: ninguem le pelo
  // cliente, nem a propria pessoa. O ocupado, que e so faixa de tempo, abre
  // para quem tem o modulo de agenda.
  for (const uid of ["a", "ownerRole", "adminRole"]) {
    await deniedBecause(`${uid} lendo a conexao de agenda`, getDoc(doc(db(uid), paths.document("org-a", "calendarConnections", "a"))));
    await deniedBecause(`${uid} gravando conexao de agenda`, setDoc(doc(db(uid), paths.document("org-a", "calendarConnections", uid)), { organizationId: "org-a", professionalId: uid, status: "CONNECTED" }));
  }
  await allowed(getDoc(doc(db("a"), paths.document("org-a", "calendarBusyBlocks", "a"))));
  await deniedBecause("ocupado sem o modulo de agenda", getDoc(doc(db("restricted"), paths.document("org-a", "calendarBusyBlocks", "a"))));
  await deniedBecause("gravando ocupado pelo navegador", setDoc(doc(db("ownerRole"), paths.document("org-a", "calendarBusyBlocks", "a")), { organizationId: "org-a", blocks: [] }));
  await deniedBecause("ocupado de outra organizacao", getDoc(doc(db("a"), paths.document("org-b", "calendarBusyBlocks", "a"))));

  // Pedido de remarcacao (13.6): ninguem le nem escreve pelo cliente. Segurar
  // horario sem pedido, ou confirmar horario que nunca foi oferecido, comecaria
  // por uma escrita aqui.
  const pedidoOf = (uid) => doc(db(uid), paths.document("org-a", "rescheduleRequests", "conversa"));
  for (const uid of ["a", "ownerRole", "adminRole"]) {
    await deniedBecause(`${uid} lendo pedido de remarcacao`, getDoc(pedidoOf(uid)));
    await deniedBecause(`${uid} segurando horario`, setDoc(pedidoOf(uid), { organizationId: "org-a", status: "OFFERED" }));
    await deniedBecause(`${uid} confirmando horario`, updateDoc(pedidoOf(uid), { status: "CONFIRMED" }));
    await deniedBecause(`${uid} apagando pedido`, deleteDoc(pedidoOf(uid)));
  }

  // Remetente de canal real (13.4): quem administra a organizacao LE — precisa
  // saber qual numero aparece para quem e atendido —, e NINGUEM escreve pelo
  // cliente. Se a organizacao escrevesse aqui, ela se declararia habilitada a
  // falar em nome de qualquer numero, que e exatamente o que o cadastro pela
  // operadora existe para impedir.
  const senderOf = (uid) => doc(db(uid), paths.document("org-a", "messagingSenders", "WHATSAPP"));
  const sender = (extra) => ({ organizationId: "org-a", channel: "WHATSAPP", providerId: "N8N_BRIDGE", providerSenderId: "999", displayNumber: "+5511999990000", displayName: "Forjado", status: "APPROVED", mode: "PRODUCTION", testRecipients: [], ...extra });
  await allowed(getDoc(senderOf("ownerRole")));
  await allowed(getDoc(senderOf("adminRole")));
  await deniedBecause("profissional lendo o remetente", getDoc(senderOf("a")));
  await deniedBecause("assistente lendo o remetente", getDoc(senderOf("assistantRole")));
  for (const uid of ["a", "ownerRole", "adminRole"]) {
    await deniedBecause(`${uid} cadastrando remetente`, setDoc(doc(db(uid), paths.document("org-a", "messagingSenders", "SMS")), sender({ channel: "SMS" })));
    await deniedBecause(`${uid} aprovando o proprio remetente`, updateDoc(senderOf(uid), { status: "APPROVED", mode: "PRODUCTION" }));
    await deniedBecause(`${uid} apagando o remetente`, deleteDoc(senderOf(uid)));
  }
  await deniedBecause("remetente de outra organizacao", getDoc(doc(db("a"), paths.document("org-b", "messagingSenders", "WHATSAPP"))));

  const whatsappConnection = doc(db("ownerRole"), paths.document("org-a", "whatsappConnections", "WHATSAPP"));
  await deniedBecause("titular lendo a conexão do WhatsApp", getDoc(whatsappConnection));
  await deniedBecause("titular escrevendo a conexão do WhatsApp", setDoc(whatsappConnection, { organizationId: "org-a", status: "VALIDATED" }));
  await deniedBecause("titular apagando a conexão do WhatsApp", deleteDoc(whatsappConnection));

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
  for (const name of ["professionals", "clients", "appointments", "conversations", "transactions", "aiRules", "aiDecisions", "notifications", "notificationDeliveries", "automationTasks", "messagingSenders", "whatsappConnections", "rescheduleRequests", "calendarConnections", "calendarBusyBlocks", "automationSwitches", "services", "aiDecisionReviews", "recurringCharges", "paymentLinks", "paymentProofs", "receipts", "receiptSettings", "receiptCounters", "auditLogs"]) {
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
  await denied(getDocs(collection(tag(environment.unauthenticatedContext().firestore(), "anonimo"), paths.platformPlans())));

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

  // ------------------------------------------------------------- Etapa A.7
  // Pedido de troca de profissao: o titular le o proprio, a operadora le todos,
  // e ninguem escreve pelo cliente — trocar a profissao pela tela mudaria
  // vocabulario, taxonomia e travas de aviso de uma vez.

  await allowed(getDoc(doc(db("a"), paths.platformProfessionRequest("org-a"))));
  await denied(getDoc(doc(db("a"), paths.platformProfessionRequest("org-b"))));
  await denied(getDoc(doc(db("restricted"), paths.platformProfessionRequest("org-a"))));
  await allowed(getDocs(collection(withTotp("admin"), paths.platformProfessionRequests())));
  await denied(getDocs(collection(db("admin"), paths.platformProfessionRequests())));
  await denied(setDoc(doc(db("a"), paths.platformProfessionRequest("org-a")), { organizationId: "org-a", status: "APPROVED" }));
  await denied(updateDoc(doc(db("a"), paths.platformProfessionRequest("org-a")), { status: "APPROVED" }));
  await denied(updateDoc(doc(withTotp("admin"), paths.platformProfessionRequest("org-a")), { status: "APPROVED" }));
  await denied(deleteDoc(doc(db("a"), paths.platformProfessionRequest("org-a"))));

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

  const aiSettings = { enabled: true, displayName: "Dara", autoResponseConfidenceThreshold: 0.8, allowAutonomousReplies: false, quietHoursStart: null, quietHoursEnd: null };
  await allowed(updateDoc(doc(db("adminRole"), orgA()), { "settings.ai": aiSettings }));
  await allowed(updateDoc(doc(db("ownerRole"), orgA()), { "settings.ai": { ...aiSettings, quietHoursStart: "22:00", quietHoursEnd: "07:00" } }));
  await denied(updateDoc(doc(db("a"), orgA()), { "settings.ai": aiSettings }));
  await denied(updateDoc(doc(db("b"), orgA()), { "settings.ai": aiSettings }));
  await denied(updateDoc(doc(db("adminRole"), orgA()), { "settings.ai": { ...aiSettings, autoResponseConfidenceThreshold: 0.1 } }));
  await denied(updateDoc(doc(db("adminRole"), orgA()), { "settings.ai": { ...aiSettings, quietHoursStart: "25:00" } }));
  await denied(updateDoc(doc(db("adminRole"), orgA()), { "settings.ai": { ...aiSettings, quietHoursStart: "22:00", quietHoursEnd: "22:00" } }));
  await denied(updateDoc(doc(db("adminRole"), orgA()), { "settings.ai": { ...aiSettings, enabled: "true" } }));

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

  // Cobertura por papel: lida do proprio arquivo de regras, para que uma colecao
  // nova entre na conta sem ninguem lembrar de acrescenta-la aqui.
  const COLLECTIONS = [...readFileSync("firestore.rules", "utf8").matchAll(/match \/(\w+)\/\{/g)]
    .map((match) => match[1])
    .filter((name) => name !== "databases");
  console.log("Negacoes testadas por colecao:");
  const lacunas = [];
  for (const name of [...new Set(COLLECTIONS)].sort()) {
    const roles = deniedBy.get(name) ?? new Set();
    console.log(`  ${name.padEnd(24)} ${[...roles].sort().join(", ") || "(nenhuma)"}`);
    for (const role of ["tenant", "operadora"]) if (!roles.has(role)) lacunas.push(`${name}: falta negacao para ${role}`);
  }
  assert.deepEqual(lacunas, [], "colecao sem negacao testada por papel");
  assert.equal(checks, 459);
  console.log(`${checks} verificacoes das Security Rules passaram no emulador.`);
} finally { await environment.cleanup(); }
