"use client";

import { useCallback, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { MODULE_LABELS } from "@/config/access";
import { ACCESS_GRANT_KIND_LABELS, ACCESS_GRANT_REASON_LENGTH } from "@/config/platform";
import { listProfessions } from "@/config/professions";
import { authAdapter } from "@/lib/auth";
import { formatDate } from "@/lib/utils/format";
import { useNow } from "@/lib/utils/use-now";
import { useAuth } from "@/providers/auth-provider";
import { ACCESS_GRANT_KINDS, type AccessGrantKind, type PageRequest, type ProfessionId } from "@/types";
import { APP_MODULES, type AccountAccess, type AppModule } from "@/types/access";

import { LATEST_GRANT_OFFSET_DAYS, dateInputValue, untilFromDateInput } from "./grant-dates";
import { usePagedList } from "./use-paged-list";

function accessLabel(account: AccountAccess, nowMs: number): string {
  const open = account.subscriptionStatus === "ACTIVE" && account.accessUntil && Date.parse(account.accessUntil) > nowMs;
  return open ? `Liberado ate ${formatDate(account.accessUntil!)}` : "Sem acesso vigente";
}

/**
 * Cadastro e alteracao de conta. Situacao da mensalidade e validade nao se
 * editam aqui: vem do webhook do gateway ou de concessao registrada.
 */
export function AccountsPanel() {
  const { mode } = useAuth();
  const now = useNow().getTime();
  const fetchAccounts = useCallback((request: PageRequest) => authAdapter.listAccounts(request), []);
  const accounts = usePagedList(fetchAccounts, "Nao foi possivel carregar os cadastros.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [modules, setModules] = useState<AppModule[]>([...APP_MODULES]);
  const [withGrant, setWithGrant] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(""); setCredential(null);
    try {
      const email = String(values.get("email"));
      const initialGrant = withGrant
        ? { kind: String(values.get("kind")) as AccessGrantKind, until: untilFromDateInput(String(values.get("until"))), reason: String(values.get("reason")) }
        : undefined;
      const result = await authAdapter.registerProfessional({ email, displayName: String(values.get("name")), professionId: String(values.get("profession")) as ProfessionId, modules, initialGrant });
      setCredential({ email, password: result.temporaryPassword });
      await accounts.reload();
      form.reset(); setWithGrant(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel cadastrar."); }
    finally { setBusy(false); }
  }

  async function save(account: AccountAccess) {
    setBusy(true); setError("");
    try { await authAdapter.updateAccount(account.userId, { status: account.status, modules: account.modules }); await accounts.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar."); }
    finally { setBusy(false); }
  }

  const edit = (id: string, changes: Partial<AccountAccess>) => accounts.setItems(current => current.map(item => item.userId === id ? { ...item, ...changes } : item));
  const professionals = accounts.items.filter(a => a.platformRole === "PROFESSIONAL");
  const shownError = error || accounts.error;

  return <div className="space-y-6">
    <p className="bg-surface-muted text-muted-foreground rounded-lg p-3 text-sm">
      A conta nasce sem acesso. Quem libera e o webhook do gateway, quando a assinatura e paga, ou uma concessao registrada, com tipo, prazo e motivo. Cada cadastro e alteracao entra na trilha da operadora. O cadastro nao faz cobranca nem envia mensagens.{mode === "demo" ? " Modo local: estes cadastros existem somente neste navegador." : ""}
    </p>
    {shownError ? <p role="alert" className="text-danger text-sm">{shownError}</p> : null}
    <form onSubmit={submit} className="bg-surface border-border space-y-4 rounded-xl border p-5">
      <h2 className="text-foreground font-semibold">Adicionar profissional</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">{props => <Input {...props} name="name" required minLength={3} maxLength={100} />}</Field>
        <Field label="E-mail">{props => <Input {...props} name="email" type="email" required />}</Field>
        <Field label="Profissao liberada">{props => <Select {...props} name="profession">{listProfessions().map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>}</Field>
      </div>
      <fieldset><legend className="text-foreground mb-2 text-sm">Modulos liberados</legend><div className="flex flex-wrap gap-4">{APP_MODULES.map(module => <label key={module} className="text-muted-foreground flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" className="accent-primary size-4" checked={modules.includes(module)} onChange={e => setModules(current => e.target.checked ? [...current, module] : current.filter(m => m !== module))} />{MODULE_LABELS[module]}</label>)}</div></fieldset>
      <fieldset className="space-y-3">
        <legend className="text-foreground text-sm">Concessao inicial</legend>
        <label className="text-muted-foreground flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" className="accent-primary size-4" checked={withGrant} onChange={e => setWithGrant(e.target.checked)} />Liberar acesso agora, por concessao registrada</label>
        {withGrant ? <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">{props => <Select {...props} name="kind">{ACCESS_GRANT_KINDS.map(kind => <option key={kind} value={kind}>{ACCESS_GRANT_KIND_LABELS[kind]}</option>)}</Select>}</Field>
          <Field label="Acesso ate">{props => <Input {...props} name="until" type="date" required defaultValue={dateInputValue(30)} min={dateInputValue(0)} max={dateInputValue(LATEST_GRANT_OFFSET_DAYS)} />}</Field>
          <div className="sm:col-span-2"><Field label="Motivo" hint="Fica na trilha da operadora.">{props => <Textarea {...props} name="reason" required minLength={ACCESS_GRANT_REASON_LENGTH.min} maxLength={ACCESS_GRANT_REASON_LENGTH.max} />}</Field></div>
        </div> : null}
      </fieldset>
      <Button type="submit" disabled={busy || !modules.length}>Criar cadastro e senha inicial</Button>
    </form>
    {credential ? <section className="bg-success-soft text-success-soft-foreground space-y-2 rounded-xl p-5" aria-label="Acesso inicial criado"><h2 className="font-semibold">Cadastro criado</h2><p>{credential.email}</p><p className="break-all font-mono">{credential.password}</p><p className="text-sm">Guarde a senha inicial e entregue ao profissional. Nenhuma mensagem foi enviada. A troca sera exigida no primeiro acesso.</p><Button variant="outline" onClick={() => setCredential(null)}>Ocultar senha</Button></section> : null}
    <section className="space-y-4" aria-busy={accounts.status === "loading" || undefined}><h2 className="text-foreground font-semibold">Profissionais cadastrados</h2>
      {accounts.status === "loading" ? <p role="status" className="text-muted-foreground text-sm">Carregando cadastros...</p> : null}
      {professionals.map(account => <article key={account.userId} aria-labelledby={`conta-${account.userId}`} className="bg-surface border-border space-y-4 rounded-xl border p-5">
        <div><h3 id={`conta-${account.userId}`} className="text-foreground font-medium">{account.displayName}</h3><p className="text-muted-foreground text-sm break-words">{account.email} · {listProfessions().find(p => p.id === account.professionId)?.label} · {accessLabel(account, now)}</p></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Situacao do cadastro">{props => <Select {...props} value={account.status} onChange={e => edit(account.userId, { status: e.target.value as AccountAccess["status"] })}><option value="ACTIVE">Ativo</option><option value="SUSPENDED">Suspenso</option></Select>}</Field>
        </div>
        <fieldset><legend className="text-foreground mb-2 text-sm">Permissoes</legend><div className="flex flex-wrap gap-4">{APP_MODULES.map(module => <label key={module} className="text-muted-foreground flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" className="accent-primary size-4" checked={account.modules.includes(module)} onChange={e => edit(account.userId, { modules: e.target.checked ? [...account.modules, module] : account.modules.filter(m => m !== module) })} />{MODULE_LABELS[module]}</label>)}</div></fieldset>
        <Button disabled={busy || !account.modules.length} onClick={() => void save(account)}>Salvar cadastro</Button>
      </article>)}
      {accounts.status === "ready" && !professionals.length && !accounts.page.hasMore ? <p className="text-muted-foreground text-sm">Nenhum profissional cadastrado.</p> : null}
      <LoadMore page={accounts.page} summary={`Mostrando ${accounts.items.length} cadastros, em ordem de e-mail.`} label="Carregar mais cadastros" onLoadMore={() => void accounts.loadMore()} />
    </section>
  </div>;
}
