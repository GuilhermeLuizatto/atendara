import { describe, expect, it } from "vitest";

import { getProfession } from "@/config/professions";
import { appointment, client, organization } from "@/lib/notifications/fixtures";

import { decideDispatch, type DispatchInput } from "./dispatch";
import { AUTOMATION_SWITCH_ON, outboundBlock, SWITCH_RETRY_MINUTES, switchRetryAt } from "./emergency";
import { ANCHOR, PROFESSIONAL_NAME, REMINDER_AT, plannedReminder } from "./fixtures";
import { dispatchPayloadFor, transitionTask } from "./tasks";

const DESLIGADA = { enabled: false, reason: "Investigando envio errado.", changedAt: ANCHOR, changedBy: "titular" };

describe("as duas chaves", () => {
  it("ausente e ligada: quem nunca tocou na chave nao fica mudo por omissao", () => {
    expect(outboundBlock({ global: null, organization: null })).toBeNull();
    expect(outboundBlock({ global: AUTOMATION_SWITCH_ON, organization: AUTOMATION_SWITCH_ON })).toBeNull();
  });

  it("qualquer uma desligada para a saida, e a geral vem primeiro no motivo", () => {
    expect(outboundBlock({ global: null, organization: DESLIGADA })).toBe("ORGANIZATION_SWITCH_OFF");
    expect(outboundBlock({ global: DESLIGADA, organization: null })).toBe("GLOBAL_SWITCH_OFF");
    expect(outboundBlock({ global: DESLIGADA, organization: DESLIGADA })).toBe("GLOBAL_SWITCH_OFF");
  });

  it("a geral ligada NAO religa quem desligou a propria", () => {
    expect(outboundBlock({ global: AUTOMATION_SWITCH_ON, organization: DESLIGADA })).toBe("ORGANIZATION_SWITCH_OFF");
  });

  it("a espera ate tentar de novo e curta, mas nao imediata", () => {
    expect(switchRetryAt("2026-09-20T12:00:00.000Z")).toBe(
      new Date(Date.parse("2026-09-20T12:00:00.000Z") + SWITCH_RETRY_MINUTES * 60_000).toISOString(),
    );
  });
});

describe("o despachante com a chave desligada", () => {
  function entrada(patch: Partial<DispatchInput> = {}): DispatchInput {
    const { task, delivery } = plannedReminder();
    const scheduled = transitionTask(task, "SCHEDULED", { at: ANCHOR });
    const org = organization();
    return {
      payload: dispatchPayloadFor(scheduled),
      task: scheduled,
      delivery,
      organization: org,
      profession: getProfession(org.primaryProfession),
      appointment: appointment(),
      client: client(),
      professionalName: PROFESSIONAL_NAME,
      sender: null,
      now: REMINDER_AT,
      ...patch,
    };
  }

  it("nao envia, e tambem NAO cancela: a tarefa espera e volta ao religar", () => {
    const passo = decideDispatch(entrada({ switches: { organization: DESLIGADA, global: null } }));

    expect(passo.kind).toBe("REQUEUE");
    if (passo.kind !== "REQUEUE") throw new Error(passo.kind);
    // Estado e tentativa intactos: religar nao perde o aviso.
    expect(passo.task.status).toBe("SCHEDULED");
    expect(passo.task.attempt).toBe(1);
    expect(Date.parse(passo.at)).toBeGreaterThan(Date.parse(REMINDER_AT));
  });

  it("a chave geral para a saida de qualquer organizacao", () => {
    expect(decideDispatch(entrada({ switches: { organization: null, global: DESLIGADA } })).kind).toBe("REQUEUE");
  });

  it("com as duas ligadas, o envio segue normalmente", () => {
    const passo = decideDispatch(entrada({ switches: { organization: AUTOMATION_SWITCH_ON, global: AUTOMATION_SWITCH_ON } }));
    expect(passo.kind).toBe("SEND");
  });

  it("sem chave nenhuma gravada, o envio segue — ausente e ligada", () => {
    expect(decideDispatch(entrada()).kind).toBe("SEND");
  });
});
