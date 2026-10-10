import { Suspense } from "react";

import { SkeletonCard } from "@/components/ui/skeleton";
import { MessagesView } from "@/features/messages/messages-view";

// A conversa pode chegar escolhida pela URL (`?conversa=`), vinda da fila de
// primeiro contato; ler a URL num export estatico exige o limite de Suspense.
export default function MessagesPage() {
  return (
    <Suspense fallback={<SkeletonCard lines={6} />}>
      <MessagesView />
    </Suspense>
  );
}
