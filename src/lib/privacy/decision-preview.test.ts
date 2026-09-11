import { describe, expect, it } from "vitest";

import { DECISION_INPUT_PREVIEW_CHARS } from "@/config/privacy";
import { listProfessions } from "@/config/professions";

import { decisionInputPreview } from "./decision-preview";

describe("trecho da mensagem na decisao do agente", () => {
  const body = "Oi, aqui e a Maria. ".repeat(40);

  it("profissoes de saude nao guardam trecho nenhum", () => {
    for (const profession of listProfessions()) {
      if (profession.sensitiveDataProfile === "STANDARD") continue;
      expect(decisionInputPreview(body, profession.sensitiveDataProfile), profession.id).toBe("");
    }
  });

  it("as demais guardam no maximo o limite configurado", () => {
    const preview = decisionInputPreview(body, "STANDARD");
    expect(preview.length).toBe(DECISION_INPUT_PREVIEW_CHARS.STANDARD);
    expect(body.startsWith(preview)).toBe(true);
  });

  it("nenhum perfil guarda mais que antes da decisao", () => {
    for (const limit of Object.values(DECISION_INPUT_PREVIEW_CHARS)) {
      expect(limit).toBeLessThanOrEqual(200);
    }
  });
});
