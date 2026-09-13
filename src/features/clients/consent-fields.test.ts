import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NOTIFICATION_CONSENT_TEXT_VERSION } from "@/config/notifications";
import { getProfession } from "@/config/professions";
import { channelHistory } from "@/lib/notifications/consent-record";
import { STAFF_MEMBER, client, consent, consentAct, consentRecord } from "@/lib/notifications/fixtures";
import type { LegacyNotificationConsent, StoredNotificationConsent } from "@/types";

import { ConsentFields, consentFromDraft, initialConsentDraft, type ConsentDraft } from "./consent-fields";

/**
 * O consentimento na tela do cadastro: o que ela grava e o que ela mostra. A
 * conferencia no navegador com login fica com o titular; aqui a tela e provada
 * sem sessao, pela mesma funcao que monta o valor gravado.
 */

const NOW = "2026-09-12T15:00:00.000Z";
const LEGACY: LegacyNotificationConsent = {
  channels: ["EMAIL"],
  grantedAt: "2026-09-01T10:00:00.000Z",
  revokedAt: null,
  source: "CLIENT_FORM",
};

function draft(overrides: Partial<ConsentDraft> = {}): ConsentDraft {
  return {
    enabled: true,
    channels: [],
    medium: "",
    subjectIsMinor: false,
    guardianName: "",
    guardianRelationship: "",
    ...overrides,
  };
}

describe("o que a tela grava", () => {
  it("sem mudanca devolve o que estava salvo e nao pede meio", () => {
    const saved = consent({ EMAIL: [consentRecord()] });
    expect(consentFromDraft(saved, draft({ channels: ["EMAIL"] }), STAFF_MEMBER, NOW)).toEqual({ consent: saved, errors: {} });
  });

  it("registrar exige o meio e quem esta registrando", () => {
    const { consent: value, errors } = consentFromDraft(null, draft({ channels: ["WHATSAPP"] }), null, NOW);
    expect(value).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["medium", "recorder"]);
  });

  it("menor de idade exige nome e vinculo do responsavel legal", () => {
    const { errors } = consentFromDraft(
      null,
      draft({ channels: ["WHATSAPP"], medium: "FORM", subjectIsMinor: true, guardianName: "Ru" }),
      STAFF_MEMBER,
      NOW,
    );
    expect(Object.keys(errors).sort()).toEqual(["guardianName", "guardianRelationship"]);
  });

  it("grava em nome de quem usa o painel, com a versao atual do texto", () => {
    const { consent: value, errors } = consentFromDraft(
      null,
      draft({
        channels: ["WHATSAPP"],
        medium: "WRITTEN_DOCUMENT",
        subjectIsMinor: true,
        guardianName: " Rui Ficticio ",
        guardianRelationship: "PARENT",
      }),
      STAFF_MEMBER,
      NOW,
    );

    expect(errors).toEqual({});
    expect(channelHistory(value, "WHATSAPP")).toEqual([
      {
        granted: { at: NOW, recordedBy: { kind: "STAFF", userId: STAFF_MEMBER }, medium: "WRITTEN_DOCUMENT" },
        textVersion: NOTIFICATION_CONSENT_TEXT_VERSION,
        subjectIsMinor: true,
        legalGuardian: { fullName: "Rui Ficticio", relationship: "PARENT" },
        withdrawn: null,
      },
    ]);
  });

  it("desmarcar o aceite geral retira os canais vigentes, sem apagar nada", () => {
    const saved = consent({ EMAIL: [consentRecord()], SMS: [consentRecord()] });
    const unchecked = draft({ enabled: false, channels: ["EMAIL", "SMS"] });

    expect(consentFromDraft(saved, unchecked, STAFF_MEMBER, NOW).errors).toHaveProperty("medium");

    const { consent: value } = consentFromDraft(saved, { ...unchecked, medium: "MESSAGE" }, STAFF_MEMBER, NOW);
    for (const channel of ["EMAIL", "SMS"] as const) {
      expect(channelHistory(value, channel)).toEqual([
        { ...consentRecord(), withdrawn: { at: NOW, recordedBy: { kind: "STAFF", userId: STAFF_MEMBER }, medium: "MESSAGE" } },
      ]);
    }
  });

  it("cadastro no formato antigo comeca sem canal marcado e guarda o antigo ao registrar", () => {
    expect(initialConsentDraft(client({ notificationConsent: LEGACY })).channels).toEqual([]);
    const { consent: value } = consentFromDraft(LEGACY, draft({ channels: ["EMAIL"], medium: "FORM" }), STAFF_MEMBER, NOW);
    expect(value).toMatchObject({ formatVersion: 2, legacy: LEGACY });
  });

  it("parte dos canais vigentes e sugere o responsavel do registro mais recente, nunca o meio", () => {
    const guardian = { fullName: "Rui Ficticio", relationship: "LEGAL_GUARDIAN" as const };
    const saved = consent({ SMS: [consentRecord({ subjectIsMinor: true, legalGuardian: guardian })] });
    expect(initialConsentDraft(client({ notificationConsent: saved }))).toMatchObject({
      channels: ["SMS"],
      subjectIsMinor: true,
      guardianName: "Rui Ficticio",
      guardianRelationship: "LEGAL_GUARDIAN",
      medium: "",
    });
  });
});

describe("o que a tela mostra", () => {
  const profession = getProfession("PSYCHOLOGIST");
  const render = (saved: StoredNotificationConsent | null, value: ConsentDraft) =>
    renderToStaticMarkup(
      createElement(ConsentFields, {
        organizationName: "Consultório Exemplo",
        profession,
        saved,
        draft: value,
        errors: {},
        disabled: false,
        onChange: () => {},
      }),
    );

  it("mostra o historico inteiro do canal, inclusive o registro retirado e o responsavel", () => {
    const saved = consent({
      WHATSAPP: [
        consentRecord({
          subjectIsMinor: true,
          legalGuardian: { fullName: "Rui Ficticio", relationship: "PARENT" },
          withdrawn: consentAct({ medium: "MESSAGE" }),
        }),
        consentRecord(),
      ],
    });
    const html = render(saved, draft({ channels: ["WHATSAPP"] }));

    expect(html).toContain("Histórico do consentimento");
    expect(html.match(/autorizado em/g)).toHaveLength(2);
    expect(html.match(/retirado em/g)).toHaveLength(1);
    expect(html).toContain("pelo responsável legal Rui Ficticio (Mãe ou pai)");
    expect(html).not.toContain("Como a pessoa se manifestou");
  });

  it("pede o meio so quando ha mudanca, e avisa que o formato antigo nao autoriza aviso", () => {
    const html = render(LEGACY, draft({ channels: ["EMAIL"] }));

    expect(html).toContain("formato antigo");
    expect(html).toContain("Registro desta alteração: autoriza E-mail.");
    expect(html).toContain("Como a pessoa se manifestou");
    expect(html).toContain("A pessoa é menor de idade");
  });
});
