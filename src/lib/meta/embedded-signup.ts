export interface EmbeddedSignupResult {
  status: "connected" | "cancelled" | "error";
  message: string;
}

export function embeddedSignupResult(response: FacebookLoginResponse): EmbeddedSignupResult {
  if (response.status === "connected" && response.authResponse?.code) {
    return {
      status: "connected",
      message:
        "Autorização recebida da Meta. O código será trocado pelo backend quando as Functions forem publicadas.",
    };
  }

  if (response.status === "unknown") {
    return { status: "cancelled", message: "Conexão cancelada antes da confirmação na Meta." };
  }

  return { status: "error", message: "A Meta não retornou uma autorização válida." };
}
