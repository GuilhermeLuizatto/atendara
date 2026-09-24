"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { validateAISettings } from "@/lib/ai/settings";
import { useWorkspace } from "@/providers/workspace-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import type { AIAgentSettings } from "@/types";

export function AgentSettings({ initial }: { initial: AIAgentSettings }) {
  const { session } = useWorkspace();
  const { run } = useWorkspaceActions();
  const [settings, setSettings] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const canEdit = session?.permissions.includes("organization:update");
  const update = (patch: Partial<AIAgentSettings>) =>
    setSettings({ ...settings, ...patch });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors = validateAISettings(settings);
    setErrors(errors);
    if (errors.length) return;
    setBusy(true);
    await run(
      (repo) => repo.updateAISettings(settings),
      "Autorizações da Dara salvas e registradas na auditoria.",
    );
    setBusy(false);
  };
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">Autorizações da assistente</h2>
      <p className="text-muted-foreground text-sm">
        Toda resposta exige uma regra ativa. Risco, conteúdo sensível e dúvidas
        continuam com a equipe. Habilitar a Dara não habilita canais de envio.
      </p>
      {!canEdit && (
        <p className="text-muted-foreground text-sm">
          Somente a administração da organização pode alterar estas
          autorizações.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={!canEdit || busy} className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            Habilitar Dara
          </label>
          <Field label="Nome da assistente">
            {(props) => (
              <Input
                {...props}
                required
                maxLength={60}
                value={settings.displayName}
                onChange={(e) => update({ displayName: e.target.value })}
              />
            )}
          </Field>
          <Field label="Modo de resposta">
            {(props) => (
              <Select
                {...props}
                value={settings.allowAutonomousReplies ? "AUTO" : "SUGGEST"}
                onChange={(e) =>
                  update({ allowAutonomousReplies: e.target.value === "AUTO" })
                }
              >
                <option value="SUGGEST">
                  Preparar sugestão para revisão humana
                </option>
                <option value="AUTO">
                  Autorizar resposta administrativa automática
                </option>
              </Select>
            )}
          </Field>
          <Field
            label="Confiança mínima (%)"
            hint="Pontuação heurística, não uma garantia de acerto."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={80}
                max={100}
                step={1}
                required
                value={Math.round(
                  settings.autoResponseConfidenceThreshold * 100,
                )}
                onChange={(e) =>
                  update({
                    autoResponseConfidenceThreshold:
                      Number(e.target.value) / 100,
                  })
                }
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Silêncio a partir de"
              hint="Fuso da organização. Deixe ambos vazios para desativar."
            >
              {(props) => (
                <Input
                  {...props}
                  type="time"
                  value={settings.quietHoursStart ?? ""}
                  onChange={(e) =>
                    update({ quietHoursStart: e.target.value || null })
                  }
                />
              )}
            </Field>
            <Field label="Silêncio até">
              {(props) => (
                <Input
                  {...props}
                  type="time"
                  value={settings.quietHoursEnd ?? ""}
                  onChange={(e) =>
                    update({ quietHoursEnd: e.target.value || null })
                  }
                />
              )}
            </Field>
          </div>
          {canEdit && (
            <Button type="submit">
              {busy ? "Salvando..." : "Salvar autorizações"}
            </Button>
          )}
        </fieldset>
        {!!errors.length && (
          <p role="alert" className="text-danger text-sm">
            {errors.join(" ")}
          </p>
        )}
      </form>
    </Card>
  );
}
