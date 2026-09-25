import { describe, expect, it } from "vitest";

import {
  calendarReconnectAlert,
  calendarReconnectAlertId,
  resolveCalendarReconnectAlert,
} from "./calendar-connection-alert";

const AT = "2026-09-25T12:00:00.000Z";

describe("alerta de conexão Google caída", () => {
  it("é único por profissional e geração e leva à conexão certa", () => {
    const first = calendarReconnectAlert({
      organizationId: "org-1",
      professionalId: "prof-1",
      generation: "generation-1",
      at: AT,
    });

    expect(first).toMatchObject({
      id: calendarReconnectAlertId("prof-1", "generation-1"),
      organizationId: "org-1",
      type: "AUTOMATION_FAILURE",
      priority: "HIGH",
      status: "UNREAD",
      professionalId: "prof-1",
      target: { type: "calendar_connection", id: "prof-1" },
      channels: ["DASHBOARD"],
    });
    expect(
      calendarReconnectAlert({
        organizationId: "org-1",
        professionalId: "prof-1",
        generation: "generation-1",
        at: AT,
      }).id,
    ).toBe(first.id);
    expect(calendarReconnectAlertId("prof-1", "generation-2")).not.toBe(
      first.id,
    );
  });

  it("é encerrado pela reconexão sem perder a evidência da queda", () => {
    const alert = calendarReconnectAlert({
      organizationId: "org-1",
      professionalId: "prof-1",
      generation: "generation-1",
      at: AT,
    });
    const resolvedAt = "2026-09-25T12:10:00.000Z";

    expect(resolveCalendarReconnectAlert(alert, "user-1", resolvedAt)).toEqual({
      ...alert,
      status: "RESOLVED",
      acknowledgedBy: "user-1",
      acknowledgedAt: resolvedAt,
      updatedAt: resolvedAt,
      updatedBy: "user-1",
    });
  });
});
