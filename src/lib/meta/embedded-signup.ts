export interface EmbeddedSignupResult {
  status: "connected" | "cancelled" | "error";
  message: string;
  code: string | null;
}

export interface EmbeddedSignupSession {
  event: string;
  version: number | null;
  data: {
    businessId: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseMessageData(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * A mensagem da janela da Meta não é uma credencial. Ainda assim, o parser
 * mantém somente os identificadores necessários para a próxima etapa e nunca
 * persiste o payload bruto no navegador.
 */
export function embeddedSignupSession(value: unknown): EmbeddedSignupSession | null {
  value = parseMessageData(value);
  if (!isRecord(value) || value.type !== "WA_EMBEDDED_SIGNUP" || typeof value.event !== "string") {
    return null;
  }

  const data = isRecord(value.data) ? value.data : {};
  return {
    event: value.event,
    version: typeof value.version === "number" ? value.version : null,
    data: {
      businessId: nullableString(data.business_id),
      phoneNumberId: nullableString(data.phone_number_id),
      wabaId: nullableString(data.waba_id),
    },
  };
}

/** Aceita apenas HTTPS em domínio controlado pela Meta. */
export function isMetaEmbeddedSignupOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

export function embeddedSignupResult(response: FacebookLoginResponse): EmbeddedSignupResult {
  if (response.status === "connected" && response.authResponse?.code) {
    return {
      status: "connected",
      message: "Autorização recebida da Meta. Validando conta e número no backend...",
      code: response.authResponse.code,
    };
  }

  if (response.status === "unknown") {
    return { status: "cancelled", message: "Conexão cancelada antes da confirmação na Meta.", code: null };
  }

  return { status: "error", message: "A Meta não retornou uma autorização válida.", code: null };
}
