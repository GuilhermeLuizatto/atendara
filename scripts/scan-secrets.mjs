import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

/**
 * Varredura de segredos, sem baixar binario de fora.
 *
 * Uso:
 *   node scripts/scan-secrets.mjs            # arvore versionada
 *   node scripts/scan-secrets.mjs --historico # + todos os commits
 *   node scripts/scan-secrets.mjs --staged   # so o que esta no indice (gancho)
 *
 * Imprime o caminho e a linha do achado, NUNCA o valor: um relatorio que copia
 * a chave vira o proximo vazamento. Sai com codigo 1 quando acha algo.
 */

const PATTERNS = [
  ["chave privada (PEM)", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["conta de servico do Google", /"type"\s*:\s*"service_account"/],
  ["chave de API do Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["token de atualizacao OAuth", /\b1\/\/[0-9A-Za-z_-]{30,}/],
  ["chave secreta da Stripe", /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/],
  ["segredo de webhook da Stripe", /\bwhsec_[0-9A-Za-z]{16,}/],
  ["chave da AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["token do GitHub", /\bgh[pousr]_[0-9A-Za-z]{30,}/],
  ["JWT", /\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/],
  ["senha em atribuicao", /\b(?:password|senha|passwd)\s*[:=]\s*["'][^"'\s]{10,}["']/i],
];

/**
 * Onde um "segredo" e proposital: fixture de teste, exemplo de configuracao e
 * o proprio arquivo de padroes. O par [caminho, motivo] deixa o porque escrito.
 */
const ALLOWED = [
  [/^scripts\/scan-secrets\.mjs$/, "o proprio arquivo de padroes"],
  // Cobre `.test.ts` e tambem `-test.ts` (`access-test`, `emulator-test`), onde
  // as senhas sao ficticias e o dominio e `.test`.
  [/[.-]test\.(?:ts|tsx|js|mjs)$/, "fixture de teste"],
  [/^\.env\.example$/, "exemplo sem valor real"],
  [/^src\/lib\/testing\//, "dubles de teste"],
];

const allowed = (path) => ALLOWED.some(([pattern]) => pattern.test(path));

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function scanText(text, path, origin, findings) {
  if (text.includes(String.fromCharCode(0))) return; // binario: nao varre
  const lines = text.split(/\r?\n/);
  for (const [label, pattern] of PATTERNS) {
    lines.forEach((line, index) => {
      if (pattern.test(line)) findings.push({ origin, path, line: index + 1, label });
    });
  }
}

function scanWorkingTree(onlyStaged, findings) {
  const files = git(onlyStaged ? ["diff", "--cached", "--name-only", "--diff-filter=ACM"] : ["ls-files"])
    .split("\n")
    .filter(Boolean);
  for (const path of files) {
    if (allowed(path)) continue;
    let size;
    try {
      size = statSync(path).size;
    } catch {
      continue; // arquivo removido no indice
    }
    if (size > 2 * 1024 * 1024) continue;
    scanText(readFileSync(path, "utf8"), path, onlyStaged ? "indice" : "arvore", findings);
  }
}

/** Todo blob que ja existiu em qualquer commit, inclusive apagado depois. */
function scanHistory(findings) {
  const objects = git(["rev-list", "--all", "--objects"]).split("\n").filter(Boolean);
  const seen = new Set();
  for (const entry of objects) {
    const space = entry.indexOf(" ");
    if (space === -1) continue;
    const hash = entry.slice(0, space);
    const path = entry.slice(space + 1);
    if (!path || allowed(path) || seen.has(hash)) continue;
    seen.add(hash);
    const type = git(["cat-file", "-t", hash]).trim();
    if (type !== "blob") continue;
    if (Number(git(["cat-file", "-s", hash]).trim()) > 2 * 1024 * 1024) continue;
    scanText(git(["cat-file", "-p", hash]), path, "historico", findings);
  }
}

const historico = process.argv.includes("--historico");
const staged = process.argv.includes("--staged");

const findings = [];
scanWorkingTree(staged, findings);
if (historico) scanHistory(findings);

if (findings.length === 0) {
  console.log(
    `Varredura de segredos: nada encontrado (${staged ? "indice" : "arvore versionada"}${historico ? " + historico completo" : ""}).`,
  );
  process.exit(0);
}

console.error(`Varredura de segredos: ${findings.length} achado(s). O valor nao e impresso.`);
for (const finding of findings) {
  console.error(`  ${finding.origin}: ${finding.path}:${finding.line} — ${finding.label}`);
}
process.exit(1);
