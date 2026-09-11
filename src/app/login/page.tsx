"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { AUTH_FIELD_CLASSES, AuthCard } from "@/features/auth/auth-card";
import { AuthError, authAdapter } from "@/lib/auth";
import { SecondFactorRequiredError } from "@/lib/auth/types";
import { useAuth } from "@/providers/auth-provider";

type Step = "credentials" | "code" | "forgot";

export default function LoginPage() {
  const { status, mode, signIn, completeSecondFactor } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // A conta com aplicativo autenticador cadastrado entra em duas etapas.
  const [step, setStep] = useState<Step>("credentials");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  function goTo(next: Step) {
    setStep(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (step === "code") await completeSecondFactor(code);
      else await signIn(email, password);
      router.replace("/dashboard");
    } catch (caught) {
      if (caught instanceof SecondFactorRequiredError) {
        setStep("code");
        return;
      }
      setError(
        caught instanceof AuthError
          ? caught.message
          : "Nao foi possivel entrar. Tente novamente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await authAdapter.sendPasswordReset(email);
      setNotice(
        "Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha. O link vale por 1 hora; confira tambem a caixa de spam.",
      );
    } catch (caught) {
      setError(
        caught instanceof AuthError
          ? caught.message
          : "Nao foi possivel enviar o link agora. Tente novamente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "forgot") {
    return (
      <AuthCard title="Criar uma nova senha">
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Informe o e-mail da sua conta. Vamos enviar um link para voce escolher
          uma senha nova.
        </p>

        <form onSubmit={handleForgot} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-foreground block text-xs font-medium">
              E-mail
            </label>
            <input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@exemplo.com"
              className={AUTH_FIELD_CLASSES}
            />
          </div>

          <Feedback error={error} notice={notice} />

          <Button type="submit" size="lg" className="w-full justify-center" disabled={submitting}>
            {submitting ? "Enviando..." : "Enviar link"}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="w-full justify-center"
            onClick={() => goTo("credentials")}
          >
            Voltar para a entrada
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Entrar no painel">
      {mode === "demo" ? (
        <p className="border-border bg-surface-muted text-muted-foreground mt-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed">
          Demonstracao local. Entre com um cadastro criado pelo administrador.
          As contas e os dados deste modo ficam apenas neste navegador.
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {step === "code" ? (
          <div className="space-y-1.5">
            <label htmlFor="code" className="text-foreground block text-xs font-medium">
              Codigo do aplicativo autenticador
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="000000"
              className={AUTH_FIELD_CLASSES}
            />
          </div>
        ) : null}
        <div hidden={step === "code"} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-foreground block text-xs font-medium">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@exemplo.com"
              className={AUTH_FIELD_CLASSES}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="password" className="text-foreground block text-xs font-medium">
                Senha
              </label>
              <button
                type="button"
                onClick={() => goTo("forgot")}
                className="text-primary min-h-6 text-xs font-medium underline-offset-2 hover:underline"
              >
                Esqueci minha senha
              </button>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={AUTH_FIELD_CLASSES}
            />
          </div>
        </div>

        <Feedback error={error} notice={null} />

        <Button
          type="submit"
          size="lg"
          className="w-full justify-center"
          disabled={submitting}
        >
          {submitting ? "Entrando..." : step === "code" ? "Confirmar codigo" : "Entrar"}
        </Button>
      </form>
    </AuthCard>
  );
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? (
        <p
          role="alert"
          className="border-danger-soft bg-danger-soft text-danger-soft-foreground rounded-lg border px-3 py-2 text-xs"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="bg-success-soft text-success-soft-foreground rounded-lg px-3 py-2 text-xs leading-relaxed"
        >
          {notice}
        </p>
      ) : null}
    </>
  );
}
