"use client";

import { useCallback, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { authAdapter } from "@/lib/auth";
import { useAuth } from "@/providers/auth-provider";
import type { PageRequest } from "@/types";
import type { AccountAccess } from "@/types/access";

import { usePagedList } from "./use-paged-list";

/**
 * Administradores da plataforma. So a chave mestra ve esta aba, e as callables
 * recusam qualquer outra conta de qualquer jeito. A propria conta e a de outra
 * chave mestra aparecem sem botao: nenhuma das duas muda por aqui.
 */
export function PlatformAdminsPanel() {
  const { user } = useAuth();
  const fetchAccounts = useCallback((request: PageRequest) => authAdapter.listAccounts(request), []);
  const accounts = usePagedList(fetchAccounts, "Nao foi possivel carregar as contas.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    setCredential(null);
    try {
      const email = String(values.get("email"));
      const result = await authAdapter.createPlatformAdmin({ displayName: String(values.get("name")), email });
      setCredential({ email, password: result.temporaryPassword });
      await accounts.reload();
      form.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel cadastrar.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(account: AccountAccess, status: AccountAccess["status"]) {
    setBusy(true);
    setError("");
    try {
      await authAdapter.setPlatformAdminStatus(account.userId, status);
      await accounts.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar.");
    } finally {
      setBusy(false);
    }
  }

  const admins = accounts.items.filter((account) => account.platformRole === "PLATFORM_ADMIN");
  const shownError = error || accounts.error;

  return (
    <div className="space-y-6">
      <p className="bg-surface-muted text-muted-foreground rounded-lg p-3 text-sm">
        Administradores cadastram profissionais e concedem acesso. Criar, suspender e reativar administradores e
        so da chave mestra. O novo administrador troca a senha inicial e cadastra o aplicativo autenticador no
        primeiro acesso, e cada ato fica na trilha da operadora.
      </p>
      {shownError ? <p role="alert" className="text-danger text-sm">{shownError}</p> : null}

      <form onSubmit={submit} className="bg-surface border-border space-y-4 rounded-xl border p-5">
        <h2 className="text-foreground font-semibold">Adicionar administrador</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">{(props) => <Input {...props} name="name" required minLength={3} maxLength={100} />}</Field>
          <Field label="E-mail">{(props) => <Input {...props} name="email" type="email" required />}</Field>
        </div>
        <Button type="submit" disabled={busy}>Criar administrador e senha inicial</Button>
      </form>

      {credential ? (
        <section className="bg-success-soft text-success-soft-foreground space-y-2 rounded-xl p-5" aria-label="Acesso inicial criado">
          <h2 className="font-semibold">Administrador criado</h2>
          <p>{credential.email}</p>
          <p className="font-mono break-all">{credential.password}</p>
          <p className="text-sm">Entregue a senha inicial pessoalmente. Nenhuma mensagem foi enviada.</p>
          <Button variant="outline" onClick={() => setCredential(null)}>Ocultar senha</Button>
        </section>
      ) : null}

      <section className="space-y-3" aria-busy={accounts.status === "loading" || undefined}>
        <h2 className="text-foreground font-semibold">Administradores</h2>
        {accounts.status === "loading" ? <p role="status" className="text-muted-foreground text-sm">Carregando contas...</p> : null}
        <ul className="space-y-3">
          {admins.map((account) => {
            const locked = account.platformMaster === true || account.userId === user?.userId;
            return (
              <li key={account.userId} className="bg-surface border-border flex flex-wrap items-center gap-3 rounded-xl border p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground font-medium">{account.displayName}</p>
                  <p className="text-muted-foreground break-words">{account.email}</p>
                </div>
                {account.platformMaster ? <Badge tone="info">Chave mestra</Badge> : null}
                <Badge tone={account.status === "ACTIVE" ? "success" : "neutral"}>
                  {account.status === "ACTIVE" ? "Ativo" : "Suspenso"}
                </Badge>
                {locked ? null : account.status === "ACTIVE" ? (
                  <Button variant="outline" disabled={busy} onClick={() => void changeStatus(account, "SUSPENDED")}>
                    Suspender
                  </Button>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => void changeStatus(account, "ACTIVE")}>
                    Reativar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {accounts.status === "ready" && !admins.length && !accounts.page.hasMore ? (
          <p className="text-muted-foreground text-sm">Nenhum administrador cadastrado.</p>
        ) : null}
        <LoadMore
          page={accounts.page}
          summary={`Mostrando ${accounts.items.length} contas, em ordem de e-mail.`}
          label="Carregar mais contas"
          onLoadMore={() => void accounts.loadMore()}
        />
      </section>
    </div>
  );
}
