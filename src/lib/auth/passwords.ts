export function createTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return `At!${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}

export function passwordError(password: string): string | null {
  if (password.length < 12 || password.length > 128) return "Use uma senha de 12 a 128 caracteres.";
  return null;
}

export async function passwordDigest(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 210000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
