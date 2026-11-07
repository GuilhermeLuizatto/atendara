import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_TOKEN_KEY,
  hasDownloadToken,
  isSensitivePath,
  organizationOf,
  planRevocation,
  metadataWithoutToken,
} from "./download-token-revocation.js";

describe("revogação de links de download antigos", () => {
  it("só considera comprovantes e anexos de suporte", () => {
    expect(isSensitivePath("paymentProofs/org-a/tx-1/proof.pdf")).toBe(true);
    expect(isSensitivePath("support/org-a/ticket/msg/print.png")).toBe(true);
    expect(isSensitivePath("branding/org-a/logo/x.webp")).toBe(false);
    expect(isSensitivePath("paymentProofsX/org-a/a.pdf")).toBe(false);
    expect(isSensitivePath(undefined)).toBe(false);
  });

  it("reconhece token presente e ignora vazio ou ausente", () => {
    expect(hasDownloadToken({ [DOWNLOAD_TOKEN_KEY]: "abc" })).toBe(true);
    expect(hasDownloadToken({ [DOWNLOAD_TOKEN_KEY]: "  " })).toBe(false);
    expect(hasDownloadToken({})).toBe(false);
    expect(hasDownloadToken(undefined)).toBe(false);
  });

  it("planeja revogar só o que tem token e conta por organização", () => {
    const plan = planRevocation([
      { name: "paymentProofs/org-a/tx-1/p.pdf", metadata: { [DOWNLOAD_TOKEN_KEY]: "t1" } },
      { name: "paymentProofs/org-a/tx-2/p.pdf", metadata: {} },
      { name: "support/org-b/t/m/a.png", metadata: { [DOWNLOAD_TOKEN_KEY]: "t2,t3" } },
      { name: "branding/org-a/logo/l.webp", metadata: { [DOWNLOAD_TOKEN_KEY]: "t4" } },
    ]);
    expect(plan).toEqual({
      inspected: 3,
      alreadyClean: 1,
      revoke: ["paymentProofs/org-a/tx-1/p.pdf", "support/org-b/t/m/a.png"],
      byOrganization: { "org-a": 1, "org-b": 1 },
    });
  });

  it("o plano não carrega o valor do token", () => {
    const plan = planRevocation([
      { name: "support/org-a/t/m/a.png", metadata: { [DOWNLOAD_TOKEN_KEY]: "segredo-do-link" } },
    ]);
    expect(JSON.stringify(plan)).not.toContain("segredo-do-link");
  });

  it("regrava sem o token e preserva os demais metadados", () => {
    expect(
      metadataWithoutToken({ [DOWNLOAD_TOKEN_KEY]: "t1", organizationId: "org-a", ticketId: "x" }),
    ).toEqual({ organizationId: "org-a", ticketId: "x" });
    expect(metadataWithoutToken(undefined)).toEqual({});
    expect(organizationOf("paymentProofs/org-z/x")).toBe("org-z");
  });
});
