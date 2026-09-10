"use client";

import { Badge, Card, CardBody } from "@/components/ui";
import { PLATFORM_NOTICE_LABELS } from "@/config/notifications";
import { platformNoticesFor } from "@/lib/notifications";
import type { PlatformNotice, PlatformSubscription } from "@/types";

/**
 * Avisos da operadora ao assinante.
 *
 * A outra metade do assunto "notificacao", e a que nao envia nada: sao
 * derivados da assinatura a cada leitura e ficam dentro do painel. Nao usam
 * canal de clinica, nao exigem consentimento do titular de dados e nao viram
 * `NotificationDelivery` — remetente, audiencia e base legal sao outros.
 */
const TONES = {
  INFO: "info",
  ATTENTION: "warning",
  CRITICAL: "danger",
} as const;

export function PlatformNotices({
  subscription,
  now = new Date().toISOString(),
}: {
  subscription: PlatformSubscription | null;
  now?: string;
}) {
  const notices = platformNoticesFor(subscription, now);
  if (notices.length === 0) return null;

  return (
    <div className="space-y-2">
      {notices.map((notice: PlatformNotice) => (
        <Card key={notice.event}>
          <CardBody className="flex flex-wrap items-start gap-3">
            <Badge tone={TONES[notice.severity]} dot>
              {PLATFORM_NOTICE_LABELS[notice.event]}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-medium">{notice.title}</p>
              <p className="text-muted-foreground text-sm">{notice.body}</p>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
