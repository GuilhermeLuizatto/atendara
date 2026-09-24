/**
 * Cifra e decifra segredo de terceiro com o Cloud KMS (Fase 3, 13.7).
 *
 * **Por que KMS e não o Secret Manager.** O Secret Manager guarda segredo
 * NOSSO, que muda de vez em quando e vale para o projeto inteiro. Aqui o
 * segredo é de **cada profissional** — o token que abre a agenda pessoal dele —,
 * nasce e morre com a conexão, e são muitos. KMS cifra o valor e o texto
 * cifrado fica no Firestore, junto do resto daquela conexão: revogar é apagar
 * uma linha, e ninguém precisa listar segredos do projeto para saber quem
 * conectou.
 *
 * **Sem dependência nova.** A chamada é REST, com o token que a própria
 * function já tem no servidor de metadados — o mesmo caminho que a cobrança usa
 * para falar com o gateway.
 *
 * O texto cifrado **nunca** sai daqui em resposta de callable: o navegador não
 * lê, não recebe e não guarda.
 */

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

let cached = { token: null, expiresAtMs: 0 };

/** Token da conta de serviço da function, com folga antes de vencer. */
export async function accessToken(deps = {}) {
  const { fetchImpl = fetch, now = () => Date.now() } = deps;
  if (cached.token && now() < cached.expiresAtMs) return cached.token;

  const response = await fetchImpl(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!response.ok) {
    throw Object.assign(new Error("Não foi possível obter credencial do servidor."), {
      name: "MetadataTokenError",
      status: response.status,
    });
  }

  const data = await response.json();
  if (typeof data?.access_token !== "string") throw new Error("Credencial do servidor em formato inesperado.");
  // 60 segundos de folga: token que vence no meio da chamada falharia depois de
  // a operação já ter começado.
  cached = { token: data.access_token, expiresAtMs: now() + Math.max(0, (data.expires_in ?? 0) - 60) * 1000 };
  return cached.token;
}

/** Só para teste: derruba o token guardado entre casos. */
export function resetTokenCache() {
  cached = { token: null, expiresAtMs: 0 };
}

function keyName(env) {
  const key = env.CALENDAR_KMS_KEY;
  if (!key) throw new Error("Chave do KMS não configurada.");
  return key;
}

async function callKms(operation, body, deps) {
  const { fetchImpl = fetch, env = process.env } = deps;
  const token = await accessToken(deps);
  const response = await fetchImpl(`https://cloudkms.googleapis.com/v1/${keyName(env)}:${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Sem detalhe da resposta no erro: ela pode repetir o material enviado.
    throw Object.assign(new Error(`KMS recusou a operação (${response.status}).`), {
      name: "KmsError",
      status: response.status,
    });
  }
  return response.json();
}

/** Texto -> base64 cifrado, pronto para gravar no Firestore. */
export async function encryptSecret(plaintext, deps = {}) {
  const data = await callKms("encrypt", { plaintext: Buffer.from(plaintext, "utf8").toString("base64") }, deps);
  if (typeof data?.ciphertext !== "string") throw new Error("KMS devolveu resposta inesperada.");
  return data.ciphertext;
}

/** Base64 cifrado -> texto. Só o backend chama, e só no momento de usar. */
export async function decryptSecret(ciphertext, deps = {}) {
  const data = await callKms("decrypt", { ciphertext }, deps);
  if (typeof data?.plaintext !== "string") throw new Error("KMS devolveu resposta inesperada.");
  return Buffer.from(data.plaintext, "base64").toString("utf8");
}
