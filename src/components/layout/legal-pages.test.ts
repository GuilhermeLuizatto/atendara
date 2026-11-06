import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ContratoPage from "@/app/contrato/page";
import PrivacidadePage from "@/app/privacidade/page";
import TermosPage from "@/app/termos/page";
import { CONTRACT_VERSION, LEGAL_VERSION, OPERATOR_LEGAL_NAME, SUBPROCESSORS } from "@/config/legal";
import { BLOCKED_RETENTION_DAYS, TRIAL_DAYS } from "@/config/platform";

/**
 * O texto publico das paginas legais, renderizado sem navegador. O que se
 * prova aqui e coerencia com o produto e com o ADR 0006 — nao validade
 * juridica, que depende de revisao de advogado.
 */

const render = (page: () => ReactElement) => renderToStaticMarkup(createElement(page));

const termos = render(TermosPage);
const contrato = render(ContratoPage);
const privacidade = render(PrivacidadePage);

describe("Termos de Uso", () => {
  it("descrevem licença de uso com manutenção, suporte e integrações em nome da organização", () => {
    expect(termos).toContain("Licença de uso com manutenção");
    expect(termos).toContain("Suporte");
    expect(termos).toContain("Integrações em nome da organização");
    expect(termos).toContain("Obrigações fiscais e profissionais");
    expect(termos).toContain('href="/contrato"');
  });

  it("identificam o operador pessoa física e os papéis da LGPD", () => {
    expect(termos).toContain(`<strong>${OPERATOR_LEGAL_NAME}</strong>`);
    expect(termos).toContain("pessoa física");
    expect(termos).toContain("<strong>controladora</strong>");
    expect(termos).toContain("<strong>operador</strong>");
  });

  it("não contradizem o autocadastro com teste", () => {
    expect(termos).not.toContain("Piloto fechado e gratuito");
    expect(termos).not.toContain("As contas são criadas por nós");
    expect(termos).toContain(`teste de ${TRIAL_DAYS} dias`);
    expect(termos).toContain(`${BLOCKED_RETENTION_DAYS} dias`);
  });

  it("levam a versão dos Termos", () => {
    expect(termos).toContain(`Versão ${LEGAL_VERSION}`);
    expect(termos).not.toContain("piloto fechado, gratuito e por convite");
  });
});

describe("Contrato de Licença e Anexo de Tratamento", () => {
  it("tem as duas partes e a versão própria", () => {
    expect(contrato).toContain("Parte 1 — Contrato de Licença de Uso");
    expect(contrato).toContain("Parte 2 — Anexo de Tratamento de Dados Pessoais");
    expect(contrato).toContain(`Versão ${CONTRACT_VERSION}`);
  });

  it("põe a organização como controladora e o licenciante como operador", () => {
    expect(contrato).toContain("<strong>organização é a controladora</strong>");
    expect(contrato).toContain("<strong>operador</strong>");
    expect(contrato).toContain("art. 39");
    expect(contrato).toContain(`${OPERATOR_LEGAL_NAME}, pessoa física`);
  });

  it("lista cada suboperador e nomeia os que tiram dado do Brasil", () => {
    for (const item of SUBPROCESSORS) expect(contrato).toContain(item.name);
    for (const item of SUBPROCESSORS.filter((entry) => entry.location !== "BRAZIL")) {
      expect(contrato).toMatch(new RegExp(`Saem do país só os dados tratados por [^<]*${item.name}`));
    }
  });

  it("não liga integração sozinha nem promete cobrança", () => {
    expect(contrato).toContain("Esta cláusula não liga nenhuma integração sozinha.");
    expect(contrato).toContain("Nesta fase não há cobrança real pela plataforma.");
  });
});

describe("Política de Privacidade", () => {
  it("lista os mesmos suboperadores do anexo", () => {
    for (const item of SUBPROCESSORS) expect(privacidade).toContain(item.name);
  });
});

describe("as três páginas", () => {
  it("não deixam lacuna de rascunho à vista", () => {
    for (const html of [termos, contrato, privacidade]) {
      expect(html).not.toMatch(/\[(a definir|razão social|NOTA|ADVOGADO|AINDA NÃO)/i);
      expect(html).toContain("Versão preliminar.");
    }
  });
});
