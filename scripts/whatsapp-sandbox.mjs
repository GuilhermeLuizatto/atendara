import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  unlink,
  rmdir,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { messagePath, paths } from "../functions/generated/paths.js";
import {
  PHONE,
  metaEvent,
  rescheduleButton,
  rescheduleText,
  seedInbound,
  seedReschedule,
  seedTask,
} from "./whatsapp-sandbox-fixtures.mjs";
import { createN8nBridgeProvider } from "../functions/generated/notifications-providers-n8n-bridge.js";
import { providerFor } from "../functions/generated/notifications-providers.js";

// O sandbox não pode usar um projeto real nem alcançar um Firestore remoto.
assert.match(
  process.env.FIRESTORE_EMULATOR_HOST ?? "",
  /^(127\.0\.0\.1|localhost):\d+$/,
);
assert.equal(process.env.GCLOUD_PROJECT, "demo-atendara");
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const express = require("express");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const run = promisify(execFile);
const docker = async (...args) =>
  (await run("docker", args, { timeout: 90000, maxBuffer: 4 * 1024 * 1024 }))
    .stdout;
const secret = () => randomBytes(32).toString("hex");
const taskSecret = secret();
const callbackSecret = secret();
const metaSecret = secret();
const verifyToken = secret();
process.env.N8N_CALLBACK_SECRET = callbackSecret;
process.env.META_APP_SECRET = metaSecret;
const { inboundWebhook } = await import("../functions/inbound.js");
const { automationCallback } =
  await import("../functions/automation-callback.js");
const { runAutomationTask } = await import("../functions/automation.js");
const app = initializeApp({ projectId: "demo-atendara" });
const db = getFirestore(app);
const org = `whatsapp-sandbox-${Date.now()}`;
const other = `${org}-other`;
const rescheduleOrg = `${org}-remarcacao`;
// O que o backend pediu à Cloud Tasks, capturado pelo endereço de emulador.
const queuedTasks = [];
const container = org;
const checks = [];
const providerCalls = [];
let server;
let directory;
let containerStarted = false;
let providerError = false;
const record = (name) => {
  checks.push(name);
  console.log(`OK: ${name}`);
};
const ref = (collection, id, scope = org) =>
  db.doc(paths.document(scope, collection, id));
const hmac = (key, value) =>
  createHmac("sha256", key).update(value).digest("hex");
const request = (url, options) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
const signed = (body, key, timestamp = new Date().toISOString()) => ({
  "content-type": "application/json",
  "x-atendara-timestamp": timestamp,
  "x-atendara-signature": hmac(key, `${timestamp}.${body}`),
});
async function waitFor(url) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return;
    } catch {
      /* A migração inicial ainda pode estar em andamento. */
    }
    await delay(1000);
  }
  throw new Error("O n8n isolado não ficou pronto em 60 segundos.");
}

