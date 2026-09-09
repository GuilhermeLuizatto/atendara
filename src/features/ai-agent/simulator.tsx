"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { fromDateAndTime, toDateKey } from "@/lib/utils/datetime";
import { useWorkspace } from "@/providers/workspace-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { DecisionDetails } from "./decision-details";

export function Simulator() {
  const { data, terminology } = useWorkspace();
  const { run } = useWorkspaceActions();
  const [selectedId, setSelectedId] = useState("");
  const [text, setText] = useState("");
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState("10:00");
  if (!data) return null;
  const conversationId =
    selectedId ||
    data.conversations.find((item) => !item.escalated)?.id ||
    data.conversations[0]?.id ||
    "";
  const decision = data.decisions.find((item) => item.id === decisionId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const id = await run(
      (repo) =>
        repo.receiveMessage(
          conversationId,
          text,
          fromDateAndTime(toDateKey(new Date()), time),
        ),
      "Simulacao registrada na conversa e na auditoria.",
    );
    setSelectedId(conversationId);
    setDecisionId(id);
    setBusy(false);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-semibold">Testar agente</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Simule uma mensagem de {terminology.client.singularLower}. O resultado
          fica nas mensagens e na auditoria; escalonamentos geram alertas no
          dashboard.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field
            label="Horario simulado de hoje"
            hint="Horario de Sao Paulo. A janela de silencio e respeitada."
          >
            {(props) => (
              <Input
                {...props}
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            )}
          </Field>
          <Field label="Conversa de demonstracao">
            {(props) => (
              <Select
                {...props}
                value={conversationId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setDecisionId(null);
                }}
              >
                {data.conversations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.clientName}
                    {item.escalated ? " · Atendimento humano" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            {[
              "Qual o valor da consulta?",
              "Quero remarcar minha consulta.",
              "Quero falar de um assunto diferente.",
              "Nao aguento mais, preciso de ajuda.",
            ].map((sample) => (
              <Button
                key={sample}
                size="sm"
                variant="outline"
                onClick={() => setText(sample)}
              >
                {sample}
              </Button>
            ))}
          </div>
          <Field label="Mensagem do cliente">
            {(props) => (
              <Textarea
                {...props}
                required
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                placeholder="Digite uma mensagem como se fosse um cliente"
              />
            )}
          </Field>
          <Button
            type="submit"
            disabled={busy || !text.trim() || !conversationId}
          >
            {busy ? "Avaliando..." : "Simular mensagem"}
          </Button>
        </form>
      </Card>
      <Card className="p-5" aria-live="polite">
        {decision ? (
          <DecisionDetails decision={decision} />
        ) : (
          <div className="text-muted-foreground flex min-h-60 items-center justify-center text-center text-sm">
            A classificacao, as regras e a decisao aparecerao aqui.
          </div>
        )}
      </Card>
    </div>
  );
}
