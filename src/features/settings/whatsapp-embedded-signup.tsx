"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { isMetaEmbeddedSignupConfigured, META_EMBEDDED_SIGNUP } from "@/config/meta";
import { embeddedSignupResult } from "@/lib/meta/embedded-signup";

type ConnectionState = "idle" | "loading" | "connected" | "error";

const META_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

export function WhatsappEmbeddedSignup() {
  const [sdkReady, setSdkReady] = useState(false);
  const [state, setState] = useState<ConnectionState>("idle");
  const [message, setMessage] = useState("");
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

  function connect() {
    if (!window.FB || !configured) return;

    setState("loading");
    setMessage("Abrindo a conexão segura da Meta...");
    window.FB.login(
      (response) => {
        const result = embeddedSignupResult(response);
        setState(result.status === "connected" ? "connected" : "error");
        setMessage(result.message);
      },
      {
        config_id: META_EMBEDDED_SIGNUP.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { feature: "whatsapp_embedded_signup", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <Card>
      {configured ? (
        <Script
          src={META_SDK_SRC}
          strategy="afterInteractive"
          onLoad={() => setSdkReady(true)}
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
            O Embedded Signup prepara a conexão oficial da Meta e pode permitir a coexistência
            entre o WhatsApp Business do celular e a plataforma.
          </p>
          <p className="text-muted-foreground">
            Nenhuma mensagem é enviada por este botão. O código de autorização não é salvo no
            navegador; a troca segura acontecerá no backend quando as Functions estiverem prontas.
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
