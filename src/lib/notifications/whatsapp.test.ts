import { describe, expect, it } from "vitest";

import { APPOINTMENT_EVENT_META } from "@/config/notifications";
import { listAllProfessions } from "@/config/professions";
import { WHATSAPP_TEMPLATES, whatsappTemplateFor } from "@/config/whatsapp";
import type { AppointmentDisclosureLevel, AppointmentNotificationEvent } from "@/types";

import type { TemplateContext } from "./templates";
import { whatsappMessageFor } from "./whatsapp";

const CONTEXT: TemplateContext = {
  clientName: "Alex",
  organizationName: "Clínica Fictícia",
  professionalName: "Sam Fictício",
  serviceTerm: "consulta",
  date: "11/09/2026",
  time: "09:00",
};

const DISCLOSURES: AppointmentDisclosureLevel[] = [
  "TIME_ONLY",
  "TIME_AND_PROFESSIONAL",
  "TIME_PROFESSIONAL_AND_SERVICE",
];

describe("o modelo aprovado que vai para a Meta", () => {
  it("manda os valores na ordem que o modelo numera", () => {
    const mensagem = whatsappMessageFor({
      channel: "WHATSAPP",
      event: "APPOINTMENT_REMINDER",
      disclosure: "TIME_AND_PROFESSIONAL",
      context: CONTEXT,
    });

    expect(mensagem).toEqual({
      name: "atendara_lembrete_profissional",
      language: "pt_BR",
      parameters: ["Alex", "Clínica Fictícia", "Sam Fictício", "11/09/2026", "09:00"],
      buttons: ["CONFIRM", "RESCHEDULE"],
    });
  });

  it("o grau de exposicao mais fechado nao leva nome de quem atende nem servico", () => {
    const mensagem = whatsappMessageFor({
      channel: "WHATSAPP",
      event: "APPOINTMENT_REMINDER",
      disclosure: "TIME_ONLY",
      context: CONTEXT,
    });

    expect(mensagem?.parameters).not.toContain("Sam Fictício");
    expect(mensagem?.parameters).not.toContain("consulta");
  });

  it("nenhum outro canal recebe modelo, e evento sem modelo devolve nada", () => {
    expect(
      whatsappMessageFor({ channel: "SMS", event: "APPOINTMENT_REMINDER", disclosure: "TIME_ONLY", context: CONTEXT }),
    ).toBeNull();
    expect(
      whatsappMessageFor({
        channel: "WHATSAPP",
        event: "APPOINTMENT_CANCELLED",
        disclosure: "TIME_ONLY",
        context: CONTEXT,
      }),
    ).toBeNull();
  });
});

describe("o catalogo de modelos", () => {
  it("cobre os tres graus de exposicao em todo evento que tem modelo", () => {
    for (const [event, porGrau] of Object.entries(WHATSAPP_TEMPLATES)) {
      for (const disclosure of DISCLOSURES) {
        const template = whatsappTemplateFor(event as AppointmentNotificationEvent, disclosure);
        expect(template, `${event} / ${disclosure}`).toBeTruthy();
        expect(template?.language).toBe("pt_BR");
        expect(porGrau[disclosure].name).toMatch(/^atendara_[a-z_]+$/);
      }
    }
  });

  it("nao promete modelo para evento que o servidor nao executa", () => {
    // `APPOINTMENT_SCHEDULED` e `APPOINTMENT_CANCELLED` ainda nao viram tarefa:
    // ter modelo para eles daria a entender que algo sai.
    expect(WHATSAPP_TEMPLATES.APPOINTMENT_SCHEDULED).toBeUndefined();
    expect(WHATSAPP_TEMPLATES.APPOINTMENT_CANCELLED).toBeUndefined();
    expect(Object.keys(APPOINTMENT_EVENT_META)).toContain("APPOINTMENT_SCHEDULED");
  });

  it("o grau de cada profissao tem modelo — nenhuma profissao fica sem WhatsApp por falta de cadastro", () => {
    for (const profession of listAllProfessions()) {
      if (!profession.notifications.allowedChannels.includes("WHATSAPP")) continue;
      for (const event of profession.notifications.allowedEvents) {
        if (!WHATSAPP_TEMPLATES[event]) continue;
        expect(
          whatsappTemplateFor(event, profession.notifications.disclosure),
          `${profession.id} / ${event}`,
        ).toBeTruthy();
      }
    }
  });
});
