import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, resetTokenCache } from "./kms.js";

const KEY =
  "projects/p/locations/southamerica-east1/keyRings/r/cryptoKeys/k";

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
    };
  };
  return { calls, fetchImpl };
}

beforeEach(() => resetTokenCache());

describe("KMS com a credencial da própria function", () => {
  it("pede o token da conta padrão no servidor de metadados e cifra na chave configurada", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { body: { access_token: "server-token", expires_in: 3600 } },
      { body: { ciphertext: "cifrado" } },
    ]);
    const result = await encryptSecret("segredo", {
      fetchImpl,
      env: { CALENDAR_KMS_KEY: KEY },
    });
    expect(result).toBe("cifrado");
    // O caminho errado responde 404 só em produção; nenhum emulador o exercita.
    expect(calls[0].url).toBe(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    );
    expect(calls[0].init.headers).toEqual({ "Metadata-Flavor": "Google" });
    expect(calls[1].url).toBe(
      `https://cloudkms.googleapis.com/v1/${KEY}:encrypt`,
    );
    expect(JSON.parse(calls[1].init.body)).toEqual({
      plaintext: Buffer.from("segredo").toString("base64"),
    });
  });

  it("falha do servidor de metadados leva nome e status, sem corpo", async () => {
    const { fetchImpl } = fakeFetch([{ ok: false, status: 404, body: {} }]);
    await expect(
      encryptSecret("segredo", { fetchImpl, env: { CALENDAR_KMS_KEY: KEY } }),
    ).rejects.toMatchObject({ name: "MetadataTokenError", status: 404 });
  });

  it("recusa do KMS leva nome e status e não repete o texto enviado", async () => {
    const { fetchImpl } = fakeFetch([
      { body: { access_token: "server-token", expires_in: 3600 } },
      { ok: false, status: 403, body: { error: { message: "cifrado" } } },
    ]);
    const error = await decryptSecret("cifrado", {
      fetchImpl,
      env: { CALENDAR_KMS_KEY: KEY },
    }).catch((reason) => reason);
    expect(error).toMatchObject({ name: "KmsError", status: 403 });
    expect(error.message).not.toContain("cifrado");
  });
});
