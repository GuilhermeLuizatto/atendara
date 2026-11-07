import { getBytes, ref } from "firebase/storage";

import { getFirebaseStorage } from "@/lib/firebase/client";

/** Cada clique faz nova leitura autorizada; o endereço temporário fica só no navegador. */
export async function downloadStorageFile(path: string, name: string, contentType: string): Promise<void> {
  const bytes = await getBytes(ref(getFirebaseStorage(), path));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
