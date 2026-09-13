import { describe, expect, it } from "vitest";

import type { LegacyNotificationConsent, StoredNotificationConsent } from "@/types";

import {
  activeConsentChannels,
  applyConsentChanges,
  channelHistory,
  consentAuditMetadata,
  isAllowedConsentTransition,
  latestConsentRecord,
  plannedConsentChanges,
  type ConsentGrantDetails,
} from "./consent-record";
import { consentProblemFor } from "./eligibility";
import { ANCHOR, STAFF_MEMBER, consent, consentAct, consentRecord } from "./fixtures";

/**
 * O historico do consentimento por canal. Os casos de `isAllowedConsentTransition`
 * sao os mesmos que `scripts/test-firestore-rules.mjs` prova contra as regras.
 */

const ADULT: ConsentGrantDetails = { textVersion: "2026-09-11-rascunho", subjectIsMinor: false, legalGuardian: null };
const LATER = "2026-09-10T15:00:00.000Z";
const LEGACY: LegacyNotificationConsent = {
  channels: ["EMAIL"],
  grantedAt: ANCHOR,
  revokedAt: null,
  source: "CLIENT_FORM",
  textVersion: "2026-09-10-rascunho",
};

function grant(saved: StoredNotificationConsent | null, channels: Parameters<typeof plannedConsentChanges>[1]) {
  return applyConsentChanges(saved, plannedConsentChanges(saved, channels), consentAct(), ADULT);
}

describe("registrar e retirar por canal", () => {
  it("planeja so o que muda", () => {
    const saved = consent({ EMAIL: [consentRecord()], SMS: [consentRecord({ withdrawn: consentAct() })] });

    expect(plannedConsentChanges(null, ["EMAIL"])).toEqual([{ channel: "EMAIL", kind: "GRANTED" }]);
    expect(plannedConsentChanges(saved, ["EMAIL"])).toEqual([]);
    expect(plannedConsentChanges(saved, ["SMS"])).toEqual([
      { channel: "EMAIL", kind: "WITHDRAWN" },
      { channel: "SMS", kind: "GRANTED" },
    ]);
  });

  it("retirar um canal nao apaga o historico dele, e autorizar de novo acrescenta", () => {
    const first = grant(null, ["WHATSAPP", "EMAIL"]);
    const original = channelHistory(first, "WHATSAPP")[0];

    const withdrawAct = consentAct({ at: LATER, medium: "MESSAGE" });
    const withdrawn = applyConsentChanges(first, plannedConsentChanges(first, ["EMAIL"]), withdrawAct, ADULT);
    expect(channelHistory(withdrawn, "WHATSAPP")).toEqual([{ ...original, withdrawn: withdrawAct }]);
    expect(activeConsentChannels(withdrawn)).toEqual(["EMAIL"]);

    const regrantAct = consentAct({ at: "2026-09-10T16:00:00.000Z", medium: "WRITTEN_DOCUMENT" });
    const again = applyConsentChanges(
      withdrawn,
      plannedConsentChanges(withdrawn, ["EMAIL", "WHATSAPP"]),
      regrantAct,
      { ...ADULT, textVersion: "2026-10-01-revisado" },
    );
    const history = channelHistory(again, "WHATSAPP");
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ ...original, withdrawn: withdrawAct });
    expect(history[1]).toMatchObject({ granted: regrantAct, textVersion: "2026-10-01-revisado", withdrawn: null });
    expect(consentProblemFor({ appointmentNotificationsEnabled: true, notificationConsent: again }, "WHATSAPP")).toBeNull();
  });

  it("guarda o responsavel legal so quando a pessoa e menor de idade", () => {
    const guardian = { fullName: "Rui Ficticio", relationship: "PARENT" as const };
    const minor = applyConsentChanges(null, [{ channel: "SMS", kind: "GRANTED" }], consentAct(), {
      ...ADULT,
      subjectIsMinor: true,
      legalGuardian: guardian,
    });
    const adult = applyConsentChanges(null, [{ channel: "SMS", kind: "GRANTED" }], consentAct(), {
      ...ADULT,
      legalGuardian: guardian,
    });

    expect(channelHistory(minor, "SMS")[0]).toMatchObject({ subjectIsMinor: true, legalGuardian: guardian });
    expect(channelHistory(adult, "SMS")[0]).toMatchObject({ subjectIsMinor: false, legalGuardian: null });
    expect(latestConsentRecord(minor)?.legalGuardian).toEqual(guardian);
  });

  it("sem mudanca devolve o mesmo valor, inclusive o formato antigo", () => {
    expect(applyConsentChanges(LEGACY, [], consentAct(), ADULT)).toBe(LEGACY);
    expect(applyConsentChanges(null, [], consentAct(), ADULT)).toBeNull();
  });

  it("o formato antigo passa a ser guardado inteiro, e nao autoriza canal nenhum", () => {
    expect(activeConsentChannels(LEGACY)).toEqual([]);
    const next = grant(LEGACY, ["SMS"]);
    expect(next).toMatchObject({ formatVersion: 2, legacy: LEGACY });
    expect(channelHistory(next, "EMAIL")).toEqual([]);
  });
});

