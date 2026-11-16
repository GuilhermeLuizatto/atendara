import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/config/navigation";
import { listProfessions } from "@/config/professions";
import { APP_MODULES } from "@/types/access";

import {
  HIDDEN_APP_MODULES,
  HIDDEN_SETTINGS_SECTIONS,
  isModuleHidden,
  isSettingsSectionHidden,
} from "./scope";

import { SETTINGS_SECTIONS, settingsSectionFromQuery } from "@/features/settings/sections";

describe("recorte de produto: Psicologia, profissional sozinho", () => {
  it("oferece somente Psicologia", () => {
    expect(listProfessions().map((profession) => profession.id)).toEqual([
      "PSYCHOLOGIST",
    ]);
  });

  it("esconde mensagens e equipe, e o primeiro contato que mora em mensagens", () => {
    expect(isModuleHidden("mensagens")).toBe(true);
    expect(isModuleHidden("equipe")).toBe(true);
    expect(isModuleHidden("agenda")).toBe(false);
    const visiveis = NAV_ITEMS.filter(
      (item) => !isModuleHidden(item.href.split("/")[1] as (typeof APP_MODULES)[number]),
    ).map((item) => item.href);
    expect(visiveis).not.toContain("/mensagens");
    expect(visiveis).not.toContain("/mensagens/primeiro-contato");
    expect(visiveis).not.toContain("/equipe");
    expect(visiveis).toContain("/agenda");
  });

  it("so lista modulos e abas que existem", () => {
    for (const area of HIDDEN_APP_MODULES) expect(APP_MODULES).toContain(area);
    for (const section of HIDDEN_SETTINGS_SECTIONS) {
      expect(SETTINGS_SECTIONS as readonly string[]).toContain(section);
    }
  });

  it("esconde as abas Recibos e Fila de automações, inclusive por URL", () => {
    expect(isSettingsSectionHidden("recibos")).toBe(true);
    expect(isSettingsSectionHidden("fila")).toBe(true);
    expect(isSettingsSectionHidden("whatsapp")).toBe(false);
    expect(settingsSectionFromQuery("recibos")).toBeNull();
    expect(settingsSectionFromQuery("fila")).toBeNull();
    expect(settingsSectionFromQuery("whatsapp")).toBe("whatsapp");
  });
});