try {
  await seedInbound(db, org, other, new Date().toISOString());
  const backend = express();
  backend.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, bytes) => {
        req.rawBody = bytes;
      },
    }),
  );
  backend.post("/inbound", inboundWebhook);
  backend.post("/callback", automationCallback);
  // Emulador mínimo da Cloud Tasks: guarda o ponteiro em vez de agendar. O
  // sandbox chama o despachante com ele, na hora, para ver o caminho inteiro.
  backend.post("/projects/:project/locations/:location/queues/:queue/tasks", (req, res) => {
    const task = req.body?.task ?? {};
    const encoded = task.httpRequest?.body;
    const data = encoded ? JSON.parse(Buffer.from(encoded, "base64").toString("utf8")).data : null;
    if (data) queuedTasks.push(data);
    res.json({ name: task.name ?? `sandbox-${queuedTasks.length}` });
  });
  backend.post("/fake-meta", (req, res) => {
    providerCalls.push(req.body);
    if (providerError)
      res
        .status(400)
        .json({ error: { code: 130497, message: "Erro fictício" } });
    else res.json({ messages: [{ id: "wamid.sandbox-outbound" }] });
  });
  // O Docker Desktop precisa alcançar este servidor temporário pelo gateway do host.
  server = backend.listen(0, "0.0.0.0");
  await once(server, "listening");
  const callbackBase = `http://host.docker.internal:${server.address().port}`;
  const localBase = `http://127.0.0.1:${server.address().port}`;
  // A fila do backend vai para o emulador mínimo acima, nunca para o Google.
  process.env.CLOUD_TASKS_EMULATOR_HOST = `127.0.0.1:${server.address().port}`;
  await mkdir(resolve(root, ".local"), { recursive: true });
  directory = await mkdtemp(resolve(root, ".local/whatsapp-sandbox-"));
  const workflows = [];
  for (const [id, file] of [
    ["sandboxInbound", "atendara-whatsapp-inbound.json"],
    ["sandboxOutbound", "atendara-whatsapp.json"],
  ]) {
    const workflow = JSON.parse(
      await readFile(resolve(root, "automation/n8n", file), "utf8"),
    );
    workflow.id = id;
    workflow.active = false;
    workflow.settings.saveDataErrorExecution = "none";
    // Só o destino HTTP muda: tradução, assinatura e callback são os do fluxo versionado.
    const send = workflow.nodes.find(
      (node) => node.name === "Enviar pela Cloud API",
    );
    if (send) send.parameters.url = `${callbackBase}/fake-meta`;
    workflows.push(workflow);
  }
  await writeFile(
    resolve(directory, "workflows.json"),
    JSON.stringify(workflows),
  );
  await writeFile(
    resolve(directory, "sandbox.env"),
    [
      `ATENDARA_TASK_SECRET=${taskSecret}`,
      `ATENDARA_CALLBACK_SECRET=${callbackSecret}`,
      `ATENDARA_META_VERIFY_TOKEN=${verifyToken}`,
      "ATENDARA_META_TOKEN=sandbox-ficticio",
      `ATENDARA_INBOUND_CALLBACK_URL=${callbackBase}/inbound`,
      `ATENDARA_CALLBACK_URL=${callbackBase}/callback`,
      "NODE_FUNCTION_ALLOW_BUILTIN=crypto",
      "N8N_DIAGNOSTICS_ENABLED=false",
      "N8N_VERSION_NOTIFICATIONS_ENABLED=false",
      "EXECUTIONS_DATA_SAVE_ON_SUCCESS=none",
      "EXECUTIONS_DATA_SAVE_ON_ERROR=none",
      "N8N_SECURE_COOKIE=false",
    ].join("\n"),
  );
  console.log(
    "Iniciando um n8n descartável, com provedor fictício e banco emulado...",
  );
  await docker(
    "run",
    "--rm",
    "-d",
    "--name",
    container,
    "--memory=768m",
    "--cpus=2",
    "-p",
    "127.0.0.1::5678",
    "--env-file",
    resolve(directory, "sandbox.env"),
    "--mount",
    `type=bind,source=${directory},target=/fixtures,readonly`,
    "n8nio/n8n:1.109.2",
  );
  containerStarted = true;
  const port = (await docker("port", container, "5678/tcp"))
    .trim()
    .split(":")
    .at(-1);
  let base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/healthz`);
  await docker(
    "exec",
    container,
    "n8n",
    "import:workflow",
    "--input=/fixtures/workflows.json",
  );
  await docker(
    "exec",
    container,
    "n8n",
    "update:workflow",
    "--all",
    "--active=true",
  );
  await docker("restart", container);
  const restartedPort = (await docker("port", container, "5678/tcp"))
    .trim()
    .split(":")
    .at(-1);
  base = `http://127.0.0.1:${restartedPort}`;
  await waitFor(`${base}/healthz`);
  const inbound = `${base}/webhook/atendara-whatsapp-inbound`;
  const outbound = `${base}/webhook/atendara-whatsapp`;
  const postMeta = (event, valid = true) => {
    const body = JSON.stringify(event);
    return request(inbound, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${hmac(valid ? metaSecret : "invalid", body)}`,
      },
      body,
    });
  };
  const challenge = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": verifyToken,
    "hub.challenge": "sandbox-ok",
  });
  // O processo responde ao healthcheck antes de registrar os webhooks ativos.
  await waitFor(`${inbound}?${challenge}`);
  const verified = await request(`${inbound}?${challenge}`);
  assert.equal(verified.status, 200);
  assert.equal(await verified.text(), "sandbox-ok");
  challenge.set("hub.verify_token", "invalid");
  assert.equal((await request(`${inbound}?${challenge}`)).status, 403);
  record(
    "Desafio do webhook: token correto aceito e incorreto recusado",
  );

  assert.equal(
    (await postMeta(metaEvent("wamid.forged", "Olá"), false)).status,
    503,
  );
  const raw = JSON.stringify(metaEvent("wamid.direct", "Olá"));
  for (const headers of [
    signed(raw, "invalid"),
    signed(raw, callbackSecret, "2000-01-01T00:00:00.000Z"),
  ]) {
    assert.equal(
      (
        await request(`${localBase}/inbound`, {
          method: "POST",
          headers,
          body: raw,
        })
      ).status,
      401,
    );
  }
  assert.equal(
    (await db.collection(paths.collection(org, "conversations")).get()).size,
    0,
  );
  record(
    "Assinatura Meta falsa, assinatura da ponte falsa e repasse vencido não gravam conversa",
  );

  assert.equal(
    (await postMeta(metaEvent("wamid.admin", "Qual o horário de atendimento?")))
      .status,
    200,
  );
  const admin = (
    await db.doc(messagePath(org, "wa-client", "wa-wamid.admin")).get()
  ).data();
  assert.equal(admin.classification, "ADMINISTRATIVE");
  record(
    "Mensagem administrativa percorre n8n e persiste na subcoleção correta",
  );

  const risk = metaEvent("wamid.risk", "não consigo mais, penso em me matar");
  const repeated = await Promise.all([postMeta(risk), postMeta(risk)]);
  assert.ok(repeated.every((response) => response.status === 200));
  const alert = (
    await ref("notifications", "wa-wamid.risk-alerta").get()
  ).data();
  assert.equal(alert.priority, "CRITICAL");
  assert.equal(
    (await ref("conversations", "wa-client").get()).data().unreadCount,
    2,
  );
  assert.equal(
    (await ref("aiDecisions", "wa-wamid.risk-decision").get()).data()
      .responseText,
    null,
  );
  assert.equal(
    (await db.collection(paths.collection(other, "conversations")).get()).size,
    0,
  );
  record(
    "Reentrega concorrente de risco gera um alerta, sem resposta automática nem vazamento entre organizações",
  );

  assert.equal(
    (await postMeta(metaEvent("wamid.blocked", "Olá", "+5500900000002")))
      .status,
    200,
  );
  assert.equal(
    (await db.collection(paths.collection(org, "conversations")).get()).size,
    1,
  );
  record("Contato fora da lista de teste não cria conversa");

  assert.equal((await postMeta(metaEvent("wamid.optout", "SAIR"))).status, 200);
  const client = (await ref("clients", "client").get()).data();
  assert.ok(client.notificationConsent.channels.WHATSAPP[0].withdrawn);
  assert.deepEqual(client.notificationConsent.channels.EMAIL, []);
  assert.equal(client.administrativeNotes, "Preservar cadastro");
  assert.equal(
    (await ref("clients", "client", other).get()).data().notificationConsent
      .channels.WHATSAPP[0].withdrawn,
    null,
  );
  assert.ok((await ref("auditLogs", "wa-wamid.optout-consent").get()).exists);
  record("SAIR revoga só WhatsApp da organização correta e registra auditoria");

  const task = await seedTask(db, org, "outbound-ok");
  const sendTask = (value, key = taskSecret) => {
    const body = JSON.stringify(value);
    return request(outbound, {
      method: "POST",
      headers: signed(body, key),
      body,
    });
  };
  assert.equal((await sendTask(task, "invalid")).status, 401);
  assert.equal((await sendTask({ ...task, template: undefined })).status, 401);
  assert.equal(
    (await sendTask({ ...task, providerSenderId: undefined })).status,
    401,
  );
  assert.equal(providerCalls.length, 0);
  record("Saída sem assinatura, modelo ou remetente não alcança o provedor");

  assert.equal((await sendTask(task)).status, 200);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].to, PHONE.slice(1));
  assert.equal(providerCalls[0].template.name, "sandbox_reminder");
  assert.equal(
    (await ref("automationTasks", task.taskId).get()).data().status,
    "SUCCEEDED",
  );
  assert.equal(
    (await ref("notificationDeliveries", task.deliveryId).get()).data().status,
    "SENT",
  );
  record(
    "Modelo percorre fluxo real do n8n, provedor fictício e callback assinado até concluir tarefa e aviso",
  );

  const before = (await db.collection(paths.collection(org, "auditLogs")).get())
    .size;
  const callback = JSON.stringify({
    version: 1,
    taskId: task.taskId,
    organizationId: org,
    attempt: 1,
    outcome: "ACCEPTED",
    providerMessageId: "wamid.sandbox-outbound",
    failureCode: null,
  });
  assert.equal(
    (
      await request(`${localBase}/callback`, {
        method: "POST",
        headers: signed(callback, callbackSecret),
        body: callback,
      })
    ).status,
    200,
  );
  assert.equal(
    (await db.collection(paths.collection(org, "auditLogs")).get()).size,
    before,
  );
  record("Callback repetido não duplica auditoria");

  providerError = true;
  const rejected = await seedTask(db, org, "outbound-rejected");
  assert.equal((await sendTask(rejected)).status, 200);
  const failed = (await ref("automationTasks", rejected.taskId).get()).data();
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failureCode, "SENDER_NOT_ALLOWED");
  record(
    "Restrição geográfica do provedor encerra a tarefa com código correto",
  );

  // --- Remarcação de ponta a ponta: a resposta da assistente pelo caminho real.
  // Organização própria, com remetente e telefone próprios: o cenário SAIR acima
  // retirou o consentimento do contato da organização principal.
  // O cenário anterior deixa a Meta fictícia recusando; aqui ela volta a aceitar.
  providerError = false;
  const reschedule = await seedReschedule(db, rescheduleOrg, new Date().toISOString());
  const bridge = createN8nBridgeProvider({
    webhookUrl: outbound,
    sign: (timestamp, body) => hmac(taskSecret, `${timestamp}.${body}`),
  });
  const providers = (channel) => providerFor(channel, { N8N_BRIDGE: () => bridge });
  const dispatch = (pointer) =>
    runAutomationTask(pointer, { providers, enqueue: async (payload) => queuedTasks.push(payload) });
  const callsBefore = providerCalls.length;

  assert.equal((await postMeta(rescheduleButton("wamid.remarcar", reschedule))).status, 200);
  const offerTask = "wa-wamid.remarcar-resposta";
  const offerPointer = queuedTasks.find((pointer) => pointer.taskId === offerTask);
  assert.ok(offerPointer, "a oferta não chegou à fila");
  const offerOutcome = await dispatch(offerPointer);
  assert.equal(providerCalls.length, callsBefore + 1, "a oferta não chegou ao provedor");
  const offerCall = providerCalls.at(-1);
  assert.equal(offerCall.type, "text");
  assert.equal(offerCall.to, reschedule.phone.slice(1));
  assert.match(offerCall.text.body, /assistente virtual de Consultório do Sandbox/);
  assert.match(offerCall.text.body, /^1\. /m);
  assert.equal(offerCall.template, undefined);
  const offerState = (await ref("automationTasks", offerTask, rescheduleOrg).get()).data();
  assert.equal(offerState.status, "SUCCEEDED", `oferta terminou em ${offerState.status} (${offerOutcome.outcome})`);
  assert.equal(
    (await ref("notificationDeliveries", offerTask, rescheduleOrg).get()).data().status,
    "SENT",
  );
  // Reentrega do mesmo ponteiro pela Cloud Tasks: nada sai de novo.
  await dispatch(offerPointer);
  assert.equal(providerCalls.length, callsBefore + 1);
  record("Remarcar pelo n8n: oferta planejada, despachada e entregue como texto uma vez só");

  assert.equal((await postMeta(rescheduleText("wamid.escolha", "1", reschedule))).status, 200);
  const confirmTask = "wa-wamid.escolha-resposta";
  const confirmPointer = queuedTasks.find((pointer) => pointer.taskId === confirmTask);
  assert.ok(confirmPointer, "a confirmação não chegou à fila");
  await dispatch(confirmPointer);
  assert.equal(providerCalls.length, callsBefore + 2);
  assert.match(providerCalls.at(-1).text.body, /^Pronto! Seu atendimento ficou para /);
  assert.equal((await ref("automationTasks", confirmTask, rescheduleOrg).get()).data().status, "SUCCEEDED");
  const moved = (await ref("appointments", "appointment", rescheduleOrg).get()).data();
  assert.equal(moved.origin, "CLIENT_SELF_SERVICE");
  assert.ok(
    (await ref("auditLogs", "wa-wamid.escolha-remarcado", rescheduleOrg).get()).exists,
    "a remarcação não deixou trilha",
  );
  record("Escolha '1' remarca o atendimento com trilha e a confirmação chega como texto");
  await writeFile(
    resolve(root, ".local/whatsapp-sandbox-result.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mode: "SIMULATED_PROVIDER",
        passed: checks.length,
        checks,
      },
      null,
      2,
    ),
  );
  console.log(
    `Sandbox aprovado: ${checks.length} cenários. Nenhuma mensagem real enviada.`,
  );
} finally {
  if (containerStarted) await docker("rm", "-f", "-v", container);
  if (server) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  for (const id of [org, other, rescheduleOrg])
    await db.recursiveDelete(db.doc(paths.organization(id)));
  await deleteApp(app);
  if (directory) {
    for (const file of ["workflows.json", "sandbox.env"])
      await unlink(resolve(directory, file)).catch(() => {});
    await rmdir(directory);
  }
}
