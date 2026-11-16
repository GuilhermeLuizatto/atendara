import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBytes: vi.fn(),
  ref: vi.fn((_storage: unknown, path: string) => ({ path })),
}));

vi.mock("firebase/storage", () => ({ getBytes: mocks.getBytes, ref: mocks.ref }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseStorage: () => "storage" }));

import { downloadStorageFile } from "./download-file";

/**
 * O arquivo sensível não tem URL pública: cada clique lê pelo SDK, sob as
 * regras do Storage, e entrega por um endereço temporário do navegador.
 */
describe("downloadStorageFile", () => {
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const append = vi.fn();
  const revoke = vi.fn();
  const timers: Array<() => void> = [];

  beforeEach(() => {
    mocks.getBytes.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    Object.assign(anchor, { href: "", download: "" });
    anchor.click.mockReset();
    anchor.remove.mockReset();
    append.mockReset();
    revoke.mockReset();
    timers.length = 0;
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { append } });
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => timers.push(callback) });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:temporario"), revokeObjectURL: revoke });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("lê pelo caminho informado e baixa com o nome e o tipo recebidos", async () => {
    await downloadStorageFile("paymentProofs/org/tx/p", "comprovante", "application/pdf");
    expect(mocks.ref).toHaveBeenCalledWith("storage", "paymentProofs/org/tx/p");
    expect(anchor.href).toBe("blob:temporario");
    expect(anchor.download).toBe("comprovante");
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });

  it("libera o endereço temporário depois de um minuto", async () => {
    await downloadStorageFile("support/x", "print.png", "image/png");
    expect(revoke).not.toHaveBeenCalled();
    timers[0]();
    expect(revoke).toHaveBeenCalledWith("blob:temporario");
  });

  it("sem permissão a leitura falha e nada é baixado", async () => {
    mocks.getBytes.mockRejectedValue(new Error("storage/unauthorized"));
    await expect(downloadStorageFile("support/x", "a", "image/png")).rejects.toThrow("storage/unauthorized");
    expect(anchor.click).not.toHaveBeenCalled();
  });
});
