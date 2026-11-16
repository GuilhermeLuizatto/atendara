import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paths } from "@/lib/firebase/paths";
import { adminBucket, adminDb, deleteAdminApps, initializeAdminSdk } from "@/lib/testing/admin-sdk";
import { PROJECT, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";

const ORG = "org-arquivos-seguros";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString("base64");
const HTML = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");

let owner: TokenSession;
let peer: TokenSession;

beforeAll(async () => {
  initializeAdminSdk(PROJECT);
  await adminDb().doc(paths.organization(ORG)).set({ id: ORG, name: "Organização fictícia", ownerId: "owner-files", primaryProfession: "PSYCHOLOGIST" });
  for (const [uid, role] of [["owner-files", "OWNER"], ["peer-files", "ASSISTANT"]]) {
    await adminDb().doc(paths.account(uid)).set({ userId: uid, organizationId: ORG, professionId: "PSYCHOLOGIST",
      platformRole: "PROFESSIONAL", status: "ACTIVE", mustChangePassword: false,
      subscriptionStatus: "ACTIVE", accessUntilMs: Date.now() + 86_400_000, modules: ["suporte"] });
    await adminDb().doc(paths.document(ORG, "members", uid)).set({ userId: uid, organizationId: ORG, role, status: "ACTIVE", linkedProfessionalIds: [] });
  }
  owner = await tokenSession("owner-files", null);
  peer = await tokenSession("peer-files", null);
});

afterAll(async () => {
  await owner?.dispose();
  await peer?.dispose();
  await deleteAdminApps();
});

describe("anexos e marca enviados pelo backend", () => {
  it("recusa conteúdo HTML declarado como imagem", async () => {
    await expect(owner.call("uploadSupportAttachment", {
      ticketId: randomUUID(), messageId: randomUUID(), attachmentId: randomUUID(), name: "falso.png", file: HTML,
    })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(owner.call("uploadBrandingLogo", { file: HTML })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("amarra anexo ao autor, chamado e mensagem antes de registrá-lo", async () => {
    const ticketId = randomUUID();
    const messageId = randomUUID();
    const attachmentId = randomUUID();
    const attachment = await owner.call<{ id: string; storagePath: string; contentType: string; size: number }>("uploadSupportAttachment", {
      ticketId, messageId, attachmentId, name: "evidence.png", file: PNG,
    });
    expect(attachment).toMatchObject({ id: attachmentId, storagePath: `support/${ORG}/${ticketId}/${messageId}/${attachmentId}`, contentType: "image/png" });
    const [metadata] = await adminBucket().file(attachment.storagePath).getMetadata();
    expect(metadata.metadata).toMatchObject({ uploaderId: "owner-files", organizationId: ORG, ticketId, messageId });

    await expect(owner.call("createSupportTicket", {
      ticketId, messageId, category: "TECHNICAL_PROBLEM", reportedSeverity: "MEDIUM",
      subject: "Chamado fictício", body: "Descrição fictícia do chamado.", attachments: [attachment],
    })).resolves.toMatchObject({ ticketId });
    await expect(peer.call("uploadSupportAttachment", {
      ticketId, messageId: randomUUID(), attachmentId: randomUUID(), name: "intruso.png", file: PNG,
    })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("gera o logo com bytes verificados e rejeita atualização de URL pelo cliente", async () => {
    const { branding } = await owner.call<{ branding: { logoStoragePath: string; logoContentType: string } }>("uploadBrandingLogo", { file: PNG });
    expect(branding.logoContentType).toBe("image/png");
    expect(branding.logoStoragePath).toMatch(/^branding\/org-arquivos-seguros\/logo\//);
    await expect(owner.call("updateOrganizationBranding", {
      logoUrl: "https://firebasestorage.googleapis.com/forjado", logoStoragePath: branding.logoStoragePath,
      logoContentType: "image/png",
    })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("conta vencida não usa callables operacionais com a sessão aberta", async () => {
    await adminDb().doc(paths.account("owner-files")).update({ accessUntilMs: Date.now() - 1 });
    await expect(owner.call("uploadSupportAttachment", {
      ticketId: randomUUID(), messageId: randomUUID(), attachmentId: randomUUID(), name: "vencido.png", file: PNG,
    })).rejects.toMatchObject({ code: "permission-denied" });
  });
});
