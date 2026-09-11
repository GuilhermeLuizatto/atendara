"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button, buttonStyles } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { AuthError, authAdapter } from "@/lib/auth";
import { passwordError } from "@/lib/auth/passwords";

type State =
  | { step: "checking" }
  | { step: "ready"; email: string }
  | { step: "invalid"; message: string }
  | { step: "done" };

/**
 * Segunda metade da recuperacao: o link do e-mail traz `oobCode`, e aqui ele e
 * conferido antes de pedir a senha — assim quem abre um link vencido descobre
 * antes de digitar, e nao depois.
 */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const code = params.get("oobCode");
  const incomplete = !code || params.get("mode") !== "resetPassword";

  const [state, setState] = useState<State>({ step: "checking" });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (incomplete || !code) return;
    let active = true;
    authAdapter
      .verifyPasswordReset(code)
      .then((email) => {
        if (active) setState({ step: "ready", email });
      })
      .catch((caught) => {
        if (active) {
          setState({
            step: "invalid",
            message:
              caught instanceof AuthError
                ? caught.message
                : "Nao foi possivel conferir este link.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [code, incomplete]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid = passwordError(password);
    if (invalid || password !== confirmation) {
      setError(invalid ?? "As duas senhas precisam ser iguais.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await authAdapter.confirmPasswordReset(code!, password);
      setState({ step: "done" });
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Nao foi possivel salvar a nova senha.");
    } finally {
      setBusy(false);
    }
  }

  if (incomplete || state.step === "invalid") {
    return (
      <div className="mt-4 space-y-4">
        <p role="alert" className="bg-danger-soft text-danger-soft-foreground rounded-lg px-3 py-2 text-sm">
          {incomplete
            ? "Este link esta incompleto. Abra o link exatamente como chegou no e-mail, ou peca um novo."
            : (state as { message: string }).message}
        </p>
        <Link href="/login" className={buttonStyles({ size: "lg", className: "w-full justify-center" })}>
          Ir para a entrada
        </Link>
      </div>
    );
  }

  if (state.step === "checking") {
    return (
      <p role="status" className="text-muted-foreground mt-4 text-sm">
        Conferindo o link...
      </p>
    );
  }

  if (state.step === "done") {
    return (
      <div className="mt-4 space-y-4">
        <p role="status" className="bg-success-soft text-success-soft-foreground rounded-lg px-3 py-2 text-sm">
          Senha alterada. Entre com o seu e-mail e a senha nova.
        </p>
        <Link href="/login" className={buttonStyles({ size: "lg", className: "w-full justify-center" })}>
          Entrar
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <p className="text-muted-foreground text-sm">
        Conta: <span className="text-foreground font-medium">{state.email}</span>
      </p>
      {/* Campo de usuario oculto: gerenciadores de senha associam a senha nova
          a conta certa. */}
      <input type="email" name="username" autoComplete="username" value={state.email} readOnly hidden />
      <Field label="Nova senha" hint="Use de 12 a 128 caracteres.">
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      <Field label="Confirme a nova senha">
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full justify-center" disabled={busy}>
        {busy ? "Salvando..." : "Salvar nova senha"}
      </Button>
    </form>
  );
}
