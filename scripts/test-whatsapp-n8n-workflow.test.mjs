import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = JSON.parse(readFileSync(new URL("../automation/n8n/atendara-whatsapp-inbound.json", import.meta.url), "utf8"));
const node = (name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(`Nó ausente no fluxo: ${name}`);
  return found;
};
const runCode = (name, input, env) => {
  const source = String(node(name).parameters.jsCode);
  const execute = new Function("$input", "$env", "require", source);
  return execute(input, env, createRequire(import.meta.url))[0].json;
};

describe("workflow importável de entrada do WhatsApp", () => {
  it("mantém o fluxo inativo e expõe GET e POST no mesmo caminho, sem persistir sucesso", () => {
    const hooks = workflow.nodes.filter((item) => item.type === "n8n-nodes-base.webhook");
    expect(workflow.active).toBe(false);
    expect(workflow.settings.saveDataSuccessExecution).toBe("none");
    expect(hooks.map((hook) => hook.parameters.httpMethod).sort()).toEqual(["GET", "POST"]);
    expect(hooks.map((hook) => hook.parameters.path)).toEqual([
      "atendara-whatsapp-inbound",
      "atendara-whatsapp-inbound",
    ]);
    expect(hooks.find((hook) => hook.parameters.httpMethod === "POST")?.parameters.options).toEqual({ rawBody: true });
    expect(JSON.stringify(workflow)).not.toContain("META_APP_SECRET");
    for (const item of workflow.nodes) {
      if (typeof item.parameters.jsCode === "string") expect(() => new Function(item.parameters.jsCode)).not.toThrow();
    }
  });

  it("devolve apenas o challenge com modo subscribe e token correspondente", () => {
    const execute = new Function("$input", "$env", node("Conferir token de verificação").parameters.jsCode);
    const accepted = execute(
      { first: () => ({ json: { query: { "hub.mode": "subscribe", "hub.verify_token": "token-de-teste", "hub.challenge": "desafio-123" } } }) },
      { ATENDARA_META_VERIFY_TOKEN: "token-de-teste" },
    )[0].json;
    const rejected = execute(
      { first: () => ({ json: { query: { "hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "desafio-123" } } }) },
      { ATENDARA_META_VERIFY_TOKEN: "token-de-teste" },
    )[0].json;

    expect(accepted).toEqual({ valid: true, challenge: "desafio-123" });
    expect(rejected).toEqual({ valid: false, challenge: "" });
  });

  it("assina o repasse sobre os bytes UTF-8 do corpo bruto e preserva a assinatura Meta", () => {
    const rawBody = '{"object":"whatsapp_business_account","text":"olá"}';
    const encoded = Buffer.from(rawBody, "utf8").toString("base64");
    const metaSignature = `sha256=${"a".repeat(64)}`;
    const secret = "segredo-local-de-teste";
    const result = runCode(
      "Preservar corpo e assinar repasse",
      {
        first: () => ({
          json: { headers: { "x-hub-signature-256": metaSignature } },
          binary: { data: { data: encoded } },
        }),
      },
      { ATENDARA_CALLBACK_SECRET: secret, ATENDARA_INBOUND_CALLBACK_URL: "https://example.test/inboundWebhook" },
    );
    const expected = createHmac("sha256", secret)
      .update(`${String(result.timestamp)}.${rawBody}`)
      .digest("hex");

    expect(result).toMatchObject({ rawBody, metaSignature, bridgeSignature: expected, url: "https://example.test/inboundWebhook" });
  });
});
