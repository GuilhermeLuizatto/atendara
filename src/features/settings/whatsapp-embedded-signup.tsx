"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { isMetaEmbeddedSignupConfigured, META_EMBEDDED_SIGNUP } from "@/config/meta";
import {
  embeddedSignupResult,
  embeddedSignupSession,
  isMetaEmbeddedSignupOrigin,
  type EmbeddedSignupSession,
} from "@/lib/meta/embedded-signup";
import { completeWhatsappEmbeddedSignup } from "@/services/meta/whatsapp-signup";

type ConnectionState = "idle" | "loading" | "connected" | "error";

const META_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

export function WhatsappEmbeddedSignup() {
  const [sdkReady, setSdkReady] = useState(false);
  const [state, setState] = useState<ConnectionState>("idle");
  const [message, setMessage] = useState("");
  const [authorizationCode, setAuthorizationCode] = useState<string | null>(null);
  const [session, setSession] = useState<EmbeddedSignupSession | null>(null);
  const submittedRef = useRef<string | null>(null);
  const configured = isMetaEmbeddedSignupConfigured();

  useEffect(() => {
    if (!configured || !sdkReady || !window.FB) return;

    window.FB.init({
      appId: META_EMBEDDED_SIGNUP.appId,
      cookie: true,
      xfbml: false,
      version: META_EMBEDDED_SIGNUP.graphVersion,
    });
  }, [configured, sdkReady]);

  useEffect(() => {
    function receiveMetaSession(event: MessageEvent<unknown>) {
      if (!isMetaEmbeddedSignupOrigin(event.origin)) return;

      const session = embeddedSignupSession(event.data);
      if (!session) return;

      const eventName = session.event.toUpperCase();
      if (eventName.includes("CANCEL") || eventName.includes("ERROR")) {
        setSession(null);
        setState("error");
        setMessage("A conexão foi interrompida antes de concluir o cadastro na Meta.");
        return;
      }

      if (eventName.includes("FINISH")) setSession(session);
      setMessage("A Meta recebeu os dados da conta. Finalizando a autorização...");
    }

    window.addEventListener("message", receiveMetaSession);
    return () => window.removeEventListener("message", receiveMetaSession);
  }, []);

  useEffect(() => {
    const wabaId = session?.data.wabaId;
    const phoneNumberId = session?.data.phoneNumberId;
    if (!authorizationCode || !wabaId || !phoneNumberId) return;

    const key = `${authorizationCode}:${wabaId}:${phoneNumberId}`;
    if (submittedRef.current === key) return;
    submittedRef.current = key;
    let cancelled = false;

    setState("loading");
    setMessage("Validando conta e número do WhatsApp Business...");
    void completeWhatsappEmbeddedSignup({
      code: authorizationCode,
      businessId: session.data.businessId,
      wabaId,
      phoneNumberId,
    })
      .then((result) => {
        if (cancelled) return;
        setState("connected");
        setMessage(
          `${result.displayName} (${result.displayNumber}) foi validado pela Meta. O envio ainda aguarda a ativação do remetente.`,
        );
        setAuthorizationCode(null);
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
        setMessage("A Meta não confirmou essa conta ou esse número. Confira os dados e tente novamente.");
        setAuthorizationCode(null);
      });

    return () => {
      cancelled = true;
    };
  }, [authorizationCode, session]);

  function connect() {
    if (!window.FB || !configured) return;

    setState("loading");
    setMessage("Abrindo a conexão segura da Meta...");
    setAuthorizationCode(null);
    setSession(null);
    submittedRef.current = null;
    window.FB.login(
      (response) => {
        const result = embeddedSignupResult(response);
        setState(result.status === "connected" ? "loading" : "error");
        setMessage(result.message);
        setAuthorizationCode(result.code);
      },
      {
        config_id: META_EMBEDDED_SIGNUP.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  return (
    <Card>
      {configured ? (
        <Script
          src={META_SDK_SRC}
          strategy="afterInteractive"
          onReady={() => setSdkReady(true)}
          onError={() => {
            setState("error");
            setMessage("Não foi possível carregar o SDK da Meta.");
          }}
        />
      ) : null}
      <CardHeader>
        <CardTitle
          action={
            <Badge tone={state === "connected" ? "success" : "neutral"}>
              {state === "connected" ? "Autorização recebida" : "Preparação"}
            </Badge>
          }
        >
          Conectar WhatsApp Business
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="space-y-2 text-sm">
          <p className="text-foreground">
            O Embedded Signup prepara a conexão oficial da conta e do número do WhatsApp Business
            do profissional.
          </p>
          <p className="text-muted-foreground">
            Nenhuma mensagem é enviada por este botão. O código de autorização é usado uma única
            vez pelo backend e não é salvo no navegador nem no Firestore.
          </p>
        </div>

        {!configured ? (
          <div className="bg-surface-muted text-muted-foreground space-y-2 rounded-lg p-3 text-sm">
            <p className="text-foreground font-medium">Configuração pendente</p>
            <p>
              Preencha <code>NEXT_PUBLIC_META_APP_ID</code> e
              <code> NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID</code> no
              <code> .env.local</code>. Esses identificadores são públicos; tokens e segredos não
              devem ser colocados no frontend.
            </p>
          </div>
        ) : (
          <Button onClick={connect} disabled={!sdkReady || state === "loading"}>
            {state === "loading" ? "Abrindo Meta..." : "Conectar com a Meta"}
          </Button>
        )}

        {message ? (
          <p role="status" className="text-muted-foreground text-sm">
            {message}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
