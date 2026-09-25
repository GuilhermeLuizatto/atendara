import { afterEach, describe, expect, it, vi } from "vitest";

import { emailShell, sendEmail } from "./ses.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});
describe("e-mail transacional pelo Amazon SES", () => {
  it("assina e envia o corpo pelo endpoint regional v2", async () => {
    process.env.SES_ACCESS_KEY_ID = "AKIATESTE";
    process.env.SES_SECRET_ACCESS_KEY = "segredo-de-teste";
    process.env.SES_REGION = "sa-east-1";
    process.env.SES_FROM_EMAIL = "guilhermeluizatto@gmail.com";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ MessageId: "mensagem-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail({
      to: "destino@example.com", subject: "Convite", html: "<p>Olá</p>", text: "Olá",
      now: new Date("2026-09-25T12:34:56.000Z"),
    })).resolves.toEqual({ MessageId: "mensagem-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://email.sa-east-1.amazonaws.com/v2/email/outbound-emails");
    expect(request.headers.Authorization).toContain("Credential=AKIATESTE/20260925/sa-east-1/ses/aws4_request");
    expect(JSON.parse(request.body)).toMatchObject({
      FromEmailAddress: "guilhermeluizatto@gmail.com",
      Destination: { ToAddresses: ["destino@example.com"] },
    });
  });

  it("não tenta enviar sem as credenciais do SES", async () => {
    delete process.env.SES_ACCESS_KEY_ID;
    delete process.env.SES_SECRET_ACCESS_KEY;
    await expect(sendEmail({ to: "destino@example.com", subject: "x", html: "x", text: "x" }))
      .rejects.toThrow("SES não configurado");
  });

  it("escapa conteúdo variável e aceita o logo validado da organização", () => {
    const html = emailShell({
      title: "Convite <teste>", body: "<p>corpo controlado</p>",
      organization: { branding: { logoUrl: "https://example.com/logo.png?x=1&y=2" } },
    });
    expect(html).toContain("Convite &lt;teste&gt;");
    expect(html).toContain("logo.png?x=1&amp;y=2");
    expect(html).not.toContain("Convite <teste>");
  });
});
