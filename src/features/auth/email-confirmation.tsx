"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TRIAL_DAYS } from "@/config/platform";
import { AuthCard } from "@/features/auth/auth-card";
import { AuthError, authAdapter } from "@/lib/auth";
import { useAuth } from "@/providers/auth-provider";

/**
 * Entre o cadastro e o painel.
 *
 * A conta existe e nao abre nada: o teste de 14 dias so comeca quando o e-mail
 * for confirmado, porque e a confirmacao que prova que o endereco e de alguem.
 *
 * Nao ficamos perguntando ao servidor de tempos em tempos: quem confirmou clica
 * no botao, e a sessao e relida com token novo — `email_verified` viaja no
 * token, e sem renovar a callable recusaria quem acabou de confirmar.
 */
export function EmailConfirmation() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function fail(caught: unknown, fallback: string) {
    setError(caught instanceof AuthError ? caught.message : fallback);
  }

  async function confirm() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const refreshed = await authAdapter.refreshSession();
      if (!refreshed?.emailVerified) {
        setError("Ainda não recebemos a confirmação. Abra o link do e-mail e tente de novo.");
        return;
      }
      await authAdapter.activateTrial();
      // A assinatura do cadastro emite o estado novo sozinha; nada a redirecionar.
      await authAdapter.refreshSession();
    } catch (caught) {
      fail(caught, "Não foi possível começar seu teste agora. Tente de novo em instantes.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await authAdapter.sendEmailVerification();
      setNotice("Enviamos outro e-mail. Confira também a caixa de spam.");
    } catch (caught) {
      fail(caught, "Não foi possível enviar o e-mail agora. Tente de novo em instantes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Confirme seu e-mail">
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Enviamos um link para <strong className="text-foreground">{user?.email}</strong>. Abra
        o link e volte aqui: seus {TRIAL_DAYS} dias de teste começam na confirmação, não no
        cadastro.
      </p>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        O e-mail pode cair na caixa de spam.
      </p>

      <div className="mt-6 space-y-3">
        {error ? (
          <p role="alert" className="border-danger-soft bg-danger-soft text-danger-soft-foreground rounded-lg border px-3 py-2 text-xs">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="bg-success-soft text-success-soft-foreground rounded-lg px-3 py-2 text-xs leading-relaxed">
            {notice}
          </p>
        ) : null}

        <Button size="lg" className="w-full justify-center" onClick={() => void confirm()} disabled={busy}>
          {busy ? "Conferindo..." : "Já confirmei, abrir meu painel"}
        </Button>
        <Button variant="outline" size="lg" className="w-full justify-center" onClick={() => void resend()} disabled={busy}>
          Enviar o e-mail de novo
        </Button>
        <Button variant="ghost" size="lg" className="w-full justify-center" onClick={() => void signOut()}>
          Sair
        </Button>
      </div>
    </AuthCard>
  );
}
