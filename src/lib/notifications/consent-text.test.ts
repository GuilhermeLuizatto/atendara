import { describe, expect, it } from "vitest";

import {
  CHANNEL_META,
  FORBIDDEN_TEMPLATE_TERMS,
  NOTIFICATION_CONSENT_TEXT_VERSION,
} from "@/config/notifications";
import { listProfessions } from "@/config/professions";

import { consentStatement } from "./consent-text";

const fold = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

describe("texto de consentimento dos avisos", () => {
  it("diz quem envia, por onde, o que, por quem passa e como retirar", () => {
    const statement = consentStatement({
      organizationName: "Clinica Exemplo",
      channels: ["EMAIL", "WHATSAPP"],
      events: ["APPOINTMENT_REMINDER", "APPOINTMENT_CANCELLED"],
      disclosure: "TIME_ONLY",
    });
    const text = statement.paragraphs.join(" ");

    expect(statement.version).toBe(NOTIFICATION_CONSENT_TEXT_VERSION);
    expect(statement.reviewStatus).toBe("DRAFT_PENDING_LEGAL_REVIEW");
    expect(text).toContain("Clinica Exemplo pode enviar");
    expect(text).toContain("E-mail e WhatsApp");
    expect(text).toContain("lembrete antes do horario e cancelamento do horario");
    expect(text).toContain(CHANNEL_META.WHATSAPP.consentIntermediary);
    expect(text).toContain("opcional");
    expect(text).toContain("retirar a autorizacao");
    expect(text).not.toContain("quem atende");
  });

  it("promete exatamente o grau de exposicao da profissao", () => {
    const base = { organizationName: "X", channels: ["EMAIL"] as const, events: ["APPOINTMENT_REMINDER"] as const };
    const onlyTime = consentStatement({ ...base, disclosure: "TIME_ONLY" }).paragraphs.join(" ");
    const withProfessional = consentStatement({ ...base, disclosure: "TIME_AND_PROFESSIONAL" }).paragraphs.join(" ");
    const withService = consentStatement({ ...base, disclosure: "TIME_PROFESSIONAL_AND_SERVICE" }).paragraphs.join(" ");

    expect(onlyTime).not.toContain("tipo de atendimento");
    expect(withProfessional).toContain("quem atende");
    expect(withProfessional).not.toContain("tipo de atendimento");
    expect(withService).toContain("tipo de atendimento");
  });

  it("nao usa vocabulario clinico em nenhuma profissao, nem sem nome de organizacao", () => {
    for (const profession of listProfessions()) {
      const statement = consentStatement({
        organizationName: "",
        channels: profession.notifications.allowedChannels,
        events: profession.notifications.allowedEvents,
        disclosure: profession.notifications.disclosure,
      });
      const text = fold(statement.paragraphs.join(" "));
      for (const term of FORBIDDEN_TEMPLATE_TERMS) expect(text, `${profession.id}: ${term}`).not.toContain(term);
      expect(statement.paragraphs[0].startsWith("Esta organizacao")).toBe(true);
    }
  });
});
