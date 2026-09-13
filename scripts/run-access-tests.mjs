import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Sobe os emuladores e roda a matriz de acesso.
 *
 * Existe por um motivo so: a cobranca precisa de configuracao no ambiente, e
 * ela NAO pode virar um arquivo `.env` versionado. Os valores abaixo sao
 * literais de emulador — um segredo de webhook ficticio, para provar que a
 * verificacao de assinatura funciona, e um catalogo de precos de brinquedo.
 *
 * `STRIPE_SECRET_KEY` fica deliberadamente AUSENTE: nenhum teste chama a API
 * do gateway, e a ausencia da chave e o que garante que uma suite jamais emita
 * cobranca. As callables de checkout sao exercitadas pelo lado que importa
 * aqui — a autorizacao — e recusam antes de qualquer chamada externa.
 *
 * O processo do emulador herda este ambiente, e o runtime das functions herda
 * do emulador.
 */

const EMULATOR_ENVIRONMENT = {
  STRIPE_WEBHOOK_SECRET: "whsec_apenas_para_o_emulador",
  STRIPE_PRICE_MAP: JSON.stringify({
    "essencial-mensal": "price_emulador_essencial",
    "profissional-mensal": "price_emulador_profissional",
    "profissional-anual": "price_emulador_anual",
  }),
  APP_BASE_URL: "http://127.0.0.1:3000",
};

const firebase = fileURLToPath(
  new URL(
    "../.local/firebase-tools/node_modules/firebase-tools/lib/bin/firebase.js",
    import.meta.url,
  ),
);

const child = spawn(
  process.execPath,
  [
    firebase,
    "emulators:exec",
    "--config",
    "firebase.access-tests.json",
    "--project",
    "demo-atendara",
    "--only",
    // `tasks`: a fila de automacao pede a Cloud Tasks emulada. O emulador
    // executa na hora, sem esperar `scheduleTime`.
    "auth,firestore,functions,tasks",
    "vitest run --config vitest.access.mts",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, ...EMULATOR_ENVIRONMENT },
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
