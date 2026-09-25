"use client";

import { useEffect, useState } from "react";

import { getPhaseFiveFileUrl } from "@/services/phase-five";
import type { SupportAttachment } from "@/types";

export function AttachmentLink({ attachment }: { attachment: SupportAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void getPhaseFiveFileUrl(attachment.storagePath).then(setUrl).catch(() => setUrl(null));
  }, [attachment.storagePath]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{attachment.name}</a>
  ) : (
    <span className="text-muted-foreground">{attachment.name}</span>
  );
}
