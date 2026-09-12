import { randomBytes, pbkdf2Sync } from "node:crypto";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";

const password = `At!${randomBytes(18).toString("base64url")}`;
const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex");
const existingEnv = await readFile(".env.local", "utf8").catch(() => "");
if (existingEnv.includes("NEXT_PUBLIC_DEMO_ADMIN_")) throw new Error("Ja existe um administrador local configurado.");
await mkdir(".local", { recursive: true });
await writeFile(".local/admin-initial-access.txt", `Acesso LOCAL de demonstracao do Nexo\nEmail: guilhermeluizatto@gmail.com\nSenha inicial: ${password}\n\nA troca sera exigida no primeiro acesso. Esta senha nao e a senha da conta Google.\nA conta na nuvem depende da configuracao e do provisionamento no Firebase.\n`, { flag: "wx" });
await appendFile(".env.local", `\nNEXT_PUBLIC_DEMO_ADMIN_SALT=${salt}\nNEXT_PUBLIC_DEMO_ADMIN_HASH=${hash}\n`);
console.log("Credencial inicial salva em .local/admin-initial-access.txt; configuracao em .env.local, fora do Git.");