describe("trava do historico (espelho das Security Rules)", () => {
  const saved = grant(null, ["EMAIL", "SMS"]);
  const allowed = (before: StoredNotificationConsent | null, after: StoredNotificationConsent | null, userId = STAFF_MEMBER) =>
    isAllowedConsentTransition(before, after, userId);
  const edit = (mutate: (value: ReturnType<typeof consent>) => void) => {
    const copy = structuredClone(saved) as ReturnType<typeof consent>;
    mutate(copy);
    return copy;
  };

  it("aceita registrar, retirar, autorizar de novo e nao mexer", () => {
    expect(allowed(null, saved)).toBe(true);
    expect(allowed(saved, saved)).toBe(true);
    const withdrawn = applyConsentChanges(saved, [{ channel: "SMS", kind: "WITHDRAWN" }], consentAct({ at: LATER }), ADULT);
    expect(allowed(saved, withdrawn)).toBe(true);
    expect(allowed(withdrawn, grant(withdrawn, ["EMAIL", "SMS"]))).toBe(true);
    expect(allowed(LEGACY, grant(LEGACY, ["SMS"]))).toBe(true);
  });

  it("recusa apagar ou reescrever o historico", () => {
    expect(allowed(saved, null)).toBe(false);
    expect(allowed(saved, edit((value) => delete value.channels.SMS))).toBe(false);
    expect(allowed(saved, edit((value) => (value.channels.EMAIL![0].textVersion = "outra-versao")))).toBe(false);
    expect(allowed(LEGACY, { ...grant(LEGACY, ["SMS"]) as ReturnType<typeof consent>, legacy: null })).toBe(false);

    const withdrawn = applyConsentChanges(saved, [{ channel: "SMS", kind: "WITHDRAWN" }], consentAct({ at: LATER }), ADULT);
    const rewritten = structuredClone(withdrawn) as ReturnType<typeof consent>;
    rewritten.channels.SMS![0].withdrawn!.medium = "WRITTEN_DOCUMENT";
    expect(allowed(withdrawn, rewritten)).toBe(false);
  });

  it("recusa registro novo sobre um vigente, retirar e autorizar na mesma escrita e registro nascido retirado", () => {
    expect(allowed(saved, edit((value) => value.channels.EMAIL!.push(consentRecord())))).toBe(false);
    expect(
      allowed(
        saved,
        edit((value) => {
          value.channels.SMS![0].withdrawn = consentAct({ at: LATER });
          value.channels.SMS!.push(consentRecord());
        }),
      ),
    ).toBe(false);
    expect(allowed(null, consent({ SMS: [consentRecord({ withdrawn: consentAct() })] }))).toBe(false);
  });

  it("recusa registro em nome de outra pessoa, da propria pessoa pelo navegador ou incompleto", () => {
    expect(allowed(null, saved, "outro-membro")).toBe(false);
    expect(isAllowedConsentTransition(null, saved, null)).toBe(false);
    const bySubject = consent({ SMS: [consentRecord({ granted: consentAct({ recordedBy: { kind: "SUBJECT", userId: null } }) })] });
    expect(allowed(null, bySubject)).toBe(false);
    expect(allowed(null, consent({ SMS: [consentRecord({ subjectIsMinor: true })] }))).toBe(false);
    expect(allowed(null, { ...consent({}), channels: { TELEGRAM: [consentRecord()] } } as never)).toBe(false);
    expect(allowed(null, LEGACY)).toBe(false);
  });
});

describe("trilha do consentimento", () => {
  it("resume canal, ato, meio e versao, sem nome de ninguem", () => {
    const minor = applyConsentChanges(null, [{ channel: "WHATSAPP", kind: "GRANTED" }], consentAct(), {
      ...ADULT,
      subjectIsMinor: true,
      legalGuardian: { fullName: "Rui Ficticio", relationship: "PARENT" },
    });
    const summary = consentAuditMetadata(null, minor);
    expect(summary).toBe("WHATSAPP:GRANTED:FORM:2026-09-11-rascunho:LEGAL_GUARDIAN");
    expect(summary).not.toContain("Rui");
    expect(summary).not.toContain(STAFF_MEMBER);

    const withdrawn = applyConsentChanges(minor, [{ channel: "WHATSAPP", kind: "WITHDRAWN" }], consentAct({ medium: "MESSAGE" }), ADULT);
    expect(consentAuditMetadata(minor, withdrawn)).toBe("WHATSAPP:WITHDRAWN:MESSAGE");
    expect(consentAuditMetadata(minor, minor)).toBeNull();
  });
});
