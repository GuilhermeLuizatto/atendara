import { describe, expect, it, vi } from "vitest";

import { adcFileName, createCliCredential } from "./adc-credential.js";

/**
 * A credencial derivada do login da CLI carrega um token de longa duração:
 * sem login ela não existe, é gravada com `wx` (nunca sobrescreve) e a
 * limpeza é agendada na hora.
 */

const cli = (account) => () => ({
  auth: { getGlobalDefaultAccount: () => account },
  api: { clientId: () => "id", clientSecret: () => "secret" },
});
const deps = () => ({
  makeDirectory: vi.fn(),
  write: vi.fn(),
  removeOld: vi.fn(() => []),
  cleanup: vi.fn(),
  warn: vi.fn(),
  env: {},
});

describe("createCliCredential", () => {
  it("recusa quando não há login da CLI", async () => {
    await expect(createCliCredential({ projectId: "p", loginMessage: "faça login", loadCli: cli(null), ...deps() }))
      .rejects.toThrow("faça login");
    await expect(createCliCredential({ projectId: "p", loginMessage: "faça login", loadCli: cli({ tokens: {} }), ...deps() }))
      .rejects.toThrow("faça login");
  });

  it("grava a credencial exclusiva, agenda a limpeza e devolve o e-mail normalizado", async () => {
    const d = deps();
    d.removeOld.mockReturnValue([".firebase-cli-adc-1.json"]);
    const { adcPath, cliEmail } = await createCliCredential({
      projectId: "atendo-a3481",
      loginMessage: "x",
      root: "pasta",
      loadCli: cli({ tokens: { refresh_token: "r" }, user: { email: " Op@Atendara.app " } }),
      ...d,
    });
    expect(cliEmail).toBe("op@atendara.app");
    expect(adcPath.endsWith(adcFileName())).toBe(true);
    const [written, content, options] = d.write.mock.calls[0];
    expect(written).toBe(adcPath);
    expect(JSON.parse(content)).toEqual({
      type: "authorized_user", client_id: "id", client_secret: "secret", refresh_token: "r", quota_project_id: "atendo-a3481",
    });
    expect(options).toEqual({ flag: "wx" });
    expect(d.cleanup).toHaveBeenCalledWith(adcPath);
    expect(d.env.GOOGLE_APPLICATION_CREDENTIALS).toBe(adcPath);
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining(".firebase-cli-adc-1.json"));
  });

  it("aceita conta sem e-mail", async () => {
    const { cliEmail } = await createCliCredential({
      projectId: "p", loginMessage: "x", loadCli: cli({ tokens: { refresh_token: "r" } }), ...deps(),
    });
    expect(cliEmail).toBeNull();
  });
});
