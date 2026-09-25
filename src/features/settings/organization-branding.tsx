"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useWorkspace } from "@/providers/workspace-provider";
import { deletePhaseFiveFile, phaseFiveService, uploadPhaseFiveFile } from "@/services/phase-five";

async function squareLogo(file: File): Promise<{ blob: Blob; contentType: "image/png" | "image/jpeg" | "image/webp" }> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Use PNG, JPEG ou WebP. SVG não é aceito.");
  if (file.size > 2 * 1024 * 1024) throw new Error("O arquivo original deve ter até 2 MB.");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Não foi possível preparar a imagem.");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512); bitmap.close();
  const contentType = "image/webp" as const;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, contentType, 0.88));
  if (!blob) throw new Error("Não foi possível recortar a imagem.");
  return { blob, contentType };
}

export function OrganizationBranding() {
  const { organization, session } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!organization || !session?.permissions.includes("organizationBranding:update")) return null;

  async function upload(file: File | undefined) {
    if (!file || !organization) return;
    setBusy(true); setNotice("");
    try {
      const prepared = await squareLogo(file);
      const path = `branding/${organization.id}/logo/${crypto.randomUUID()}.webp`;
      const logoUrl = await uploadPhaseFiveFile(path, prepared.blob, prepared.contentType);
      const previous = organization.branding?.logoStoragePath;
      await phaseFiveService.branding.update({ logoUrl, logoStoragePath: path, logoContentType: prepared.contentType });
      if (previous && previous !== path) await deletePhaseFiveFile(previous).catch(() => undefined);
      setNotice("Logo atualizado. O recorte quadrado aparece no painel, e-mails e documentos que usam a marca.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível atualizar o logo."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!organization) return;
    setBusy(true);
    try {
      const previous = organization.branding?.logoStoragePath;
      await phaseFiveService.branding.update({ logoUrl: null, logoStoragePath: null, logoContentType: null });
      if (previous) await deletePhaseFiveFile(previous).catch(() => undefined);
      setNotice("Logo removido. O ícone padrão voltou a ser usado.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível remover o logo."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4"><div className="flex items-center gap-4">{organization.branding?.logoUrl ? <span role="img" aria-label={`Logo de ${organization.name}`} className="border-border size-16 rounded-xl border bg-cover bg-center" style={{ backgroundImage: `url(${JSON.stringify(organization.branding.logoUrl)})` }} /> : <span className="bg-accent text-accent-foreground flex size-16 items-center justify-center rounded-xl text-xl" aria-label="Ícone padrão">✦</span>}<div><p className="text-sm font-medium">Identidade da organização</p><p className="text-muted-foreground text-xs">PNG, JPEG ou WebP, até 2 MB. O corte é quadrado e central.</p></div></div><Field label="Escolher logo">{(props) => <Input {...props} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => void upload(event.target.files?.[0])} />}</Field>{organization.branding?.logoUrl ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void remove()}>Remover logo</Button> : null}{notice ? <p role="status" className="text-muted-foreground text-xs">{notice}</p> : null}</div>;
}
