import { createRequire } from "node:module";

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  terminate,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paths } from "@/lib/firebase/paths";
import { callFunction, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";

/**
 * Etapa 2 do roadmap: a matriz de acesso, provada de ponta a ponta — estendida
 * na 5B com segundo fator da operadora, App Check e o fim do acesso dela aos
 * tenants.
 *
 * As suites anteriores testam as pecas isoladas. Esta encadeia as tres que
 * decidem quem entra: Firebase Auth, as callable functions e as Security Rules.
 *
 * Roda inteira no emulador. Nenhuma conta de producao e tocada, nenhuma senha
 * real aparece aqui: as credenciais abaixo sao literais de teste, validas
 * apenas dentro do emulador local.
 *
 * Rodar com: npm run test:access
 */

const require = createRequire(import.meta.url);
const PROJECT = "demo-atendara";

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9098";
const [FIRESTORE_HOST, FIRESTORE_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087"
).split(":");

const ADMIN = { email: "administrador@atendara.test", password: "SenhaDeTeste-Admin-1" };
const PROFESSIONAL = { email: "profissional@atendara.test" };
const NEW_PASSWORD = "SenhaDeTeste-Profissional-2";
const OTHER_TENANT = "org-de-outro-profissional";
const MODULES = ["dashboard", "agenda", "clientes"];

/** SDK administrativo: semeia e inspeciona sem passar pelas regras. */
const admin = require("../../../functions/node_modules/firebase-admin/lib/index.js");

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
/** A operadora com TOTP — o token que o emulador de Auth nao sabe emitir. */
let operator: TokenSession;

let adminUid: string;
let professionalUid: string;
let temporaryPassword: string;
let organizationId: string;

function futureISO(days = 10): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function signInAsAdmin(): Promise<void> {
  await signInWithEmailAndPassword(auth, ADMIN.email, ADMIN.password);
}

async function signInAsProfessional(password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, PROFESSIONAL.email, password);
}

/** Callable com a sessao do Auth do emulador (senha, sem segundo fator). */
async function callAsSignedIn<Result = unknown>(name: string, data: unknown): Promise<Result> {
  return callFunction<Result>(name, data, { idToken: await auth.currentUser!.getIdToken() });
}

/** Le a conta pelo SDK administrativo, sem depender das regras. */
async function accountOf(uid: string): Promise<Record<string, unknown>> {
  const snapshot = await admin.firestore().doc(paths.account(uid)).get();
  return snapshot.data() as Record<string, unknown>;
}

async function expectDenied(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: "permission-denied" });
}

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = `${FIRESTORE_HOST}:${FIRESTORE_PORT}`;
  admin.initializeApp({ projectId: PROJECT });

  // Operadora, do mesmo jeito que `bootstrap-admin.js` cria em producao: conta
  // no Auth e documento de autoridade no Firestore, sem validade.
  const adminUser = await admin.auth().createUser({
    email: ADMIN.email,
    password: ADMIN.password,
    displayName: "Administrador de Teste",
  });
  adminUid = adminUser.uid;
  await admin.firestore().doc(paths.account(adminUid)).set({
    userId: adminUid,
    email: ADMIN.email,
    displayName: "Administrador de Teste",
    platformRole: "PLATFORM_ADMIN",
    professionId: null,
    organizationId: null,
    modules: ["dashboard", "agenda", "clientes", "mensagens", "financeiro", "agente", "configuracoes"],
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
  });

  // Organizacao de outro profissional, para as tentativas de acesso cruzado.
  await admin.firestore().doc(paths.organization(OTHER_TENANT)).set({
    id: OTHER_TENANT,
    name: "Consultorio Alheio",
    primaryProfession: "DENTIST",
    ownerId: "outro-usuario",
  });
  await admin
    .firestore()
    .doc(paths.document(OTHER_TENANT, "clients", "cadastro-alheio"))
    .set({ organizationId: OTHER_TENANT, fullName: "Cadastro Alheio" });

  app = initializeApp({ projectId: PROJECT, apiKey: "chave-de-emulador" }, "access-tests");
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE_HOST, Number(FIRESTORE_PORT));
  operator = tokenSession(adminUid, "totp");
});

afterAll(async () => {
  await signOut(auth).catch(() => {});
  await operator.dispose();
  await terminate(db);
  await deleteApp(app);
  await Promise.all(admin.apps.map((instance: { delete(): Promise<void> }) => instance.delete()));
});

