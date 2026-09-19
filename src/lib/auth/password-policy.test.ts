import { describe, expect, it } from "vitest";

import { PASSWORD_LENGTH, PASSWORD_SPECIAL_CHARACTERS } from "@/config/platform";
import { PASSWORD_HINT, passwordPolicyError } from "@/lib/auth/password-policy";
import { createTemporaryPassword } from "@/lib/auth/passwords";

import { initialCredential } from "../../../functions/platform-auth.js";

/**
 * Politica de senha decidida em 19/09/2026: 12 a 128 caracteres, maiuscula,
 * minuscula, numero e simbolo. A mesma regra vale na tela, na callable do
 * cadastro e no Identity Platform — se uma aceitar o que outra recusa, a conta
 * nasce e a pessoa nao entra.
 */
describe("Politica de senha", () => {
  it("aceita a senha com as quatro classes e 12 caracteres", () => {
    expect(passwordPolicyError("Senha#Forte1")).toBeNull();
    expect("Senha#Forte1").toHaveLength(PASSWORD_LENGTH.min);
  });

  it("recusa fora do tamanho", () => {
    expect(passwordPolicyError("Senha#Fort1")).toContain("12 a 128");
    expect(passwordPolicyError(`Aa1#${"x".repeat(PASSWORD_LENGTH.max - 3)}`)).toContain("12 a 128");
  });

  it.each([
    ["senha#forte12", "letra maiúscula"],
    ["SENHA#FORTE12", "letra minúscula"],
    ["Senha#Fortezz", "número"],
    ["SenhaForte123", "símbolo"],
  ])("diz o que falta em %s", (password, missing) => {
    expect(passwordPolicyError(password)).toContain(`Falta na senha: ${missing}`);
  });

  it("hifen, mais, igual e espaco nao contam como simbolo — o Identity Platform nao os aceita", () => {
    for (const character of ["-", "+", "=", " "]) {
      expect(passwordPolicyError(`SenhaForte12${character}`), character).toContain("símbolo");
    }
  });

  it("cada simbolo da lista do Identity Platform conta", () => {
    for (const character of PASSWORD_SPECIAL_CHARACTERS) {
      expect(passwordPolicyError(`SenhaForte12${character}`), character).toBeNull();
    }
  });

  it("maiuscula acentuada sozinha nao basta", () => {
    expect(passwordPolicyError("Ésenha#forte12")).toContain("letra maiúscula");
  });

  it("a frase do campo cita o tamanho e os simbolos aceitos", () => {
    expect(PASSWORD_HINT).toContain("12 a 128");
    expect(PASSWORD_HINT).toContain("@");
  });

  // O sorteio pode, por acaso, nao trazer numero; quem garante as quatro classes
  // e o prefixo fixo. Conferir so o prefixo torna a prova deterministica.
  const prefixoGarante = (password: string) => passwordPolicyError(password.slice(0, 4).padEnd(PASSWORD_LENGTH.min, "x"));

  it("senha inicial gerada no navegador sempre cumpre a politica", () => {
    const password = createTemporaryPassword();
    expect(passwordPolicyError(password)).toBeNull();
    expect(prefixoGarante(password)).toBeNull();
  });

  it("senha inicial gerada no servidor sempre cumpre a politica", () => {
    const { temporaryPassword } = initialCredential();
    expect(passwordPolicyError(temporaryPassword)).toBeNull();
    expect(prefixoGarante(temporaryPassword)).toBeNull();
  });
});
