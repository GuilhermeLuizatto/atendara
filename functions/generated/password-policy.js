// Gerado por scripts/build-functions.mjs.
import { PASSWORD_LENGTH, PASSWORD_SPECIAL_CHARACTERS } from "./platform-config.js";
/**
 * A politica de senha, como MECANISMO — os numeros vivem em
 * `src/config/platform.ts`.
 *
 * Compartilhado com o backend por `scripts/build-functions.mjs`: a tela, a
 * callable do cadastro e a politica do Identity Platform precisam recusar
 * exatamente a mesma senha. Se a tela aceitasse uma que o Identity Platform
 * recusa, a conta seria criada e a pessoa nao conseguiria entrar.
 *
 * Maiuscula e minuscula sao conferidas so no alfabeto sem acento: e o minimo
 * que o Identity Platform garantidamente reconhece, e "É" sozinho nao pode ser
 * a unica maiuscula de uma senha que ele talvez nao aceite.
 *
 * Arquivo de dominio: nao importa `firebase/*`.
 */
const RULES = [
    { label: "letra maiúscula", test: (password) => /[A-Z]/.test(password) },
    { label: "letra minúscula", test: (password) => /[a-z]/.test(password) },
    { label: "número", test: (password) => /[0-9]/.test(password) },
    {
        label: "símbolo",
        test: (password) => [...password].some((character) => PASSWORD_SPECIAL_CHARACTERS.includes(character)),
    },
];
/** A frase curta que acompanha o campo de senha. */
export const PASSWORD_HINT = `De ${PASSWORD_LENGTH.min} a ${PASSWORD_LENGTH.max} caracteres, com letra maiúscula, letra minúscula, número e um destes símbolos: ${[...PASSWORD_SPECIAL_CHARACTERS].join(" ")}`;
/** `null` quando a senha cumpre a politica; senao, a frase que a pessoa le. */
export function passwordPolicyError(password) {
    if (password.length < PASSWORD_LENGTH.min || password.length > PASSWORD_LENGTH.max) {
        return `Use uma senha de ${PASSWORD_LENGTH.min} a ${PASSWORD_LENGTH.max} caracteres.`;
    }
    const missing = RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label);
    if (missing.length) {
        return `Falta na senha: ${missing.join(", ")}. Os símbolos aceitos são ${[...PASSWORD_SPECIAL_CHARACTERS].join(" ")}`;
    }
    return null;
}
