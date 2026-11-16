import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseFunctions: () => "functions" }));
vi.mock("@/lib/firebase/config", () => ({ isDemoMode: false }));

import { phaseFiveService } from "./phase-five";

/**
 * Anexo e logo seguem pelo backend, que confere os bytes; o navegador só
 * limita o tamanho para não montar um pedido que o servidor vai recusar.
 */
class FakeReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static fail = false;
  readAsDataURL() {
    if (FakeReader.fail) this.onerror?.();
    else {
      this.result = "data:image/png;base64,QUJD";
      this.onload?.();
    }
  }
}

const file = (size: number, name = "print.png") => ({ size, name }) as unknown as File;

beforeEach(() => {
  FakeReader.fail = false;
  mocks.callable.mockReset().mockResolvedValue({ data: { ok: true } });
  mocks.httpsCallable.mockReset().mockReturnValue(mocks.callable);
  vi.stubGlobal("FileReader", FakeReader);
});

describe("anexo de suporte", () => {
  it("envia o arquivo em base64 puro, sem o prefixo data:, com um id novo", async () => {
    await phaseFiveService.support.upload("ticket-1", "msg-1", file(1000));
    expect(mocks.httpsCallable).toHaveBeenCalledWith("functions", "uploadSupportAttachment", { timeout: 60_000 });
    const sent = mocks.callable.mock.calls[0][0];
    expect(sent).toMatchObject({ ticketId: "ticket-1", messageId: "msg-1", name: "print.png", file: "QUJD" });
    expect(sent.attachmentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("recusa vazio e acima de 5 MB antes de chamar o backend", async () => {
    await expect(phaseFiveService.support.upload("t", "m", file(0))).rejects.toThrow("até 5 MB");
    await expect(phaseFiveService.support.upload("t", "m", file(5 * 1024 * 1024 + 1))).rejects.toThrow("até 5 MB");
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("avisa quando o arquivo não pode ser lido", async () => {
    FakeReader.fail = true;
    await expect(phaseFiveService.support.upload("t", "m", file(10))).rejects.toThrow("Não foi possível ler o arquivo.");
  });

  it("devolve a mensagem do backend sem o código numérico", async () => {
    mocks.callable.mockRejectedValue(new Error("Use PNG, JPEG, WebP ou PDF válido. [400]"));
    await expect(phaseFiveService.support.upload("t", "m", file(10))).rejects.toThrow("Use PNG, JPEG, WebP ou PDF válido.");
  });
});

describe("logo da organização", () => {
  it("envia só o arquivo; o caminho e o tipo nascem no backend", async () => {
    await phaseFiveService.branding.upload(file(10) as unknown as Blob);
    expect(mocks.httpsCallable).toHaveBeenCalledWith("functions", "uploadBrandingLogo", { timeout: 60_000 });
    expect(mocks.callable).toHaveBeenCalledWith({ file: "QUJD" });
  });
});
