import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarConnectionDetails } from "./google-calendar";
import type { CalendarConnectionView } from "@/types/calendar";

const NOW = "2026-09-25T12:00:00.000Z";
const connection: CalendarConnectionView = {
  configured: true,
  status: "CONNECTED",
  lastError: null,
  connectedAt: NOW,
  snapshot: {
    readAt: NOW,
    timeMin: NOW,
    timeMax: "2026-10-25T12:00:00.000Z",
    blocks: [],
  },
};
const render = (view: CalendarConnectionView, now = NOW) =>
  renderToStaticMarkup(
    createElement(CalendarConnectionDetails, { connection: view, now }),
  );

describe("situação da agenda Google", () => {
  it("agenda vazia só é anunciada como livre após leitura recente e bem-sucedida", () => {
    expect(render(connection)).toContain("Nenhum horário ocupado encontrado");
    for (const html of [
      render(connection, "2026-09-25T15:00:00Z"),
      render({ ...connection, lastError: "UNAVAILABLE" }),
    ]) {
      expect(html).not.toContain("Nenhum horário ocupado encontrado");
      expect(html).toContain("Isso não confirma que a agenda continua livre");
      expect(html).toContain('role="status"');
    }
  });
  it("não confunde conexão sem consulta com agenda livre", () => {
    const html = render({ ...connection, snapshot: null });
    expect(html).toContain("Nenhuma consulta realizada");
    expect(html).not.toContain("Nenhum horário ocupado encontrado");
  });
  it("informa configuração pendente e necessidade de reconexão", () => {
    expect(
      render({
        ...connection,
        configured: false,
        status: "REVOKED",
        snapshot: null,
      }),
    ).toContain("concluir a configuração");
    expect(
      render({
        ...connection,
        status: "ERROR",
        lastError: "RECONNECT_REQUIRED",
        snapshot: null,
      }),
    ).toContain("Conecte sua conta Google novamente");
  });
});
