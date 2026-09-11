import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { paths } from "./generated/paths.js";
import { APP_MODULES } from "./generated/access.js";

const projectId = process.argv[2];
if (projectId !== "atendo-a3481") throw new Error("Informe explicitamente o projeto atendo-a3481.");
const require = createRequire(import.meta.url);
const firebaseCliAuth = require("../.local/firebase-tools/node_modules/firebase-tools/lib/auth.js");
const firebaseCliApi = require("../.local/firebase-tools/node_modules/firebase-tools/lib/api.js");
const cliAccount = firebaseCliAuth.getGlobalDefaultAccount();
if (!cliAccount?.tokens?.refresh_token) throw new Error("Execute firebase login antes do bootstrap.");
await mkdir(".local", { recursive: true });
const adcPath = resolve(".local", `.firebase-cli-adc-${process.pid}.json`);
await writeFile(adcPath, JSON.stringify({
  type: "authorized_user",
  client_id: firebaseCliApi.clientId(),
  client_secret: firebaseCliApi.clientSecret(),
  refresh_token: cliAccount.tokens.refresh_token,
  quota_project_id: projectId,
}), { flag: "wx" });
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
initializeApp({ credential: applicationDefault(), projectId });
const email = "guilhermeluizatto@gmail.com";
const accessFilePath = ".local/firebase-admin-initial-access.txt";
try {
  let user;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
  let password;
  try {
    const savedAccess = await readFile(accessFilePath, "utf8");
    const savedEmail = savedAccess.match(/^Email: (.+)$/m)?.[1];
    const savedUid = savedAccess.match(/^UID: (.+)$/m)?.[1];
    password = savedAccess.match(/^Senha inicial: (.+)$/m)?.[1];
    if (!user || savedEmail !== email || savedUid !== user.uid || !password) {
      throw new Error("O acesso local existente nao corresponde a conta Firebase; revise manualmente.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (user) throw new Error("A conta Firebase ja existe sem credencial local; revise manualmente.");
    const file = await open(accessFilePath, "wx");
    password = `At!${randomBytes(24).toString("base64url")}`;
    try {
      user = await getAuth().createUser({ email, password, displayName: "Guilherme Luizatto" });
      await file.writeFile(`Atendara — conta Firebase\nProjeto: ${projectId}\nEmail: ${email}\nUID: ${user.uid}\nSenha inicial: ${password}\nTroca obrigatoria no primeiro acesso. Nao e a senha do Google.\n`);
    } finally {
      await file.close();
    }
  }
  const salt = randomBytes(16).toString("hex");
  const db = getFirestore(), batch = db.batch();
  // A operadora nao tem validade: ela nunca alcanca dado de tenant, e situacao
  // e validade so nascem do webhook ou de concessao registrada.
  batch.create(db.doc(paths.account(user.uid)), { userId: user.uid, email, displayName: "Guilherme Luizatto", platformRole: "PLATFORM_ADMIN", professionId: null, organizationId: null, modules: [...APP_MODULES], status: "ACTIVE", mustChangePassword: true, createdAt: new Date().toISOString() });
  batch.create(db.doc(paths.initialPassword(user.uid)), { salt, hash: scryptSync(password, salt, 32).toString("hex") });
  await batch.commit();
  console.log("Administrador criado. Credencial somente em .local/firebase-admin-initial-access.txt.");
} finally {
  await unlink(adcPath).catch(() => {});
}
