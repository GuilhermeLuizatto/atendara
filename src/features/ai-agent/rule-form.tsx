"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { RULE_CATEGORY_LABELS, RULE_LEVEL_LABELS } from "@/config/labels";
import { interpretRuleText } from "@/lib/rules/natural-language";
import { validateRuleInput } from "@/lib/rules/validation";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { RuleInput } from "@/services";
import {
  RULE_CATEGORIES,
  USER_EDITABLE_RULE_LEVELS,
  type AIRule,
} from "@/types";

export function RuleForm({
  rule,
  onClose,
}: {
  rule: AIRule | null;
  onClose: () => void;
}) {
  const { session, data } = useWorkspace();
  const actions = useWorkspaceActions();
  const [input, setInput] = useState<RuleInput>(
    rule ?? {
      name: "",
      description: "",
      level: "PROFESSIONAL",
      category: "PRICING",
      enabled: true,
      priority: 110,
      conditions: {
        combinator: "AND",
        conditions: [
          {
            field: "message.classification",
            operator: "EQUALS",
            value: "ADMINISTRATIVE",
          },
        ],
      },
      actions: [{ type: "ALLOW_TOPIC", payload: { topic: "PRICING" } }],
      source: "MANUAL",
      naturalLanguageInput: null,
      professionalId: session?.professionalId ?? null,
    },
  );
  const [text, setText] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [priceText, setPriceText] = useState(() => {
    const cents = rule?.actions[0]?.payload?.priceInCents;
    return typeof cents === "number"
      ? `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`
      : "";
  });
  const update = (patch: Partial<RuleInput>) =>
    setInput({ ...input, ...patch });
  const payload = input.actions[0]?.payload ?? {};
  const updatePayload = (key: string, value: string) => {
    const next = { ...payload };
    if (value === "") delete next[key];
    else next[key] = Number(value);
    update({
      actions: [
        { ...input.actions[0], payload: next },
        ...input.actions.slice(1),
      ],
    });
  };
  const interpret = () => {
    const draft = interpretRuleText(text);
    const cents = draft.actions[0]?.payload?.priceInCents;
    setPriceText(
      typeof cents === "number"
        ? `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`
        : "",
    );
    setInput({
      ...input,
      name: draft.name,
      description: draft.description,
      category: draft.category,
      conditions: draft.conditions,
      actions: draft.actions,
      source: "NATURAL_LANGUAGE",
      naturalLanguageInput: draft.sourceText,
      level:
        draft.conditions.conditions.length > 1 ? "CONTEXTUAL" : "PROFESSIONAL",
      enabled: false,
    });
    setWarnings([
      `Interpretação com ${Math.round(draft.confidence * 100)}% de confiança. Revise antes de salvar.`,
      ...draft.warnings,
    ]);
    setErrors([]);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateRuleInput(input);
    setErrors(validation.errors);
    if (!validation.valid) return;
    setBusy(true);
    const result = rule
      ? await actions.updateRule(rule.id, input)
      : await actions.createRule(input);
    setBusy(false);
    if (result !== null) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? "Editar regra" : "Adicionar regra"}
      size="lg"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="bg-surface-muted space-y-3 rounded-lg p-3">
          <Field
            label="Descreva sua regra"
            hint="Ex.: O agente pode informar que a consulta custa R$ 180 e dura 50 minutos."
          >
            {(props) => (
              <Textarea
                {...props}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={400}
              />
            )}
          </Field>
          <Button variant="outline" onClick={interpret} disabled={!text.trim()}>
            Interpretar texto
          </Button>
          {warnings.map((warning) => (
            <p className="text-warning-soft-foreground text-xs" key={warning}>
              {warning}
            </p>
          ))}
        </div>
        <Field label="Nome" required>
          {(props) => (
            <Input
              {...props}
              required
              value={input.name}
              maxLength={80}
              onChange={(e) => update({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Descrição">
          {(props) => (
            <Textarea
              {...props}
              value={input.description}
              maxLength={400}
              onChange={(e) => update({ description: e.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nível">
            {(props) => (
              <Select
                {...props}
                value={input.level}
                onChange={(e) =>
                  update({ level: e.target.value as RuleInput["level"] })
                }
              >
                {USER_EDITABLE_RULE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {RULE_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Assunto">
            {(props) => (
              <Select
                {...props}
                value={input.category}
                onChange={(e) =>
                  update({
                    category: e.target.value as RuleInput["category"],
                    actions: input.actions.map((action) => ({
                      ...action,
                      payload: { ...action.payload, topic: e.target.value },
                    })),
                  })
                }
              >
                {RULE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {RULE_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Ação">
            {(props) => (
              <Select
                {...props}
                value={input.actions[0].type}
                onChange={(e) =>
                  update({
                    actions: [
                      {
                        type: e.target
                          .value as RuleInput["actions"][number]["type"],
                        payload,
                      },
                    ],
                  })
                }
              >
                <option value="ALLOW_TOPIC">
                  Permitir informação administrativa
                </option>
                <option value="DENY_TOPIC">
                  Não responder sobre o assunto
                </option>
                <option value="ESCALATE">Encaminhar ao profissional</option>
                {!["ALLOW_TOPIC", "DENY_TOPIC", "ESCALATE"].includes(
                  input.actions[0].type,
                ) && (
                  <option value={input.actions[0].type}>Ação existente</option>
                )}
              </Select>
            )}
          </Field>
          <Field
            label="Prioridade"
            hint="Maior número prevalece dentro do mesmo nível."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                max={1000}
                value={input.priority}
                onChange={(e) => update({ priority: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Profissional">
            {(props) => (
              <Select
                {...props}
                value={input.professionalId ?? ""}
                onChange={(e) =>
                  update({ professionalId: e.target.value || null })
                }
              >
                <option value="">Toda a organização</option>
                {data?.professionals.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {input.category === "PRICING" && (
            <>
              <Field
                label="Valor (R$)"
                hint="Deixe vazio para usar o valor cadastrado."
              >
                {(props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    pattern="[0-9]+([.,][0-9]{1,2})?"
                    placeholder="180,00"
                    value={priceText}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPriceText(value);
                      const [whole, fraction = ""] = value
                        .replace(",", ".")
                        .split(".");
                      updatePayload(
                        "priceInCents",
                        value === ""
                          ? ""
                          : String(
                              Number(whole) * 100 +
                                Number(fraction.padEnd(2, "0")),
                            ),
                      );
                    }}
                  />
                )}
              </Field>
              <Field label="Duração em minutos">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={1}
                    step={1}
                    value={String(payload.durationMinutes ?? "")}
                    onChange={(e) =>
                      updatePayload("durationMinutes", e.target.value)
                    }
                  />
                )}
              </Field>
            </>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Condições adicionais</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Modalidade">
              {(props) => (
                <Select
                  {...props}
                  value={String(
                    input.conditions.conditions.find(
                      (c) => c.field === "client.modality",
                    )?.value ?? "",
                  )}
                  onChange={(e) =>
                    update({
                      conditions: {
                        ...input.conditions,
                        conditions: [
                          ...input.conditions.conditions.filter(
                            (c) => c.field !== "client.modality",
                          ),
                          ...(e.target.value
                            ? [
                                {
                                  field: "client.modality" as const,
                                  operator: "EQUALS" as const,
                                  value: e.target.value,
                                },
                              ]
                            : []),
                        ],
                      },
                    })
                  }
                >
                  <option value="">Qualquer modalidade</option>
                  <option value="ONLINE">Online</option>
                  <option value="IN_PERSON">Presencial</option>
                </Select>
              )}
            </Field>
            <Field label="Dia do recebimento">
              {(props) => (
                <Select
                  {...props}
                  value={String(
                    input.conditions.conditions.find(
                      (c) => c.field === "context.dayOfWeek",
                    )?.value ?? "",
                  )}
                  onChange={(e) =>
                    update({
                      conditions: {
                        ...input.conditions,
                        conditions: [
                          ...input.conditions.conditions.filter(
                            (c) => c.field !== "context.dayOfWeek",
                          ),
                          ...(e.target.value !== ""
                            ? [
                                {
                                  field: "context.dayOfWeek" as const,
                                  operator: "EQUALS" as const,
                                  value: Number(e.target.value),
                                },
                              ]
                            : []),
                        ],
                      },
                    })
                  }
                >
                  <option value="">Qualquer dia</option>
                  {[
                    "Domingo",
                    "Segunda",
                    "Terça",
                    "Quarta",
                    "Quinta",
                    "Sexta",
                    "Sábado",
                  ].map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
        <details>
          <summary className="text-primary cursor-pointer text-sm">
            Visualizar regra estruturada
          </summary>
          <pre className="bg-surface-muted mt-2 max-h-60 overflow-auto rounded-lg p-3 text-xs">
            {JSON.stringify(
              { conditions: input.conditions, actions: input.actions },
              null,
              2,
            )}
          </pre>
        </details>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={input.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          Ativar após salvar
        </label>
        {errors.length > 0 && (
          <div role="alert" className="text-danger text-sm">
            {errors.join(" ")}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando..." : "Confirmar e salvar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
