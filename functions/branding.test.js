import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Logo da organização: o backend valida os bytes (tipo pelo conteúdo, não pelo
 * nome), grava no caminho da própria organização e troca a referência junto
 * da trilha; se a troca falhar, o arquivo novo é apagado, e o antigo só sai
 * depois que a nova referência vale.
 */

const state = vi.hoisted(() => ({
  org: { branding: { logoStoragePath: null } },
  audits: [],
  saved: [],
  deleted: [],
  failTransaction: null,
  failSave: null,
}));

vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("./service-accounts.js", () => ({ runAs: () => ({}) }));
vi.mock("./firestore-dates.js", () => ({ toStored: (_collection, value) => value }));
vi.mock("./platform-auth.js", async () => {
  const { HttpsError } = await import("firebase-functions/v2/https");
  return {
    ACCOUNT_CALL_OPTIONS: {},
    parse: (schema, data) => {
      const result = schema.safeParse(data);
      if (!result.success) throw new HttpsError("invalid-argument", "Confira os dados informados.");
      return result.data;
    },
  };
});
vi.mock("./tenant-auth.js", () => ({
  tenantActor: vi.fn(async () => ({ userId: "u-1", organizationId: "org-a" })),
  tenantAudit: (entry) => ({ id: "audit-1", ...entry }),
}));
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      name: "bucket-x",
      file: (path) => ({
        save: async (bytes, options) => {
          if (state.failSave) throw state.failSave;
          state.saved.push({ path, bytes, options });
        },
        delete: async (options) => { state.deleted.push({ path, options }); },
      }),
    }),
  }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: (path) => ({ path }),
    runTransaction: async (work) => {
      if (state.failTransaction) throw state.failTransaction;
      return work({
        get: async () => ({ data: () => state.org }),
        update: (_ref, data) => { state.org = { ...state.org, ...data }; },
        create: (_ref, data) => { state.audits.push(data); },
      });
    },
  }),
}));

const { tenantActor } = await import("./tenant-auth.js");
const { updateOrganizationBranding, uploadBrandingLogo } = await import("./branding.js");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0];
const encode = (bytes) => Buffer.from(bytes).toString("base64");
const call = (handler, data) => handler({ data, auth: { uid: "u-1" } });

beforeEach(() => {
  state.org = { branding: { logoStoragePath: null } };
  state.audits = [];
  state.saved = [];
  state.deleted = [];
  state.failTransaction = null;
  state.failSave = null;
  tenantActor.mockClear();
});

describe("uploadBrandingLogo", () => {
  it("grava no caminho da organização, sem expor token e com a trilha", async () => {
    const { branding } = await call(uploadBrandingLogo, { file: encode(PNG) });
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0].path).toMatch(/^branding\/org-a\/logo\/[0-9a-f-]{36}\.png$/);
    expect(state.saved[0].options.contentType).toBe("image/png");
    expect(branding.logoStoragePath).toBe(state.saved[0].path);
    expect(branding.logoContentType).toBe("image/png");
    expect(branding.logoUrl).toContain("/b/bucket-x/o/");
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].summary).toBe("Logo da organização atualizado.");
    expect(state.deleted).toHaveLength(0);
  });

  it("apaga o logo anterior da própria organização depois de trocar", async () => {
    state.org = { branding: { logoStoragePath: "branding/org-a/logo/antigo.png" } };
    await call(uploadBrandingLogo, { file: encode(PNG) });
    expect(state.deleted).toEqual([{ path: "branding/org-a/logo/antigo.png", options: { ignoreNotFound: true } }]);
  });

  it("não apaga caminho de fora da pasta de logos da organização", async () => {
    state.org = { branding: { logoStoragePath: "branding/org-b/logo/alheio.png" } };
    await call(uploadBrandingLogo, { file: encode(PNG) });
    expect(state.deleted).toHaveLength(0);
  });

  it("recusa arquivo que não é imagem aceita, mesmo com extensão ou tipo de imagem", async () => {
    const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    await expect(call(uploadBrandingLogo, { file: encode(pdf) })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call(uploadBrandingLogo, { file: encode(new Array(16).fill(1)) })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(state.saved).toHaveLength(0);
  });

  it("recusa arquivo vazio, grande demais e carga fora do formato", async () => {
    await expect(call(uploadBrandingLogo, { file: "AAAAAAAA" })).rejects.toMatchObject({ code: "invalid-argument" });
    const big = encode([...PNG, ...new Array(2 * 1024 * 1024).fill(0)]);
    await expect(call(uploadBrandingLogo, { file: big })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call(uploadBrandingLogo, { file: "não é base64!" })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call(uploadBrandingLogo, { file: encode(PNG), extra: 1 })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(state.saved).toHaveLength(0);
  });

  it("se a troca da referência falhar, o arquivo novo é apagado e o erro volta", async () => {
    state.failTransaction = new Error("conflito");
    await expect(call(uploadBrandingLogo, { file: encode(PNG) })).rejects.toThrow("conflito");
    expect(state.deleted).toHaveLength(1);
    expect(state.deleted[0].path).toBe(state.saved[0].path);
  });

  it("exige a permissão de editar a identidade visual", async () => {
    await call(uploadBrandingLogo, { file: encode(PNG) });
    expect(tenantActor).toHaveBeenCalledWith(expect.anything(), "organizationBranding:update");
  });
});

describe("updateOrganizationBranding", () => {
  it("só aceita remover o logo e apaga o arquivo anterior", async () => {
    state.org = { branding: { logoStoragePath: "branding/org-a/logo/antigo.png" } };
    const { branding } = await call(updateOrganizationBranding, { logoUrl: null, logoStoragePath: null, logoContentType: null });
    expect(branding).toMatchObject({ logoUrl: null, logoStoragePath: null, logoContentType: null });
    expect(state.audits[0].summary).toBe("Logo da organização removido.");
    expect(state.deleted.map((item) => item.path)).toEqual(["branding/org-a/logo/antigo.png"]);
  });

  it("sem logo anterior não apaga nada", async () => {
    await call(updateOrganizationBranding, { logoUrl: null, logoStoragePath: null, logoContentType: null });
    expect(state.deleted).toHaveLength(0);
  });

  it("recusa apontar para um endereço: a referência só nasce do envio", async () => {
    await expect(call(updateOrganizationBranding, {
      logoUrl: "https://firebasestorage.googleapis.com/x", logoStoragePath: "branding/org-a/logo/x.png", logoContentType: "image/png",
    })).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
