import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
const jdkRoot = resolve(root, ".local/jdk");
if (!env.JAVA_HOME && existsSync(jdkRoot)) {
  const name = readdirSync(jdkRoot).find((item) =>
    existsSync(
      resolve(
        jdkRoot,
        item,
        "bin",
        process.platform === "win32" ? "java.exe" : "java",
      ),
    ),
  );
  if (name) env.JAVA_HOME = resolve(jdkRoot, name);
}
if (env.JAVA_HOME) {
  const key =
    Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
  env[key] = `${resolve(env.JAVA_HOME, "bin")}${delimiter}${env[key] ?? ""}`;
}
function run(args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(new Error(`Comando terminou com código ${code}.`)),
    );
  });
}

await run(["scripts/build-functions.mjs"]);
await run([
  ".local/firebase-tools/node_modules/firebase-tools/lib/bin/firebase.js",
  "emulators:exec",
  "--config",
  "firebase.repository-tests.json",
  "--project",
  "demo-atendara",
  "--only",
  "firestore",
  "node scripts/whatsapp-sandbox.mjs",
]);
