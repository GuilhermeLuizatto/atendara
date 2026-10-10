import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "project-dashboard/status.json");
const template = resolve(root, "project-dashboard/dashboard.template.html");
const output = resolve(root, "project-dashboard/atendara-dashboard.html");

const validKinds = new Set([
  "bug",
  "teste",
  "desenvolvimento",
  "risco",
  "documentacao",
]);
const validStates = new Set([
  "pendente",
  "em-andamento",
  "em-revisao",
  "bloqueado",
  "a-verificar",
  "planejado",
  "concluido",
]);

export function buildDashboard(status, htmlTemplate) {
  if (status.schemaVersion !== 1 || !Array.isArray(status.items))
    throw new Error("Formato do estado inválido.");
  const seen = new Set();
  for (const item of status.items) {
    if (!item.id || seen.has(item.id))
      throw new Error(`ID ausente ou duplicado: ${item.id}`);
    seen.add(item.id);
    if (!validKinds.has(item.kind) || !validStates.has(item.status))
      throw new Error(`Tipo ou situação inválida: ${item.id}`);
    for (const field of [
      "title",
      "summary",
      "next",
      "owner",
      "evidence",
      "confidence",
    ]) {
      if (typeof item[field] !== "string" || !item[field].trim())
        throw new Error(`Campo ${field} ausente: ${item.id}`);
    }
  }

  const marker = "__STATUS_JSON__";
  if (htmlTemplate.split(marker).length !== 2)
    throw new Error("Marcador do estado ausente ou duplicado.");
  return htmlTemplate.replace(
    marker,
    JSON.stringify(status).replaceAll("<", "\\u003c"),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const status = JSON.parse(readFileSync(source, "utf8"));
  const html = buildDashboard(status, readFileSync(template, "utf8"));
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== html)
      throw new Error(
        "Dashboard desatualizado. Rode node scripts/build-project-dashboard.mjs.",
      );
  } else {
    writeFileSync(output, html);
    process.stdout.write(
      `Dashboard gerado com ${status.items.length} frentes.\n`,
    );
  }
}
