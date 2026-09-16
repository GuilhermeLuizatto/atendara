"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonStyles } from "@/components/ui/button";
import { LEGAL_VERSION } from "@/config/legal";
import { TRIAL_DAYS } from "@/config/platform";
import { AuthCard } from "@/features/auth/auth-card";
import { SelfServiceForm, type SelfServiceFormValues } from "@/features/auth/self-service-form";
import { AuthError, authAdapter } from "@/lib/auth";
import { useAuth } from "@/providers/auth-provider";

/**
 * Cadastro aberto: a pessoa cria a propria conta, sem ninguem liberar.
 *
 * Pelo Google sao duas etapas — o Google entrega nome e e-mail ja confirmados,
 * e a segunda pergunta o que falta. Por senha e uma so, e o teste comeca quando
 * o e-mail for confirmado.
 *
 * A mensagem final e a MESMA para e-mail novo e para e-mail ja cadastrado: a
 * tela nunca diz quem tem conta aqui.
 */
export default function SignUpPage() {
  const { mode, signIn } = useAuth();
  const router = useRouter();

  const [identity, setIdentity] = useState<{ displayName: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function fail(caught: unknown, fallback: string) {
    setError(caught instanceof AuthError ? caught.message : fallback);
  }

  async function handleGoogle() {
    setError(null);
    setSubmitting(true);
    try {
      const user = await authAdapter.signInWithGoogle();
      // Ja cadastrada: nao ha segunda etapa a fazer.
      if (user.access) {
        router.replace("/dashboard");
        return;
      }
      setIdentity({ displayName: user.displayName, email: user.email });
    } catch (caught) {
      fail(caught, "Não foi possível entrar com o Google. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(values: SelfServiceFormValues) {
    setError(null);
    setSubmitting(true);
    void (async () => {
      try {
        await authAdapter.registerSelfService({ ...values, acceptedLegalVersion: LEGAL_VERSION });
        if (identity) {
          // O Google ja confirmou o e-mail: o teste comeca agora.
          await authAdapter.activateTrial();
          router.replace("/dashboard");
          return;
        }
        await afterPasswordSignUp(values);
      } catch (caught) {
        fail(caught, "Não foi possível concluir o cadastro. Tente novamente.");
      } finally {
        setSubmitting(false);
      }
    })();
  }

  /**
   * Entrar logo depois de cadastrar e o que permite pedir a confirmacao do
   * e-mail. Se a senha nao servir, o e-mail ja tinha conta — e a resposta
   * continua sendo a mesma frase, sem confirmar nem negar.
   */
  async function afterPasswordSignUp(values: SelfServiceFormValues) {
    try {
      await signIn(values.email, values.password ?? "");
    } catch {
      setSent(values.email);
      return;
    }
    try {
      await authAdapter.sendEmailVerification();
    } catch {
      // Nao muda o destino: a tela de confirmacao tem o botao de reenviar, e e
      // la que o erro faz sentido para quem esta lendo.
    }
    router.replace("/dashboard");
  }

  if (sent) {
    return (
      <AuthCard title="Confira seu e-mail">
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Se <strong className="text-foreground">{sent}</strong> ainda não tiver conta, enviamos
          um e-mail para confirmar o endereço. Se já tiver, entre com a sua senha.
        </p>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          O e-mail pode cair na caixa de spam.
        </p>
        <Link href="/login" className={buttonStyles({ size: "lg", className: "mt-6 w-full justify-center" })}>
          Ir para a entrada
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={identity ? "Falta pouco" : "Criar sua conta"}>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {TRIAL_DAYS} dias para testar, sem cartão.
      </p>

      {mode === "demo" ? (
        <p className="border-border bg-surface-muted text-muted-foreground mt-3 rounded-lg border px-3 py-2.5 text-xs leading-relaxed">
          Demonstração local. A conta criada aqui fica apenas neste navegador e
          nenhum e-mail é enviado.
        </p>
      ) : null}

      {identity ? null : (
        <div className="mt-6 space-y-3">
          <Button
            variant="outline"
            size="lg"
            className="w-full justify-center"
            onClick={() => void handleGoogle()}
            disabled={submitting}
          >
            Entrar com o Google
          </Button>
          <p className="text-subtle-foreground text-center text-xs">ou preencha abaixo</p>
        </div>
      )}

      {error ? (
        <p role="alert" className="border-danger-soft bg-danger-soft text-danger-soft-foreground mt-4 rounded-lg border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <SelfServiceForm identity={identity} submitting={submitting} onSubmit={handleSubmit} />

      <p className="text-muted-foreground mt-6 text-center text-xs">
        Já tem conta?{" "}
        <Link href="/login" className="text-primary underline underline-offset-2">
          Entrar
        </Link>
      </p>
    </AuthCard>
  );
}
