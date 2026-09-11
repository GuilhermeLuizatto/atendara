import { existsSync, readFileSync } from "node:fs";

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

/** Ambiente visto pelo build: o do processo vence `.env.local`, como no Next. */
export function buildEnvironment() {
  return { ...parseEnvFile(".env.local"), ...process.env };
}
