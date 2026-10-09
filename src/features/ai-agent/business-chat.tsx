"use client";

import { useState, type FormEvent } from "react";
import { Bot, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { answerBusinessQuestion } from "@/lib/ai/business-assistant";
import { useWorkspace } from "@/providers/workspace-provider";

interface ChatEntry {
  id: number;
  role: "USER" | "ASSISTANT";
  text: string;
}

const SAMPLES = [
  "Como está minha agenda hoje?",
  "Como está meu financeiro?",
  "Quais leads estão abertos?",
] as const;

export function BusinessChat() {
  const { data, session, activeProfessional } = useWorkspace();
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  if (!data || !session) return null;

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const answer = answerBusinessQuestion(trimmed, {
      professionalId: session.professionalId,
      timezone: data.organization.timezone,
      locale: data.organization.locale,
      currency: data.organization.currency,
      permissions: session.permissions,
      appointments: data.appointments,
      clients: data.clients,
      transactions: data.transactions,
      now: new Date().toISOString(),
    });
    setEntries((current) => [
      ...current,
      { id: current.length, role: "USER", text: trimmed },
      { id: current.length + 1, role: "ASSISTANT", text: answer.text },
    ]);
    setQuestion("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(question);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Card className="flex min-h-[560px] flex-col">
        <div className="border-border border-b p-4">
          <h2 className="font-semibold">Converse com a Dara</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Contexto ativo:{" "}
            {activeProfessional?.displayName ?? "nenhum profissional"}.
          </p>
        </div>
        <div
          className="flex-1 space-y-3 overflow-y-auto p-4"
          aria-live="polite"
        >
          {!entries.length ? (
            <p className="text-muted-foreground text-sm">
              Pergunte sobre a agenda de hoje, o financeiro ou os leads deste
              profissional.
            </p>
          ) : null}
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={
                entry.role === "USER"
                  ? "bg-primary-soft ml-auto max-w-[90%] rounded-xl p-3 text-sm"
                  : "bg-surface-muted max-w-[90%] rounded-xl p-3 text-sm"
              }
            >
              <span className="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
                {entry.role === "USER" ? (
                  <UserRound className="size-3" aria-hidden />
                ) : (
                  <Bot className="size-3" aria-hidden />
                )}
                {entry.role === "USER" ? "Você" : "Dara"}
              </span>
              <p className="whitespace-pre-wrap">{entry.text}</p>
            </div>
          ))}
        </div>
        <form
          onSubmit={submit}
          className="border-border space-y-3 border-t p-4"
        >
          <Field label="Pergunta sobre o negócio">
            {(props) => (
              <Textarea
                {...props}
                maxLength={500}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ex.: como está minha agenda hoje?"
              />
            )}
          </Field>
          <Button type="submit" disabled={!question.trim()}>
            Perguntar
          </Button>
        </form>
      </Card>
      <Card className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">Perguntas rápidas</h3>
          <div className="mt-3 space-y-2">
            {SAMPLES.map((sample) => (
              <Button
                key={sample}
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => ask(sample)}
              >
                {sample}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Este chat usa somente os dados administrativos já autorizados e
          carregados para o profissional ativo. Não consulta prontuário,
          mensagens de clientes ou cobrança da plataforma.
        </p>
      </Card>
    </div>
  );
}
