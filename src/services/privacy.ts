import { httpsCallable } from "firebase/functions";

import type { OrganizationExportSection } from "@/types";
import { getFirebaseFunctions } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";
import { AuthError } from "@/lib/auth/types";

/**
 * Direitos do titular sobre a PROPRIA organizacao: levar os dados embora e
 * encerrar tudo.
 *
 * Nenhum dos dois passa pelo repositorio: sao atos do backend, com registro
 * append-only, e o navegador so conduz. A exportacao chega paginada de
 * proposito — o servidor nao guarda arquivo de exportacao em lugar nenhum, e e
 * aqui que as paginas viram um arquivo so.
 */

type ExportSection = OrganizationExportSection;

interface StartedExport {
  exportId: string;
  organization: Record<string, unknown>;
  sections: ExportSection[];
}

interface ExportedDocument {
  id: string;
  conversationId?: string;
  data: Record<string, unknown>;
}

interface ExportPage {
  section: ExportSection;
  documents: ExportedDocument[];
  nextCursor: { id: string; conversationId?: string } | null;
}

export interface OrganizationExport {
  exportedAt: string;
  organization: Record<string, unknown>;
  sections: Record<string, ExportedDocument[]>;
}

const DEMO = "A demonstração local não exporta nem exclui: não há servidor por trás dela.";

function callable<Input, Output>(name: string) {
  if (isDemoMode) throw new AuthError(DEMO);
  return httpsCallable<Input, Output>(getFirebaseFunctions(), name);
}

/**
 * Monta a exportacao inteira, secao por secao, pagina por pagina.
 *
 * `onProgress` existe porque isto demora: uma organizacao com historico rende
 * dezenas de paginas, e uma tela parada por um minuto parece travada.
 */
export async function exportOrganization(
  onProgress?: (section: string, lidos: number) => void,
): Promise<OrganizationExport> {
  const start = callable<Record<string, never>, StartedExport>("startOrganizationExport");
  const page = callable<
    { exportId: string; section: ExportSection; cursor?: ExportPage["nextCursor"] },
    ExportPage
  >("exportOrganizationPage");

  const started = (await start({})).data;
  const sections: Record<string, ExportedDocument[]> = {};

  for (const section of started.sections) {
    const documents: ExportedDocument[] = [];
    let cursor: ExportPage["nextCursor"] = null;
    do {
      const result: ExportPage = (await page({ exportId: started.exportId, section, ...(cursor ? { cursor } : {}) })).data;
      documents.push(...result.documents);
      cursor = result.nextCursor;
      onProgress?.(section, documents.length);
    } while (cursor);
    sections[section] = documents;
  }

  return { exportedAt: new Date().toISOString(), organization: started.organization, sections };
}

/**
 * Encerra a organizacao. O `organizationId` vai como confirmacao — o servidor
 * confere contra a conta do titular, entao ele nao escolhe o alvo, so confirma
 * que sabe qual e.
 */
export async function deleteOwnOrganization(organizationId: string): Promise<void> {
  await callable<{ confirmOrganizationId: string }, { ok: boolean }>("deleteOrganization")({
    confirmOrganizationId: organizationId,
  });
}
