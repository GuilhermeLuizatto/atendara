import { maskDocument, validateIssuer, type ReceiptIssuerInput } from "@/lib/finance/receipts";
import type { ReceiptSettings } from "@/types";

import { assertPermission } from "../../guards";
import { RepositoryError } from "../../types";
import { auditWrite, docPath, stamp, touch, type Plan, type PlanContext } from "../plan";

/**
 * Quem emite os recibos (C3). Um documento so, de id `organization`. Mudar o
 * emissor nao reescreve recibo ja emitido: cada recibo guarda a propria copia.
 */
export function planUpdateReceiptSettings(ctx: PlanContext, raw: ReceiptIssuerInput): Plan {
  assertPermission(ctx.actor, "receiptSettings:update");
  const validation = validateIssuer(raw);
  if (!validation.ok) throw new RepositoryError(validation.error);
  const existing = ctx.snapshot.receiptSettings ?? null;
  const settings: ReceiptSettings = {
    id: "organization",
    organizationId: ctx.organizationId,
    ...(existing ? { createdAt: existing.createdAt, createdBy: existing.createdBy, ...touch(ctx) } : stamp(ctx)),
    ...validation.value,
  };
  return {
    result: undefined,
    writes: [
      {
        op: "set",
        collection: "receiptSettings",
        path: docPath(ctx, "receiptSettings", "organization"),
        data: settings as unknown as Record<string, unknown>,
      },
      auditWrite(ctx, {
        action: existing ? "UPDATE" : "CREATE",
        actorType: "USER",
        resource: { type: "receiptSettings", id: "organization" },
        summary: "Emissor dos recibos atualizado. Recibos já emitidos continuam como foram impressos.",
        // Documento so mascarado na trilha.
        metadata: { issuerDocument: maskDocument(settings.issuerDocument) },
      }),
    ],
  };
}
