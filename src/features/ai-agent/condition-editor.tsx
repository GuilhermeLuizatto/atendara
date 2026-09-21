"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { CONDITION_FIELDS } from "@/config/rule-conditions";
import type { RuleCondition, RuleConditionGroup } from "@/types";

const OPERATORS = {
  EQUALS: "É igual a",
  NOT_EQUALS: "É diferente de",
  IN: "Está na lista",
  NOT_IN: "Não está na lista",
  GREATER_THAN: "É maior que",
  LESS_THAN: "É menor que",
  IS_TRUE: "É verdadeiro",
  IS_FALSE: "É falso",
};

export function ConditionEditor({
  value,
  onChange,
}: {
  value: RuleConditionGroup;
  onChange: (value: RuleConditionGroup) => void;
}) {
  const update = (index: number, patch: Partial<RuleCondition>) =>
    onChange({
      ...value,
      conditions: value.conditions.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Condições da regra</legend>
      <p className="text-muted-foreground text-xs">
        Horários seguem o fuso da organização. Sem contexto conhecido, a
        condição não autoriza uma resposta.
      </p>
      <Field label="Como combinar as condições">
        {(props) => (
          <Select
            {...props}
            value={value.combinator}
            onChange={(e) =>
              onChange({ ...value, combinator: e.target.value as "AND" | "OR" })
            }
          >
            <option value="AND">Todas devem ser atendidas</option>
            <option value="OR">Ao menos uma deve ser atendida</option>
          </Select>
        )}
      </Field>
      {value.conditions.map((condition, index) => {
        const field = CONDITION_FIELDS[condition.field];
        const list = ["IN", "NOT_IN"].includes(condition.operator);
        return (
          <div
            key={index}
            className="border-border grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
          >
            <Field label={`Condição ${index + 1}`}>
              {(props) => (
                <Select
                  {...props}
                  value={condition.field}
                  onChange={(e) => {
                    const next = e.target.value as RuleCondition["field"];
                    const kind = CONDITION_FIELDS[next].kind;
                    update(index, {
                      field: next,
                      operator: "EQUALS",
                      value:
                        kind === "boolean" ? true : kind === "number" ? 0 : "",
                    });
                  }}
                >
                  {Object.entries(CONDITION_FIELDS)
                    .filter(
                      ([key]) =>
                        key !== "appointment.status" || condition.field === key,
                    )
                    .map(([key, item]) => (
                      <option key={key} value={key}>
                        {item.label}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Comparação">
              {(props) => (
                <Select
                  {...props}
                  value={condition.operator}
                  onChange={(e) => {
                    const operator = e.target
                      .value as RuleCondition["operator"];
                    const isList = ["IN", "NOT_IN"].includes(operator);
                    update(index, {
                      operator,
                      value: isList
                        ? field.kind === "number"
                          ? [0]
                          : [""]
                        : field.kind === "boolean"
                          ? true
                          : field.kind === "number"
                            ? 0
                            : "",
                    });
                  }}
                >
                  {Object.entries(OPERATORS)
                    .filter(([operator]) =>
                      field.kind === "boolean"
                        ? [
                            "EQUALS",
                            "NOT_EQUALS",
                            "IS_TRUE",
                            "IS_FALSE",
                          ].includes(operator)
                        : !["IS_TRUE", "IS_FALSE"].includes(operator) &&
                          (field.kind === "number" ||
                            !["GREATER_THAN", "LESS_THAN"].includes(operator)),
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field
              label="Valor"
              hint={
                list && !field.options
                  ? "Separe os valores por vírgula."
                  : undefined
              }
            >
              {(props) =>
                field.options ? (
                  <Select
                    {...props}
                    className={list ? "h-32 bg-none py-2" : undefined}
                    multiple={list}
                    value={
                      list
                        ? Array.isArray(condition.value)
                          ? condition.value.map(String)
                          : []
                        : String(condition.value)
                    }
                    onChange={(e) =>
                      update(index, {
                        value: list
                          ? Array.from(
                              e.target.selectedOptions,
                              (option) => option.value,
                            )
                          : e.target.value,
                      })
                    }
                  >
                    {!list && <option value="">Selecione</option>}
                    {Object.entries(field.options).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </Select>
                ) : field.kind === "boolean" ? (
                  <Select
                    {...props}
                    value={String(condition.value)}
                    onChange={(e) =>
                      update(index, { value: e.target.value === "true" })
                    }
                  >
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </Select>
                ) : (
                  <Input
                    {...props}
                    required
                    type={field.kind === "number" && !list ? "number" : "text"}
                    min={field.min}
                    max={field.max}
                    step={condition.field === "agent.confidence" ? 0.01 : 1}
                    value={
                      Array.isArray(condition.value)
                        ? condition.value.join(",")
                        : String(condition.value)
                    }
                    onChange={(e) =>
                      update(index, {
                        value: list
                          ? field.kind === "number"
                            ? e.target.value.split(",").map(Number)
                            : e.target.value.split(",").map((v) => v.trim())
                          : field.kind === "number"
                            ? Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )
              }
            </Field>
            <Button
              variant="ghost"
              onClick={() =>
                onChange({
                  ...value,
                  conditions: value.conditions.filter((_, i) => i !== index),
                })
              }
            >
              Remover condição {index + 1}
            </Button>
          </div>
        );
      })}
      <Button
        variant="outline"
        disabled={value.conditions.length >= 10}
        onClick={() =>
          onChange({
            ...value,
            conditions: [
              ...value.conditions,
              {
                field: "context.withinBusinessHours",
                operator: "EQUALS",
                value: true,
              },
            ],
          })
        }
      >
        Adicionar condição
      </Button>
    </fieldset>
  );
}
