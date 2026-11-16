"use client";

import { useState } from "react";

import { downloadStorageFile } from "@/lib/firebase/download-file";
import type { SupportAttachment } from "@/types";

export function AttachmentLink({ attachment }: { attachment: SupportAttachment }) {
  const [error, setError] = useState(false);
  return <>
    <button type="button" className="text-primary underline underline-offset-2" onClick={async () => {
      try { setError(false); await downloadStorageFile(attachment.storagePath, attachment.name, attachment.contentType); }
      catch { setError(true); }
    }}>{attachment.name}</button>
    {error && <span role="status" className="text-danger ml-2">Arquivo indisponível.</span>}
  </>;
}
