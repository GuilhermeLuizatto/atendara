import { describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_VERSION, metaCloudProviderFrom } from "./meta-cloud-api.js";

/**
 * A metade com segredo do provedor da Cloud API.
 *
 * O que estes testes protegem: sem token nao existe provedor — e o canal que
 * pedir a Cloud API falha fechado em vez de sair por outro caminho —, e o
 * token nunca aparece em lugar nenhum alem do cabecalho de autorizacao.
 */

function respondeuComOCabecalho() {
  const chamadas = [];
  const fetchImpl = async (url, init) => {
    chamadas.push({ url, init });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { chamadas, fetchImpl };
}

/** Envia uma vez com o `fetch` global trocado, e devolve o que foi pedido. */
async function enviouCom(env) {
  const { chamadas, fetchImpl } = respondeuComOCabecalho();
  const original = globalThis.fetch;
  // A troca vem antes de montar o provedor: ele guarda o `fetch` de entao.
  globalThis.fetch = fetchImpl;
  try {
    await metaCloudProviderFrom(env).send(PEDIDO);
  } finally {
    globalThis.fetch = original;
  }
  return chamadas[0];
}

const PEDIDO = {
  deliveryId: "entrega-1",
  channel: "WHATSAPP",
  destination: "+5513999990000",
  providerSenderId: "123456789",
  body: "Confirmado para amanhã às 10h.",
  attempt: 1,
  taskId: "tarefa-1",
  organizationId: "org-1",
  idempotencyKey: "chave-1",
  expiresAt: "2026-11-20T13:00:00.000Z",
  freeText: true,
};

describe("o provedor da Cloud API nas functions", () => {
  it("sem token nao existe provedor", () => {
    expect(metaCloudProviderFrom({})).toBeNull();
    expect(metaCloudProviderFrom({ META_WHATSAPP_TOKEN: "" })).toBeNull();
  });

  it("com token nasce o provedor da Cloud API", () => {
    const provider = metaCloudProviderFrom({ META_WHATSAPP_TOKEN: "token" });
    expect(provider).toMatchObject({
      id: "META_CLOUD_API",
      simulated: false,
      handoff: false,
    });
  });

  it("usa a versao da Graph do ambiente, e a padrao quando ele nao diz", async () => {
    const escolhida = await enviouCom({
      META_WHATSAPP_TOKEN: "token",
      META_GRAPH_VERSION: "v26.0",
    });
    expect(escolhida.url).toContain("/v26.0/123456789/messages");

    const padrao = await enviouCom({ META_WHATSAPP_TOKEN: "token" });
    expect(padrao.url).toContain(`/${DEFAULT_GRAPH_VERSION}/123456789/messages`);
    expect(DEFAULT_GRAPH_VERSION).toBe("v25.0");
  });

  it("o token so aparece no cabecalho de autorizacao", async () => {
    const { url, init } = await enviouCom({
      META_WHATSAPP_TOKEN: "segredo-do-token",
    });
    expect(url).toBe(
      `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/123456789/messages`,
    );
    expect(init.headers.authorization).toBe("Bearer segredo-do-token");
    expect(init.body).not.toContain("segredo-do-token");
  });
});
