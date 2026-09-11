import { createHash } from "node:crypto";

/**
 * Content-Security-Policy do export estatico.
 *
 * `output: "export"` nao tem servidor para gerar nonce, e o Next grava scripts
 * inline em cada HTML (o tema e o payload do React). A politica entao vai em
 * `<meta>` dentro de cada pagina, com o hash exato dos scripts DAQUELA pagina —
 * e nada de `'unsafe-inline'` em `script-src`. O que `<meta>` nao aceita
 * (`frame-ancestors`) vai no cabecalho do Hosting, em `firebase.json`.
 */

const META_PATTERN = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\s*\/?>/i;
const SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** Conteudo dos scripts inline executaveis, na ordem em que aparecem. */
export function inlineScripts(html) {
  const scripts = [];
  for (const [, attributes, content] of html.matchAll(SCRIPT_PATTERN)) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
    if (type && !/javascript|module/i.test(type)) continue;
    scripts.push(content);
  }
  return scripts;
}

export function scriptHash(content) {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

export function contentSecurityPolicy({ scriptHashes, projectId, authDomain, region = "southamerica-east1" }) {
  const directives = {
    "default-src": ["'self'"],
    // reCAPTCHA Enterprise e o provedor do App Check.
    "script-src": ["'self'", ...scriptHashes, "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
    // Estilo inline fica: atributo `style` do React. Nao executa codigo.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    // Somente Firebase. O gateway nunca e chamado pelo navegador: checkout e
    // portal sao navegacao, com URL criada pelo backend.
    "connect-src": [
      "'self'",
      "https://firestore.googleapis.com",
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
      "https://firebaseappcheck.googleapis.com",
      "https://content-firebaseappcheck.googleapis.com",
      "https://www.google.com/recaptcha/",
      ...(projectId ? [`https://${region}-${projectId}.cloudfunctions.net`] : []),
    ],
    "frame-src": [
      "https://www.google.com/recaptcha/",
      "https://recaptcha.google.com/recaptcha/",
      ...(authDomain ? [`https://${authDomain}`] : []),
    ],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** Grava (ou regrava) a politica no `<head>`, com os hashes desta pagina. */
export function applyContentSecurityPolicy(html, options) {
  const withoutMeta = html.replace(META_PATTERN, "");
  const policy = contentSecurityPolicy({ ...options, scriptHashes: [...new Set(inlineScripts(withoutMeta).map(scriptHash))] });
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"/>`;
  if (!/<head\b[^>]*>/i.test(withoutMeta)) throw new Error("HTML sem <head>: nao ha onde gravar a CSP.");
  return withoutMeta.replace(/<head\b[^>]*>/i, (head) => `${head}${meta}`);
}

/** Problemas da politica de uma pagina publicada. Lista vazia: ok. */
export function contentSecurityPolicyProblems(html) {
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i);
  if (!meta) return ["sem Content-Security-Policy"];
  const headIndex = html.search(/<head\b[^>]*>/i);
  const firstScript = html.search(/<script\b/i);
  const problems = [];
  if (firstScript >= 0 && meta.index > firstScript) problems.push("CSP depois do primeiro script");
  const scriptSrc = meta[1].split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src"));
  if (!scriptSrc) return [...problems, "CSP sem script-src"];
  if (scriptSrc.includes("'unsafe-inline'") || scriptSrc.includes("'unsafe-eval'")) problems.push("script-src permite execucao inline");
  for (const content of inlineScripts(html)) {
    if (!scriptSrc.includes(scriptHash(content))) problems.push("script inline sem hash na CSP");
  }
  if (headIndex < 0) problems.push("HTML sem <head>");
  return problems;
}
