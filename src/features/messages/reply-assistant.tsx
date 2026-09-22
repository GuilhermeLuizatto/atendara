"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type DecisionResult } from "@/lib/ai/decision-engine";
import { previewDecision } from "@/services/ai/preview";
import { isDemoMode } from "@/lib/firebase/config";
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
  const [useGemini, setUseGemini] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data || !session?.permissions.includes("conversation:reply"))
    return null;
  const prepare = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const client = data.clients.find(
      (item) => item.id === conversation.clientId,
    );
    try {
      setResult(
        await previewDecision(
          {
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
          },
          useGemini,
          { conversationId: conversation.id, messageId: message.id },
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível preparar a resposta.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="bg-surface-muted space-y-3 rounded-lg p-3"
      aria-label="Assistência para resposta"
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useGemini}
          disabled={isDemoMode || busy}
          onChange={(event) => setUseGemini(event.target.checked)}
        />
        Interpretar com Gemini
      </label>
      {useGemini && (
        <p className="text-muted-foreground text-xs">
          A mensagem poderá ser processada pelo Google se a integração estiver
          ativa.
        </p>
      )}
      <Button variant="outline" size="sm" onClick={prepare} disabled={busy}>
        {busy ? "Preparando…" : "Preparar resposta com a Dara"}
      </Button>
      <p className="text-muted-foreground text-xs">
        A Dara consulta as autorizações atuais. Você revisa o rascunho antes de
        registrar a resposta.
      </p>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-muted-foreground text-sm">{result.reason}</p>
          {useGemini && (
            <p className="text-muted-foreground text-xs">
              {
                result.trace.steps.find(
                  (step) => step.label === "Interpretação",
                )?.detail
              }
            </p>
          )}
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
