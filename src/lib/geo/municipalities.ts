/**
 * Municipios do Brasil pela lista do IBGE embutida no site (decisao do titular
 * em 27/09/2026): a busca roda no navegador e nada do que se digita sai dele.
 * O recibo imprime "Cidade/UF", porque 232 nomes se repetem entre estados.
 */

export interface Municipality {
  name: string;
  state: string;
  /** Como vai para o recibo: "Santos/SP". */
  label: string;
  /** Nome sem acento, sem pontuacao e em minusculas, para comparar com o que se digita. */
  key: string;
}

export interface MunicipalityData {
  byState: Record<string, string[]>;
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const municipalityLabel = (name: string, state: string): string => `${name}/${state}`;

export function buildMunicipalityIndex(data: MunicipalityData): Municipality[] {
  return Object.entries(data.byState).flatMap(([state, names]) =>
    names.map((name) => ({ name, state, label: municipalityLabel(name, state), key: normalizeForSearch(name) })),
  );
}

/**
 * UF so quando vem depois de "/" ou de " - ": sem esse separador, "sao pa"
 * seria lido como "Sao" no Para, e "Xique-Xi" como "Xique" em "XI".
 */
function splitQuery(query: string): { name: string; state: string | null } {
  const match = query.trim().match(/^(.+?)\s*(?:\/|\s-\s)\s*([A-Za-z]{2})$/);
  if (match) return { name: normalizeForSearch(match[1]), state: match[2].toUpperCase() };
  return { name: normalizeForSearch(query), state: null };
}

function matchRank(entry: Municipality, name: string): number {
  if (entry.key.startsWith(name)) return 0;
  if (entry.key.includes(` ${name}`)) return 1;
  if (entry.key.includes(name)) return 2;
  return -1;
}

/**
 * Sugestoes para o que se digita: primeiro quem comeca pelo texto, depois quem
 * tem uma palavra que comeca por ele, depois quem apenas o contem.
 */
export function searchMunicipalities(index: Municipality[], query: string, limit = 8): Municipality[] {
  const { name, state } = splitQuery(query);
  if (!name) return [];
  const found: Array<{ entry: Municipality; rank: number }> = [];
  for (const entry of index) {
    if (state && entry.state !== state) continue;
    const rank = matchRank(entry, name);
    if (rank >= 0) found.push({ entry, rank });
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.entry.key.localeCompare(b.entry.key) || a.entry.state.localeCompare(b.entry.state))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/**
 * O municipio que o texto do campo designa sem ambiguidade: "Santos/SP", ou so
 * "Santos" quando existe um unico com esse nome no pais.
 */
export function resolveMunicipality(index: Municipality[], value: string): Municipality | null {
  const { name, state } = splitQuery(value);
  if (!name) return null;
  const sameName = index.filter((entry) => entry.key === name && (!state || entry.state === state));
  return sameName.length === 1 ? sameName[0] : null;
}

let loading: Promise<Municipality[]> | null = null;

/** A lista (cerca de 30 KB compactada) so desce quando o campo de cidade aparece. */
export function loadMunicipalities(): Promise<Municipality[]> {
  loading ??= import("./ibge-municipalities.json")
    .then((module) => buildMunicipalityIndex(module.default as MunicipalityData))
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}
