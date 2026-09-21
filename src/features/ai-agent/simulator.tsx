"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { decide, type DecisionResult } from "@/lib/ai/decision-engine";
import { useWorkspace } from "@/providers/workspace-provider";
import { CLIENT_STATUS_LABELS, MODALITY_LABELS } from "@/config/labels";
import { fromDateAndTime } from "@/lib/utils/datetime";
import type { ServiceModality } from "@/types";
import { DecisionDetails } from "./decision-details";

export function Simulator() {
  const { data, profession, session } = useWorkspace();
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("WEB_CHAT");
  const [professionalId, setProfessionalId] = useState("");
  const [at, setAt] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [modality, setModality] = useState("");
  const [status, setStatus] = useState("");
  const [balance, setBalance] = useState("");
  const [decision, setDecision] = useState<DecisionResult | null>(null);
  if (!data) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setDecision(
      decide({
        text,
        profession,
        organization: data.organization,
        rules: data.rules,
        channel,
        client: {
          modality: (modality || null) as ServiceModality | null,
          status: status || null,
          hasOutstandingBalance: balance === "" ? null : balance === "true",
        },
        now: at
          ? new Date(fromDateAndTime(at.slice(0, 10), at.slice(11)))
          : new Date(),
        professionalId: professionalId || session?.professionalId || null,
        permissions: session?.permissions ?? [],
        humanHandoff: handoff,
      }),
    );
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Testar Dara</h2>
        <p className="text-muted-foreground text-sm">
          Prévia local com as regras e permissões atuais. Não envia mensagens,
          altera conversas ou grava decisões. Use exemplos fictícios.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Profissional">
            {(props) => (
              <Select
                {...props}
                value={professionalId}
                onChange={(e) => setProfessionalId(e.target.value)}
              >
                <option value="">Responsável atual</option>
                {data.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Canal">
            {(props) => (
              <Select
                {...props}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="WEB_CHAT">Chat</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">E-mail</option>
                <option value="SMS">SMS</option>
                <option value="INSTAGRAM">Instagram</option>
              </Select>
            )}
          </Field>
          <Field
            label="Data e hora de São Paulo (opcional)"
            hint={`Vazio usa o momento atual. As regras convertem para ${data.organization.timezone}.`}
          >
            {(props) => (
              <Input
                {...props}
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            )}
          </Field>
          <details className="space-y-3">
            <summary className="text-primary cursor-pointer text-sm">
              Contexto fictício do cliente
            </summary>
            <Field label="Modalidade">
              {(props) => (
                <Select
                  {...props}
                  value={modality}
                  onChange={(e) => setModality(e.target.value)}
                >
                  <option value="">Desconhecida</option>
                  {Object.entries(MODALITY_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Situação do cadastro">
              {(props) => (
                <Select
                  {...props}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Desconhecida</option>
                  {Object.entries(CLIENT_STATUS_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Saldo pendente">
              {(props) => (
                <Select
                  {...props}
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                >
                  <option value="">Desconhecido</option>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </Select>
              )}
            </Field>
          </details>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={handoff}
              onChange={(e) => setHandoff(e.target.checked)}
            />
            Conversa assumida pela equipe
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              "Qual o valor da consulta?",
              "Quero remarcar minha consulta.",
              "Qual o valor e onde fica?",
              "Não aguento mais, preciso de ajuda.",
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
          <Field label="Mensagem fictícia">
            {(props) => (
              <Textarea
                {...props}
                required
                maxLength={4000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" disabled={!text.trim()}>
            Avaliar sem enviar
          </Button>
        </form>
      </Card>
      <Card className="space-y-4 p-5" aria-live="polite">
        {decision ? (
          <>
            <p className="text-muted-foreground text-xs">
              Resultado da última avaliação. Após alterar regras ou campos,
              avalie novamente.
            </p>
            <DecisionDetails decision={decision} />
            <ol className="space-y-2">
              {decision.trace.steps.map((step, index) => (
                <li key={index} className="text-sm">
                  <strong>{step.label}: </strong>
                  {step.detail}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            A classificação, as regras e a decisão aparecerão aqui.
          </p>
        )}
      </Card>
    </div>
  );
}
