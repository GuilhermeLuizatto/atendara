import { describe, expect, it } from "vitest";

import data from "./ibge-municipalities.json";
import {
  buildMunicipalityIndex,
  loadMunicipalities,
  normalizeForSearch,
  resolveMunicipality,
  searchMunicipalities,
} from "./municipalities";

const index = buildMunicipalityIndex(data);
const labels = (query: string, limit?: number) => searchMunicipalities(index, query, limit).map((entry) => entry.label);

describe("lista do IBGE embutida", () => {
  it("tem os 27 estados e todos os municípios, sem repetição dentro da UF", () => {
    expect(Object.keys(data.byState)).toHaveLength(27);
    expect(index.length).toBe(data.count);
    expect(index.length).toBeGreaterThan(5500);
    expect(new Set(index.map((entry) => entry.label)).size).toBe(index.length);
  });

  it("carrega sob demanda e reaproveita a mesma lista", async () => {
    const first = await loadMunicipalities();
    expect(first).toHaveLength(index.length);
    expect(await loadMunicipalities()).toBe(first);
  });
});

describe("busca conforme se digita", () => {
  it("ignora acento e maiúsculas", () => {
    expect(normalizeForSearch("São João d'Aliança")).toBe("sao joao d alianca");
    expect(labels("sao paulo")).toContain("São Paulo/SP");
    expect(labels("SÃO PAULO")[0]).toBe("São Paulo/SP");
  });

  it("põe primeiro quem começa pelo texto", () => {
    const results = labels("santos");
    expect(results[0]).toBe("Santos/SP");
    expect(results).toContain("Santos Dumont/MG");
  });

  it("acha pelo começo de uma palavra do meio", () => {
    expect(labels("dumont", 20)).toContain("Santos Dumont/MG");
  });

  it("mostra a UF para desfazer nomes repetidos", () => {
    const bomJesus = labels("bom jesus", 30).filter((label) => label.startsWith("Bom Jesus/"));
    expect(bomJesus.length).toBeGreaterThan(1);
  });

  it("filtra pela UF só depois de barra ou traço com espaços", () => {
    expect(labels("bom jesus/pi")).toEqual(["Bom Jesus/PI"]);
    expect(labels("Bom Jesus - RS")).toEqual(["Bom Jesus/RS"]);
    // Sem separador, "pa" continua parte do nome, e nao a UF do Para.
    const saoPa = searchMunicipalities(index, "sao pa");
    expect(saoPa.map((entry) => entry.label)).toContain("São Paulo/SP");
    expect(saoPa.every((entry) => entry.key.startsWith("sao pa"))).toBe(true);
  });

  it("devolve no máximo o limite e nada para texto vazio", () => {
    expect(labels("a")).toHaveLength(8);
    expect(labels("   ")).toEqual([]);
    expect(labels("cidade que não existe")).toEqual([]);
  });
});

describe("cidade válida para o recibo", () => {
  it("aceita Cidade/UF da lista", () => {
    expect(resolveMunicipality(index, "Santos/SP")?.label).toBe("Santos/SP");
    expect(resolveMunicipality(index, "santos / sp")?.label).toBe("Santos/SP");
  });

  it("aceita só o nome quando ele é único no país", () => {
    expect(resolveMunicipality(index, "Santos")?.label).toBe("Santos/SP");
    expect(resolveMunicipality(index, "Bom Jesus")).toBeNull();
  });

  it("recusa cidade fora da lista, UF errada e texto longo", () => {
    expect(resolveMunicipality(index, "Santos/RJ")).toBeNull();
    expect(resolveMunicipality(index, "Gotham")).toBeNull();
    expect(resolveMunicipality(index, "x".repeat(50))).toBeNull();
    expect(resolveMunicipality(index, "")).toBeNull();
  });
});
