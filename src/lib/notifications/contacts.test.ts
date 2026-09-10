import { describe, expect, it } from "vitest";

import { client, FICTITIOUS } from "./fixtures";
import { contactFor, isValidEmail, normalizePhone } from "./contacts";

describe("normalizePhone", () => {
  it("aceita numero ja em formato internacional sem supor pais", () => {
    expect(normalizePhone("+5511987654321")).toEqual({
      e164: "+5511987654321",
      countryAssumed: false,
    });
  });

  it("completa o codigo do Brasil e marca a suposicao", () => {
    // O mesmo caso do contato informado para configuracao futura: onze digitos
    // sem codigo de pais podem pertencer a mais de um pais. Completar e util
    // para a interface; a marca e o que impede tratar isso como confirmado.
    expect(normalizePhone("(11) 98765-4321")).toEqual({
      e164: "+5511987654321",
      countryAssumed: true,
    });
  });

  it("recusa o que nao vira E.164", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+0 11 98765-4321")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("aceita endereco com dominio completo", () => {
    expect(isValidEmail(FICTITIOUS.email)).toBe(true);
  });

  it("recusa endereco sem dominio ou com espaco", () => {
    expect(isValidEmail("alguem@localhost")).toBe(false);
    expect(isValidEmail("alguem @exemplo.test")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
  });
});

describe("contactFor", () => {
  it("devolve o destino do canal com dica reduzida", () => {
    expect(contactFor(client(), "SMS")).toEqual({
      destination: FICTITIOUS.phone,
      hint: "***0000",
      countryAssumed: false,
    });

    expect(contactFor(client(), "EMAIL")).toEqual({
      destination: FICTITIOUS.email,
      hint: "***@exemplo.test",
      countryAssumed: false,
    });
  });

  it("a dica nao permite reconstruir o contato", () => {
    const contact = contactFor(client(), "SMS");
    expect(contact?.hint).not.toContain(FICTITIOUS.phone);
    expect(contact?.hint.replace(/\D/g, "")).toHaveLength(4);
  });

  it("nao inventa destino quando o cadastro nao tem o contato do canal", () => {
    expect(contactFor(client({ phone: null }), "WHATSAPP")).toBeNull();
    expect(contactFor(client({ email: null }), "EMAIL")).toBeNull();
  });
});
