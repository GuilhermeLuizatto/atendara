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

let checks = 0;
async function allowed(operation) { await assertSucceeds(operation); checks++; }
async function denied(operation) { await assertFails(operation); checks++; }
try {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const profiles = {
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
    // Membros promovidos a OWNER sem serem o titular (`ownerId`). O papel so
    // alcanca a cobranca com o vinculo ativo.
    for (const [uid, status] of [["ownerRole", "ACTIVE"], ["ownerRoleSuspended", "SUSPENDED"]]) {
      await setDoc(doc(db, paths.account(uid)), account("org-a"));
      await setDoc(doc(db, paths.document("org-a", "members", uid)), { role: "OWNER", status });
    }
    for (const org of ["org-a", "org-b"]) {
      await setDoc(doc(db, paths.organization(org)), { primaryProfession: "PSYCHOLOGIST", ownerId: "a" });
      for (const collection of ["clients", "appointments", "transactions", "aiDecisions", "auditLogs"]) await setDoc(doc(db, paths.document(org, collection, "example")), { organizationId: org });
      await setDoc(doc(db, paths.document(org, "aiRules", "immutable")), { organizationId: org, immutable: true, level: "SYSTEM", enabled: true });
      await setDoc(doc(db, paths.document(org, "conversations", "conv")), { organizationId: org, clientId: "example", status: "OPEN" });
      await setDoc(doc(db, messagePath(org, "conv", "m1")), { organizationId: org, conversationId: "conv", body: "Bom dia", sentAt: new Date() });
      await setDoc(doc(db, paths.document(org, "notifications", "alert")), { organizationId: org, status: "UNREAD", title: "Alerta" });
      await setDoc(doc(db, paths.document(org, "notificationDeliveries", "envio")), { organizationId: org, status: "PLANNED", attempts: 0, sentAt: null, channel: "SMS", event: "APPOINTMENT_REMINDER", bodyHash: "abcdef12", contactHint: "***0000" });
    }
    await setDoc(doc(db, paths.initialPassword("a")), { hash: "test-only" });

    // Cobranca da plataforma: colecoes de raiz, da operadora, fora de qualquer
    // tenant. `org-c` existe so para o caso do dono com mensalidade vencida.
    await setDoc(doc(db, paths.organization("org-c")), { primaryProfession: "PSYCHOLOGIST", ownerId: "ownerExpired" });
    await setDoc(doc(db, paths.platformPlan("profissional-mensal")), { id: "profissional-mensal", priceInCents: 19900 });
    for (const [org, owner] of [["org-a", "a"], ["org-b", "b"], ["org-c", "ownerExpired"]]) {
      await setDoc(doc(db, paths.platformSubscription(org)), { organizationId: org, subscriberUserId: owner, status: "ACTIVE", amountInCents: 19900, currency: "BRL", interval: "MONTH" });
      await setDoc(doc(db, paths.platformInvoice(`in-${org}`)), { id: `in-${org}`, organizationId: org, status: "PAID", amountDueInCents: 19900, issuedAt: new Date().toISOString() });
    }
    await setDoc(doc(db, paths.platformGatewayEvent("evt-1")), { id: "evt-1", type: "invoice.paid", outcome: "APPLIED", organizationId: "org-a", receivedAt: new Date().toISOString() });
    await setDoc(doc(db, paths.platformCustomer("cus_1")), { customerId: "cus_1", organizationId: "org-a", subscriberUserId: "a" });
  });
  const db = uid => environment.authenticatedContext(uid).firestore();
  const own = collection => paths.document("org-a", collection, "example");
  await allowed(getDoc(doc(db("a"), own("clients"))));
  await allowed(getDoc(doc(db("admin"), paths.document("org-b", "clients", "example"))));
  await allowed(getDocs(collection(db("admin"), paths.accounts())));
  await allowed(updateDoc(doc(db("a"), own("clients")), { fullName: "Teste administrativo" }));
  await allowed(setDoc(doc(db("admin"), paths.document("org-b", "members", "new")), { role: "PROFESSIONAL", status: "ACTIVE" }));
  await allowed(setDoc(doc(db("admin"), paths.document("org-b", "aiRules", "custom")), { organizationId: "org-b", immutable: false, level: "PROFESSIONAL" }));
  await denied(getDoc(doc(db("a"), paths.document("org-b", "clients", "example"))));
  await denied(updateDoc(doc(db("a"), paths.account("a")), { platformRole: "PLATFORM_ADMIN" }));
  await denied(setDoc(doc(db("a"), paths.document("org-a", "members", "forged")), { role: "OWNER", status: "ACTIVE" }));
  for (const uid of ["initial", "suspended", "expired", "wrongProfession"]) await denied(getDoc(doc(db(uid), own("clients"))));
  await allowed(getDoc(doc(db("initial"), paths.account("initial"))));
  await allowed(getDoc(doc(db("restricted"), own("clients"))));
  await denied(getDoc(doc(db("restricted"), own("transactions"))));
  await denied(getDoc(doc(db("restricted"), own("appointments"))));
  await denied(updateDoc(doc(db("admin"), paths.document("org-a", "aiRules", "immutable")), { enabled: false }));
  await denied(deleteDoc(doc(db("admin"), paths.document("org-a", "aiRules", "immutable"))));
  for (const collection of ["aiDecisions", "auditLogs"]) {
    await denied(updateDoc(doc(db("admin"), own(collection)), { changed: true }));
    await denied(deleteDoc(doc(db("admin"), own(collection))));
  }
  await denied(setDoc(doc(db("a"), paths.document("org-a", "clients", "foreign")), { organizationId: "org-b" }));
  await denied(getDoc(doc(db("admin"), paths.initialPassword("a"))));
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
  // continua sendo ato administrativo.
  await allowed(updateDoc(doc(db("admin"), paths.organization("org-a")), { "settings.notifications": { enabled: true, verifiedSenderChannels: ["SMS"], rules: [] }, ownerId: "a" }));

  // Trilha de auditoria: o profissional escreve, so a administracao le.
  await allowed(setDoc(doc(db("a"), paths.document("org-a", "auditLogs", "novo")), { organizationId: "org-a", action: "CREATE" }));
  await denied(getDoc(doc(db("a"), own("auditLogs"))));
  await allowed(getDoc(doc(db("admin"), own("auditLogs"))));

  // Perfil profissional exige papel administrativo: por isso o cadastro de
  // profissional e criado pelo backend, e nao pelo aplicativo.
  await denied(setDoc(doc(db("a"), paths.document("org-a", "professionals", "auto")), { organizationId: "org-a", displayName: "Eu mesmo" }));
  await allowed(getDoc(doc(db("a"), paths.organization("org-a"))));
  await denied(getDoc(doc(db("a"), paths.organization("org-b"))));
  // ------------------------------------------------------------- Etapa 3
  // Cobranca da plataforma. Duas coisas para provar: o assinante alcanca a
  // PROPRIA cobranca e nada alem dela, e NINGUEM escreve — nem o administrador
  // da plataforma. Ativar assinatura e estender validade sao consequencia de
  // evento assinado, aplicado pelo backend com o SDK administrativo.

  const invoicesOf = (uid, org) => query(collection(db(uid), paths.platformInvoices()), where("organizationId", "==", org));

  // Leitura: cada um enxerga o que lhe cabe.
  await allowed(getDoc(doc(db("a"), paths.platformSubscription("org-a"))));
  await denied(getDoc(doc(db("a"), paths.platformSubscription("org-b"))));
  await allowed(getDoc(doc(db("admin"), paths.platformSubscription("org-b"))));
  await allowed(getDocs(collection(db("admin"), paths.platformSubscriptions())));
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
  await allowed(getDocs(collection(db("admin"), paths.platformInvoices())));

  // Trilha de eventos e indice de clientes: auditoria da operadora.
  await allowed(getDocs(collection(db("admin"), paths.platformGatewayEvents())));
  await denied(getDocs(collection(db("a"), paths.platformGatewayEvents())));
  await denied(getDoc(doc(db("a"), paths.platformCustomer("cus_1"))));
  await denied(getDoc(doc(db("admin"), paths.platformCustomer("cus_1"))));

  // Escrita: negada para todo mundo, em todas as colecoes.
  await denied(setDoc(doc(db("a"), paths.platformSubscription("org-a")), { organizationId: "org-a", status: "ACTIVE" }));
  await denied(setDoc(doc(db("admin"), paths.platformSubscription("org-a")), { organizationId: "org-a", status: "ACTIVE" }));
  await denied(updateDoc(doc(db("a"), paths.platformSubscription("org-a")), { accessUntil: "2099-01-01T00:00:00.000Z" }));
  await denied(updateDoc(doc(db("admin"), paths.platformInvoice("in-org-a")), { status: "PAID" }));
  await denied(setDoc(doc(db("a"), paths.platformInvoice("in-forjada")), { organizationId: "org-a", status: "PAID" }));
  await denied(setDoc(doc(db("admin"), paths.platformGatewayEvent("evt-forjado")), { id: "evt-forjado", outcome: "APPLIED" }));
  await denied(setDoc(doc(db("admin"), paths.platformPlan("plano-forjado")), { priceInCents: 1 }));
  await denied(deleteDoc(doc(db("a"), paths.platformSubscription("org-a"))));
  await denied(setDoc(doc(db("admin"), paths.platformCustomer("cus_2")), { organizationId: "org-a" }));

  assert.equal(checks, 118);
  console.log(`${checks} verificacoes das Security Rules passaram no emulador.`);
} finally { await environment.cleanup(); }

