"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { authAdapter } from "@/lib/auth";
import type { SecondFactorState, TotpEnrollment } from "@/lib/auth/types";
import { useAuth } from "@/providers/auth-provider";

/**
 * Porta de segundo fator da operadora.
 *
 * Conveniencia de interface: sem o fator, regras e callables ja recusam tudo o
 * que esta atras daqui. A porta so evita uma tela cheia de erros e conduz o
 * cadastro do aplicativo autenticador.
 */
export function SecondFactorGate({ children }: { children: ReactNode }) {
  const { mode, signOut } = useAuth();
  const [state, setState] = useState<SecondFactorState | "loading">("loading");
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(
    () =>
      authAdapter
        .secondFactorState()
        .then(setState)
        .catch(() => setError("Não foi possível conferir o segundo fator desta sessão.")),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await authAdapter.finishTotpEnrollment(code);
      setEnrollment(null);
      setCode("");
      setNotice("Aplicativo autenticador cadastrado. Saia e entre de novo: o código será pedido depois da senha.");
      setState("sign-in-again");
    });
  }

  if (state === "satisfied") return <>{children}</>;
  if (state === "not-applicable") {
    return (
      <>
        {mode === "demo" ? (
          <p className="bg-surface-muted text-muted-foreground rounded-lg p-3 text-sm">
            Demonstração local: o segundo fator exigido da operadora em produção não é simulado aqui.
          </p>
        ) : null}
        {children}
      </>
    );
  }

  return (
    <section aria-label="Segundo fator da operadora" className="bg-surface border-border max-w-xl space-y-4 rounded-xl border p-5">
      <h2 className="text-foreground font-semibold">Segundo fator obrigatório</h2>
      <p className="text-muted-foreground text-sm">
        A administração só abre com uma sessão que entrou usando o código de um aplicativo autenticador (TOTP).
        Senha sozinha não cadastra, não altera conta e não concede acesso.
      </p>
      {state === "loading" && !error ? <p className="text-muted-foreground text-sm">Conferindo a sessão...</p> : null}
      {notice ? <p role="status" className="bg-success-soft text-success-soft-foreground rounded-lg p-3 text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}

      {state === "verify-email" ? (
        <div className="space-y-3">
          <p className="text-foreground text-sm">Antes do cadastro do aplicativo, confirme o e-mail desta conta.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run(async () => { await authAdapter.sendEmailVerification(); setNotice("Enviamos o link de confirmação para o e-mail da conta."); })}>
              Enviar confirmação de e-mail
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void run(async () => { await refresh(); })}>
              Já confirmei
            </Button>
          </div>
        </div>
      ) : null}

      {state === "enroll" && !enrollment ? (
        <Button disabled={busy} onClick={() => void run(async () => setEnrollment(await authAdapter.startTotpEnrollment()))}>
          Cadastrar aplicativo autenticador
        </Button>
      ) : null}

      {state === "enroll" && enrollment ? (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-foreground text-sm">No aplicativo autenticador, adicione uma conta com esta chave:</p>
          <p className="bg-surface-muted text-foreground rounded-lg p-3 font-mono text-sm break-all">{enrollment.secretKey}</p>
          <p className="text-muted-foreground text-sm">
            No celular, o link <a className="text-primary underline" href={enrollment.uri}>abre direto no aplicativo</a>.
          </p>
          <Field label="Código de 6 dígitos">
            {(props) => (
              <Input {...props} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} />
            )}
          </Field>
          <Button type="submit" disabled={busy}>Confirmar cadastro</Button>
        </form>
      ) : null}

      {state === "sign-in-again" ? (
        <div className="space-y-3">
          {!notice ? <p className="text-foreground text-sm">Esta sessão entrou sem o código. Saia e entre de novo para usar a administração.</p> : null}
          <Button onClick={() => void signOut()}>Sair e entrar com o código</Button>
        </div>
      ) : null}
    </section>
  );
}
