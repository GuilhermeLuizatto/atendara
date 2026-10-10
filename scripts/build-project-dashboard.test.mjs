import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { buildDashboard } from "./build-project-dashboard.mjs";

const item = {
  id: "dashboard",
  kind: "desenvolvimento",
  status: "a-verificar",
  title: "Painel",
  summary: "Resumo",
  next: "Validar",
  owner: "Equipe",
  evidence: "README.md",
  confidence: "alta",
};
const state = { schemaVersion: 1, items: [item] };

describe("geração segura do radar", () => {
  it("insere o estado no único marcador e impede fechamento do script por conteúdo", () => {
    const html = buildDashboard(
      {
        ...state,
        items: [{ ...item, title: "</script><script>alert(1)</script>" }],
      },
      '<script type="application/json">__STATUS_JSON__</script>',
    );
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("</script><script>");
  });

  it("rejeita formato, ids duplicados, tipo, estado e campos inválidos", () => {
    expect(() =>
      buildDashboard({ schemaVersion: 2, items: [] }, "__STATUS_JSON__"),
    ).toThrow("Formato");
    expect(() =>
      buildDashboard({ ...state, items: [item, item] }, "__STATUS_JSON__"),
    ).toThrow("duplicado");
    expect(() =>
      buildDashboard(
        { ...state, items: [{ ...item, kind: "outro" }] },
        "__STATUS_JSON__",
      ),
    ).toThrow("Tipo");
    expect(() =>
      buildDashboard(
        { ...state, items: [{ ...item, status: "outro" }] },
        "__STATUS_JSON__",
      ),
    ).toThrow("Tipo");
    expect(() =>
      buildDashboard(
        { ...state, items: [{ ...item, next: " " }] },
        "__STATUS_JSON__",
      ),
    ).toThrow("Campo");
    expect(() => buildDashboard(state, "sem marcador")).toThrow("Marcador");
    expect(() =>
      buildDashboard(state, "__STATUS_JSON__ __STATUS_JSON__"),
    ).toThrow("Marcador");
  });

  it("confere o HTML gerado contra o estado versionado", async () => {
    const previous = process.argv;
    try {
      process.argv = [
        previous[0],
        fileURLToPath(
          new URL("./build-project-dashboard.mjs", import.meta.url),
        ),
        "--check",
      ];
      await import("./build-project-dashboard.mjs?check-test");
    } finally {
      process.argv = previous;
    }
  });
});
