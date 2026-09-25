import { describe, expect, it } from "vitest";

import { settingsSectionFromQuery } from "./sections";

describe("aba pedida nas configurações", () => {
  it("aceita somente uma seção conhecida", () => {
    expect(settingsSectionFromQuery("google")).toBe("google");
    expect(settingsSectionFromQuery("Google")).toBeNull();
    expect(settingsSectionFromQuery("../google")).toBeNull();
    expect(settingsSectionFromQuery(null)).toBeNull();
  });
});