describe("Etapa 2 — ciclo administrador, profissional e acesso restrito", () => {
  const registration = () => ({
    displayName: "Profissional de Teste",
    email: PROFESSIONAL.email,
    professionId: "PSYCHOLOGIST",
    modules: MODULES,
    initialGrant: { kind: "PILOT", until: futureISO(), reason: "Piloto da matriz de acesso." },
  });

  it("senha da operadora sem segundo fator nao cadastra ninguem", async () => {
    await signInAsAdmin();

    await expect(callAsSignedIn("registerProfessional", registration())).rejects.toMatchObject({
      code: "permission-denied",
    });
    // E a sessao sem fator nao le cadastro nenhum.
    await expectDenied(getDocs(collection(db, paths.accounts())));
  });

  it("sem atestado do App Check a callable recusa antes de olhar quem chama", async () => {
    await expect(
      callFunction("registerProfessional", registration(), { idToken: operator.idToken, appCheck: false }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("so a operadora com segundo fator cadastra profissionais", async () => {
    const result = await operator.call<{ userId: string; temporaryPassword: string }>(
      "registerProfessional",
      registration(),
    );

    professionalUid = result.userId;
    temporaryPassword = result.temporaryPassword;

    expect(professionalUid).toBeTruthy();
    expect(temporaryPassword.length).toBeGreaterThan(12);

    const account = await accountOf(professionalUid);
    organizationId = account.organizationId as string;
    expect(account).toMatchObject({
      platformRole: "PROFESSIONAL",
      professionId: "PSYCHOLOGIST",
      status: "ACTIVE",
      // Aberto pela concessao inicial registrada, e nao por campo solto.
      subscriptionStatus: "ACTIVE",
      mustChangePassword: true,
    });
  });

  it("o cadastro provisiona organizacao, vinculo e perfil profissional", async () => {
    const database = admin.firestore();

    const [organization, member, professional] = await Promise.all([
      database.doc(paths.organization(organizationId)).get(),
      database.doc(paths.document(organizationId, "members", professionalUid)).get(),
      database
        .doc(paths.document(organizationId, "professionals", professionalUid))
        .get(),
    ]);

    expect(organization.data()).toMatchObject({
      primaryProfession: "PSYCHOLOGIST",
      ownerId: professionalUid,
    });
    expect(member.data()).toMatchObject({ role: "PROFESSIONAL", status: "ACTIVE" });
    // Sem este documento a agenda recusaria o primeiro atendimento.
    expect(professional.data()).toMatchObject({
      userId: professionalUid,
      profession: "PSYCHOLOGIST",
      active: true,
    });
  });

  it("com senha inicial pendente o painel fica bloqueado", async () => {
    await signInAsProfessional(temporaryPassword);

    // O proprio perfil e legivel — e o que a tela usa para exigir a troca.
    await expect(
      getDoc(doc(db, paths.account(professionalUid))),
    ).resolves.toBeDefined();

    // Todo o resto e negado enquanto `mustChangePassword` for verdadeiro.
    await expectDenied(
      getDoc(doc(db, paths.document(organizationId, "clients", "qualquer"))),
    );
  });

  it("a nova senha nao pode ser a senha inicial", async () => {
    await expect(
      callAsSignedIn("completeInitialPassword", { password: temporaryPassword }),
    ).rejects.toMatchObject({ code: "invalid-argument" });

    expect(await accountOf(professionalUid)).toMatchObject({
      mustChangePassword: true,
    });
  });

  it("a troca libera o painel e remove o verificador temporario", async () => {
    await callAsSignedIn("completeInitialPassword", { password: NEW_PASSWORD });

    expect(await accountOf(professionalUid)).toMatchObject({
      mustChangePassword: false,
    });
    const verifier = await admin
      .firestore()
      .doc(paths.initialPassword(professionalUid))
      .get();
    expect(verifier.exists).toBe(false);

    // A troca invalida a sessao anterior; a entrada e com a senha definitiva.
    await signInAsProfessional(NEW_PASSWORD);
    await expect(
      getDoc(doc(db, paths.document(organizationId, "clients", "qualquer"))),
    ).resolves.toBeDefined();
  });

  it("o profissional nao alcanca a organizacao de outro", async () => {
    await expectDenied(
      getDoc(doc(db, paths.document(OTHER_TENANT, "clients", "cadastro-alheio"))),
    );
    await expectDenied(
      setDoc(doc(db, paths.document(OTHER_TENANT, "clients", "intruso")), {
        organizationId: OTHER_TENANT,
        fullName: "Intruso",
      }),
    );
    await expectDenied(getDoc(doc(db, paths.organization(OTHER_TENANT))));
  });

  it("mudar a profissao da conta fecha a propria organizacao", async () => {
    // A regra exige que a profissao da conta bata com a da organizacao. Uma
    // conta de dentista nao le o consultorio de psicologia nem sendo o dono.
    await admin
      .firestore()
      .doc(paths.account(professionalUid))
      .update({ professionId: "DENTIST" });

    await expectDenied(
      getDoc(doc(db, paths.document(organizationId, "clients", "qualquer"))),
    );

    await admin
      .firestore()
      .doc(paths.account(professionalUid))
      .update({ professionId: "PSYCHOLOGIST" });
  });

  it("modulo nao concedido bloqueia a colecao correspondente", async () => {
    // O cadastro liberou dashboard, agenda e clientes — nao o financeiro.
    await expect(
      getDoc(doc(db, paths.document(organizationId, "appointments", "qualquer"))),
    ).resolves.toBeDefined();

    await expectDenied(
      getDoc(doc(db, paths.document(organizationId, "transactions", "qualquer"))),
    );
    await expectDenied(
      getDoc(doc(db, paths.document(organizationId, "aiRules", "qualquer"))),
    );
  });

  it("suspensao e vencimento fecham o acesso pelo servidor", async () => {
    const database = admin.firestore();
    const original = await accountOf(professionalUid);

    // Suspender continua sendo ato da operadora, pela callable e com registro.
    await operator.call("updateAccount", { userId: professionalUid, status: "SUSPENDED", modules: MODULES });
    await signInAsProfessional(NEW_PASSWORD);
    await expectDenied(
      getDoc(doc(db, paths.document(organizationId, "clients", "qualquer"))),
    );
    await operator.call("updateAccount", { userId: professionalUid, status: "ACTIVE", modules: MODULES });

    // Validade vencida e assinatura cancelada nao tem mais callable que as
    // escreva: sao preparadas pelo SDK administrativo, como o webhook faria.
    await database.doc(paths.account(professionalUid)).update({
      accessUntil: new Date(Date.now() - 86_400_000).toISOString(),
      accessUntilMs: Date.now() - 86_400_000,
    });
    await expectDenied(
      getDoc(doc(db, paths.document(organizationId, "clients", "qualquer"))),
    );

    await database.doc(paths.account(professionalUid)).update({
      subscriptionStatus: "CANCELLED",
      accessUntil: original.accessUntil,
      accessUntilMs: original.accessUntilMs,
    });
    await expectDenied(
      getDoc(doc(db, paths.document(organizationId, "clients", "qualquer"))),
    );

    // Restaurado, o acesso volta — a trava e a validade, nao um efeito colateral.
    await database.doc(paths.account(professionalUid)).update({
      subscriptionStatus: original.subscriptionStatus,
    });
    await expect(
      getDoc(doc(db, paths.document(organizationId, "clients", "qualquer"))),
    ).resolves.toBeDefined();
  });

  it("o profissional nao promove a propria conta nem abre o proprio acesso", async () => {
    await signInAsProfessional(NEW_PASSWORD);

    // Nem escrevendo direto no documento de autoridade...
    await expectDenied(
      updateDoc(doc(db, paths.account(professionalUid)), {
        platformRole: "PLATFORM_ADMIN",
      }),
    );
    // ...nem forjando um vinculo de proprietario...
    await expectDenied(
      setDoc(doc(db, paths.document(organizationId, "members", professionalUid)), {
        role: "OWNER",
        status: "ACTIVE",
      }),
    );
    // ...nem chamando as funcoes administrativas.
    await expect(
      callAsSignedIn("registerProfessional", {
        displayName: "Conta Forjada",
        email: "forjada@atendara.test",
        professionId: "PSYCHOLOGIST",
        modules: ["dashboard"],
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });

    // Payload valido, sem situacao nem validade: a recusa e por quem chama, e
    // nao por formato.
    await expect(
      callAsSignedIn("updateAccount", {
        userId: professionalUid,
        status: "ACTIVE",
        modules: ["dashboard", "agenda", "clientes", "financeiro", "agente", "mensagens"],
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await expect(
      callAsSignedIn("grantAccess", {
        organizationId,
        kind: "COURTESY",
        until: futureISO(10),
        reason: "Tentativa do proprio profissional.",
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("nem a operadora altera a propria conta por updateAccount", async () => {
    await expect(
      operator.call("updateAccount", {
        userId: adminUid,
        status: "SUSPENDED",
        modules: ["dashboard"],
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("o verificador de senha inicial nunca e legivel pelo cliente", async () => {
    await expectDenied(getDoc(doc(operator.firestore, paths.initialPassword(professionalUid))));

    await signInAsProfessional(NEW_PASSWORD);
    await expectDenied(getDoc(doc(db, paths.initialPassword(professionalUid))));
  });
});

describe("A operadora nao tem acesso operacional", () => {
  it("nem com segundo fator a operadora le ou escreve dado de tenant", async () => {
    const tenantClient = paths.document(organizationId, "clients", "qualquer");

    await expectDenied(getDoc(doc(operator.firestore, tenantClient)));
    await expectDenied(getDoc(doc(operator.firestore, paths.document(OTHER_TENANT, "clients", "cadastro-alheio"))));
    await expectDenied(
      setDoc(doc(operator.firestore, paths.document(organizationId, "clients", "da-operadora")), {
        organizationId,
        fullName: "Escrito pela operadora",
      }),
    );
    await expectDenied(getDoc(doc(operator.firestore, paths.organization(organizationId))));
    await expectDenied(getDoc(doc(operator.firestore, paths.document(organizationId, "auditLogs", "qualquer"))));

    // O que continua com ela: contas, para administrar os cadastros.
    await expect(getDocs(collection(operator.firestore, paths.accounts()))).resolves.toBeDefined();
  });
});
