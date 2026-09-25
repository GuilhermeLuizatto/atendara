import { describe, expect, it } from "vitest";

import type { PaymentProof, Transaction } from "@/types";

import {
  detectProofType,
  latestProof,
  organizationStoragePrefixes,
  paymentLinkError,
  paymentLinkPath,
  publicPaymentView,
  reviewProofError,
  submitProofError,
} from "./payment-proof";

const NOW = "2026-09-25T15:00:00.000Z";

const transaction = (patch: Partial<Transaction> = {}): Transaction => ({
  id: "m1-202609",
  organizationId: "org",
  type: "INCOME",
  clientId: "c1",
  clientName: "Ana Ficticia",
  professionalId: null,
  appointmentId: null,
  appointmentPart: null,
  description: "Mensalidade — setembro de 2026",
  amountInCents: 45000,
  status: "PENDING",
  method: "PIX",
  dueDate: "2026-09-28T15:00:00.000Z",
  paidAt: null,
  gateway: null,
  recurringChargeId: "m1",
  period: "2026-09",
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: null,
  updatedBy: null,
  ...patch,
});

const proof = (id: string, patch: Partial<PaymentProof> = {}): PaymentProof => ({
  id,
  organizationId: "org",
  transactionId: "m1-202609",
  recurringChargeId: "m1",
  clientId: "c1",
  status: "SUBMITTED",
  storagePath: `paymentProofs/org/m1-202609/${id}`,
  contentType: "image/png",
  sizeBytes: 1000,
  sha256: "abc",
  submittedAt: NOW,
  reviewedAt: null,
  reviewedBy: null,
  rejectionReason: null,
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: null,
  updatedBy: null,
  ...patch,
});

describe("tipo real do arquivo", () => {
  it.each([
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0], "image/png"],
    [[0xff, 0xd8, 0xff, 0xe0], "image/jpeg"],
    [[0x25, 0x50, 0x44, 0x46, 0x2d, 0x31], "application/pdf"],
    [[..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0))), "image/webp"],
  ])("reconhece pelos primeiros bytes", (bytes, type) => {
    expect(detectProofType(new Uint8Array(bytes as number[]))).toBe(type);
  });

  it("recusa o que só tem nome de comprovante", () => {
    expect(detectProofType(new TextEncoder().encode("<html>comprovante.pdf"))).toBeNull();
    expect(detectProofType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(detectProofType(new Uint8Array([]))).toBeNull();
  });
});

describe("link e envio", () => {
  it("link só para mês de mensalidade a receber", () => {
    expect(paymentLinkError(transaction())).toBeNull();
    expect(paymentLinkError(transaction({ status: "OVERDUE" }))).toBeNull();
    expect(paymentLinkError(transaction({ recurringChargeId: null }))).toContain("mensalidades");
    expect(paymentLinkError(transaction({ type: "EXPENSE" }))).toContain("mensalidades");
    expect(paymentLinkError(transaction({ status: "PAID" }))).toContain("não está mais");
    expect(paymentLinkError(null)).not.toBeNull();
  });

  it("um comprovante por vez, e nada depois de pago", () => {
    expect(submitProofError(transaction(), [])).toBeNull();
    expect(submitProofError(transaction(), [proof("p1")])).toContain("aguardando");
    expect(submitProofError(transaction(), [proof("p1", { status: "REJECTED" })])).toBeNull();
    expect(submitProofError(transaction({ status: "PAID" }), [])).toContain("registrado");
  });

  it("o mais recente vale", () => {
    const older = proof("p1", { status: "REJECTED", submittedAt: "2026-09-20T10:00:00.000Z" });
    const newer = proof("p2", { submittedAt: "2026-09-21T10:00:00.000Z" });
    expect(latestProof([older, newer, proof("x", { transactionId: "outro" })], "m1-202609")?.id).toBe("p2");
  });

  it("caminhos: link com token codificado e todos os prefixos da organização", () => {
    expect(paymentLinkPath("a+b/c")).toBe("/pagamento/?token=a%2Bb%2Fc");
    expect(organizationStoragePrefixes("org")).toEqual(["branding/org/", "support/org/", "paymentProofs/org/"]);
  });
});

describe("conferência", () => {
  it("só confere o que está aguardando; recusa exige motivo curto", () => {
    expect(reviewProofError(proof("p"), { verdict: "APPROVED" })).toBeNull();
    expect(reviewProofError(proof("p", { status: "APPROVED" }), { verdict: "APPROVED" })).toContain("já foi");
    expect(reviewProofError(proof("p"), { verdict: "REJECTED", reason: "  " })).toContain("motivo");
    expect(reviewProofError(proof("p"), { verdict: "REJECTED", reason: "x".repeat(201) })).toContain("200");
    expect(reviewProofError(proof("p"), { verdict: "REJECTED", reason: "Valor diferente" })).toBeNull();
  });
});

describe("página pública", () => {
  it("mostra só o que a cobrança mostraria, com a situação e o motivo da recusa", () => {
    const view = publicPaymentView("Consultório Núcleo", transaction(), [proof("p", { status: "REJECTED", rejectionReason: "Valor diferente" })]);
    expect(view).toEqual({
      organizationName: "Consultório Núcleo",
      description: "Mensalidade — setembro de 2026",
      amountInCents: 45000,
      dueDate: "2026-09-28T15:00:00.000Z",
      situation: "OPEN",
      proof: "REJECTED",
      rejectionReason: "Valor diferente",
    });
    expect(Object.keys(view)).not.toContain("clientName");
    expect(publicPaymentView("X", transaction({ status: "PAID" }), []).situation).toBe("PAID");
    expect(publicPaymentView("X", transaction({ status: "CANCELLED" }), []).situation).toBe("CLOSED");
  });
});
