import { describe, expect, it } from "vitest";

import { isOpenNotification, notificationTargetHref } from "./targets";

describe("destino de alertas", () => {
  it("abre a aba do Google Calendar só para alerta dessa conexão", () => {
    expect(
      notificationTargetHref({ type: "calendar_connection", id: "prof-1" }),
    ).toBe("/configuracoes?secao=google");
    expect(notificationTargetHref({ type: "appointment", id: "apt-1" })).toBe(
      null,
    );
    expect(notificationTargetHref(null)).toBe(null);
  });

  it("não mantém alerta resolvido ou reconhecido no painel", () => {
    expect(isOpenNotification({ status: "UNREAD" })).toBe(true);
    expect(isOpenNotification({ status: "READ" })).toBe(true);
    expect(isOpenNotification({ status: "ACKNOWLEDGED" })).toBe(false);
    expect(isOpenNotification({ status: "RESOLVED" })).toBe(false);
  });
});
