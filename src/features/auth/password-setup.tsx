"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { authAdapter } from "@/lib/auth";
import { passwordError } from "@/lib/auth/passwords";
import { useAuth } from "@/providers/auth-provider";

export function PasswordSetup() {
  const { user, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = passwordError(password);
    if (validation || password !== confirmation) { setError(validation ?? "As senhas precisam ser iguais."); return; }
    setBusy(true); setError("");
    try { await authAdapter.completeInitialPassword(password); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar sua senha."); }
    finally { setBusy(false); }
  }
  return <main className="bg-background flex min-h-dvh items-center justify-center p-6">
    <form onSubmit={submit} className="border-border bg-surface w-full max-w-md space-y-5 rounded-xl border p-6">
      <h1 className="text-foreground text-xl font-semibold">Crie sua senha pessoal</h1>
      <p className="text-muted-foreground text-sm">Primeiro acesso de {user?.email}. Substitua a senha inicial para liberar seu painel.</p>
      <Field label="Nova senha" hint="Use de 12 a 128 caracteres.">{props => <Input {...props} type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} />}</Field>
      <Field label="Confirme a nova senha">{props => <Input {...props} type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} />}</Field>
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
      <Button type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar minha senha"}</Button>
      <Button type="button" variant="ghost" onClick={() => void signOut()}>Sair</Button>
    </form>
  </main>;
}
