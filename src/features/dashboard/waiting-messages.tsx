"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ATTENTION_TONE, CLASSIFICATION_TONE } from "@/components/ui/tones";
import { classificationMeta } from "@/config/classifications";
import { CHANNEL_LABELS } from "@/config/labels";
import { cn } from "@/lib/utils/cn";
import { formatRelativeToNow, truncate } from "@/lib/utils/format";
import type { Conversation } from "@/types";

const PREVIEW_LIMIT = 4;

/**
 * Conversas que o agente parou e devolveu ao profissional.
 *
 * Ordenadas por prioridade, nao por horario: uma mensagem de possivel risco de
 * duas horas atras vem antes de uma duvida administrativa de agora.
 */
export function WaitingMessages({
  conversations,
  now,
}: {
  conversations: Conversation[];
  now: Date;
}) {
  const visible = conversations.slice(0, PREVIEW_LIMIT);
  const remaining = conversations.length - visible.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle
          action={
            <Link
              href="/mensagens"
              className="text-primary text-xs font-medium hover:underline"
            >
              Abrir caixa de entrada
            </Link>
          }
        >
          Aguardando você
        </CardTitle>
      </CardHeader>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-5" aria-hidden />}
          title="Caixa de entrada em dia"
          description="O agente respondeu tudo o que estava autorizado a responder."
        />
      ) : (
        <ul className="divide-border divide-y">
          {visible.map((conversation) => {
            const critical = conversation.attention === "CRITICAL";
            const meta = conversation.lastClassification
              ? classificationMeta(conversation.lastClassification)
              : null;

            return (
              <li
                key={conversation.id}
                className={cn(
                  "relative flex items-start gap-3 px-5 py-3.5",
                  critical && "bg-danger-soft/40",
                )}
              >
                {critical ? (
                  <span
                    aria-hidden
                    className="bg-danger absolute inset-y-0 left-0 w-0.5"
                  />
                ) : null}

                <Avatar
                  name={conversation.clientName}
                  size="sm"
                  tone={critical ? "primary" : "muted"}
                />

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-foreground truncate text-sm font-medium">
                      {conversation.clientName}
                    </p>
                    <time
                      dateTime={conversation.lastMessageAt}
                      className="text-subtle-foreground shrink-0 text-[11px]"
                    >
                      {formatRelativeToNow(conversation.lastMessageAt, now)}
                    </time>
                  </div>

                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {truncate(conversation.lastMessagePreview, 76)}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {meta ? (
                      <Badge tone={CLASSIFICATION_TONE[meta.tone]}>
                        {meta.label}
                      </Badge>
                    ) : null}
                    {critical ? (
                      <Badge tone={ATTENTION_TONE.CRITICAL} dot>
                        Automação interrompida
                      </Badge>
                    ) : null}
                    <span className="text-subtle-foreground text-[11px]">
                      {CHANNEL_LABELS[conversation.channel]}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {remaining > 0 ? (
        <div className="border-border border-t px-5 py-3">
          <Link
            href="/mensagens"
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            Mais {remaining} conversa{remaining > 1 ? "s" : ""} aguardando
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
