import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { paths } from "./generated/paths.js";
import { APP_MODULES } from "./generated/access.js";

const projectId = process.argv[2];
if (projectId !== "atendo-a3481") throw new Error("Informe explicitamente o projeto atendo-a3481.");
initializeApp({ credential: applicationDefault(), projectId });
const email = "guilhermeluizatto@gmail.com";
try {
  await getAuth().getUserByEmail(email);
  throw new Error("A conta ja existe. Nao sera sobrescrita nem promovida automaticamente.");
} catch (error) { if (error.code !== "auth/user-not-found") throw error; }
await mkdir(".local", { recursive: true });
const file = await open(".local/firebase-admin-initial-access.txt", "wx");
const password = `At!${randomBytes(24).toString("base64url")}`;
const salt = randomBytes(16).toString("hex");
try {
  const user = await getAuth().createUser({ email, password, displayName: "Guilherme Luizatto" });
  await file.writeFile(`Atendara — conta Firebase\nProjeto: ${projectId}\nEmail: ${email}\nUID: ${user.uid}\nSenha inicial: ${password}\nTroca obrigatoria no primeiro acesso. Nao e a senha do Google.\n`);
  const db = getFirestore(), batch = db.batch();
  batch.create(db.doc(paths.account(user.uid)), { userId: user.uid, email, displayName: "Guilherme Luizatto", platformRole: "PLATFORM_ADMIN", professionId: null, organizationId: null, modules: [...APP_MODULES], status: "ACTIVE", subscriptionStatus: "ACTIVE", accessUntil: null, accessUntilMs: 0, mustChangePassword: true, createdAt: new Date().toISOString() });
  batch.create(db.doc(paths.initialPassword(user.uid)), { salt, hash: scryptSync(password, salt, 32).toString("hex") });
  await batch.commit();
  console.log("Administrador criado. Credencial somente em .local/firebase-admin-initial-access.txt.");
} finally { await file.close(); }
