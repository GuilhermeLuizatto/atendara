"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { decide, type DecisionResult } from "@/lib/ai/decision-engine";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Conversation, Message } from "@/types";

export function ReplyAssistant({
  conversation,
  message,
  onUse,
}: {
  conversation: Conversation;
  message: Message;
  onUse: (text: string) => void;
}) {
  const { data, session, profession } = useWorkspace();
  const [result, setResult] = useState<DecisionResult | null>(null);
  if (!data || !session?.permissions.includes("conversation:reply"))
    return null;
  const prepare = () => {
    const client = data.clients.find(
      (item) => item.id === conversation.clientId,
    );
    setResult(
      decide({
        text: message.body,
        profession,
        organization: data.organization,
        rules: data.rules,
        channel: conversation.channel,
        client: client
          ? {
              modality: client.preferredModality,
              status: client.status,
              hasOutstandingBalance: client.outstandingBalanceInCents > 0,
            }
          : null,
        now: new Date(),
        professionalId: conversation.professionalId,
        permissions: session.permissions,
        humanHandoff: conversation.escalated,
      }),
    );
  };
  return (
    <section
      className="bg-surface-muted space-y-3 rounded-lg p-3"
      aria-label="Assistência para resposta"
    >
      <Button variant="outline" size="sm" onClick={prepare}>
        Preparar resposta com a Dara
      </Button>
      <p className="text-muted-foreground text-xs">
        A Dara consulta as autorizações atuais. Você revisa o rascunho antes de
        registrar a resposta.
      </p>
      {result && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-muted-foreground text-sm">{result.reason}</p>
          {result.responseText && (
            <>
              <p className="text-sm whitespace-pre-wrap">
                {result.responseText}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onUse(result.responseText!);
                  setResult(null);
                }}
              >
                Usar sugestão no rascunho
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
