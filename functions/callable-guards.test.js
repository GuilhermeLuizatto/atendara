import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * As quatro travas de toda callable (H.6), conferidas em TODAS as exportadas.
 *
 * A lista antiga de callables com App Check era escrita a mao, e uma callable
 * nova que alguem esquecesse de acrescentar passava sem prova. Aqui a lista vem
 * do proprio `index.js`: exportou uma callable, ela entra na conferencia.
 *
 * - App Check: lido das opcoes que a callable recebeu.
 * - Login: a callable e chamada sem `auth` e precisa recusar com
 *   `unauthenticated` ANTES de tocar no banco — o banco aqui explode se usado.
 * - Esquema: o corpo precisa validar a entrada com um esquema zod `.strict()`,
 *   que recusa campo que ninguem pediu.
 * - Limite por usuario: `consumeRateLimit` no corpo, salvo excecao escrita com
 *   o motivo, abaixo.
 */

// O index.js pega o banco no carregamento; o que nao pode e USAR antes do login.
// Qualquer acesso a um metodo deste objeto derruba o teste.
const explode = () =>
  new Proxy(
    {},
    {
      get: (_, property) => {
        if (property === "then") return undefined;
        throw new Error(`banco usado antes de conferir o login (${String(property)})`);
      },
    },
  );

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: explode }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: explode, FieldPath: { documentId: () => "__name__" } }));
vi.mock("firebase-admin/functions", () => ({ getFunctions: explode }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { kind: "callable", options }),
  onRequest: (options, handler) => Object.assign(handler, { kind: "request", options }),
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: (options, handler) => Object.assign(handler, { kind: "event", options }) }));
vi.mock("firebase-functions/v2/tasks", () => ({ onTaskDispatched: (options, handler) => Object.assign(handler, { kind: "task", options }) }));

/**
 * Callables sem limite por usuario, cada uma com o motivo. Acrescentar um nome
 * aqui e decisao do titular — o teste existe para que a falta de limite seja
 * escolha escrita, e nao esquecimento.
 */
const WITHOUT_RATE_LIMIT = {
  registerProfessional: "Operadora com segundo fator; uma pessoa so, e cadastrar pilotos em sequencia e uso legitimo.",
  updateAccount: "Operadora com segundo fator; suspender varias contas num incidente nao pode esbarrar num teto.",
  grantAccess: "Operadora com segundo fator; cada ato ja fica na trilha append-only.",
  revokeAccess: "Operadora com segundo fator; revogar em massa e resposta a incidente.",
  createPlatformAdmin: "Chave mestra com segundo fator; uma pessoa so.",
  setPlatformAdminStatus: "Chave mestra com segundo fator; suspender administrador e resposta a incidente.",
  completeInitialPassword: "Roda uma vez por conta (a trava de senha inicial se desliga no sucesso) e exige login de ate 5 minutos.",
  exportOrganizationPage: "Paginada de proposito: uma exportacao grande faz dezenas de chamadas seguidas, e um teto quebraria a portabilidade.",
  // PENDENTE DE DECISAO DO TITULAR (16/09/2026): as duas abaixo gravam um
  // registro em `privacyRequests` e na trilha a cada chamada. Recomendacao:
  // limitar, como `eraseClientData`. Ficam aqui ate a resposta.
  exportClientData: "Pendente de decisao: cada chamada grava registro; recomendado limitar.",
  startOrganizationExport: "Pendente de decisao: cada chamada grava registro; recomendado limitar.",
};

let callables = [];
const sources = new Map();

beforeAll(async () => {
  const backend = await import("./index.js");
  callables = Object.entries(backend).filter(([, fn]) => fn?.kind === "callable");
  const here = new URL(".", import.meta.url);
  for (const file of readdirSync(here).filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))) {
    sources.set(file, readFileSync(new URL(file, here), "utf8"));
  }
});

/** Corpo da callable e o arquivo onde ela mora. */
function bodyOf(name) {
  for (const [file, source] of sources) {
    const start = source.indexOf(`export const ${name} = onCall(`);
    if (start < 0) continue;
    const end = source.indexOf("\n});", start);
    return { file, source, body: source.slice(start, end) };
  }
  return null;
}

/** O esquema usado no corpo precisa ser `.strict()`, inline ou declarado no arquivo. */
function strictSchemaIn({ source, body }) {
  const inline = /parse\(\s*z\.object\([\s\S]*?\)\s*\.strict\(\)/.test(body);
  if (inline) return true;
  const names = [...body.matchAll(/parse\(\s*(\w+)\s*,/g), ...body.matchAll(/(\w+)\.safeParse\(/g)].map((match) => match[1]);
  return names.some((name) => {
    const declaration = new RegExp(`const ${name}\\s*=([\\s\\S]*?);\\r?\\n`).exec(source);
    return Boolean(declaration && declaration[1].includes(".strict()"));
  });
}

describe("Travas de toda callable exportada", () => {
  it("encontra as callables", () => {
    expect(callables.length).toBeGreaterThanOrEqual(15);
  });

  it("todas exigem App Check", () => {
    for (const [name, fn] of callables) expect(fn.options.enforceAppCheck, name).toBe(true);
  });

  it("todas recusam quem nao entrou, antes de tocar no banco", async () => {
    for (const [name, fn] of callables) {
      await expect(fn({ data: {} }), name).rejects.toMatchObject({ code: "unauthenticated" });
    }
  });

  it("todas validam a entrada com esquema estrito", () => {
    for (const [name] of callables) {
      const found = bodyOf(name);
      expect(found, `${name} nao foi encontrada`).not.toBeNull();
      expect(strictSchemaIn(found), `${name} sem esquema .strict()`).toBe(true);
    }
  });

  it("todas limitam por usuario, salvo excecao escrita", () => {
    for (const [name] of callables) {
      const { body } = bodyOf(name);
      const limited = body.includes("consumeRateLimit(");
      if (WITHOUT_RATE_LIMIT[name]) {
        // Excecao que passou a ter limite deve sair da lista, senao a lista mente.
        expect(limited, `${name} tem limite e ainda esta nas excecoes`).toBe(false);
      } else {
        expect(limited, `${name} sem limite por usuario e sem excecao escrita`).toBe(true);
      }
    }
  });

  it("nenhuma excecao aponta para callable que nao existe", () => {
    const names = new Set(callables.map(([name]) => name));
    for (const name of Object.keys(WITHOUT_RATE_LIMIT)) expect(names.has(name), name).toBe(true);
  });
});
