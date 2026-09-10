"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { PlatformBillingPanel } from "./platform-billing";
import { MODULE_LABELS, isPlatformAdmin } from "@/config/access";
import { listProfessions } from "@/config/professions";
import { authAdapter } from "@/lib/auth";
import { useAuth } from "@/providers/auth-provider";
import { APP_MODULES, type AccountAccess, type AppModule } from "@/types/access";
import type { ProfessionId } from "@/types";

function nextMonth() { const date = new Date(); date.setMonth(date.getMonth() + 1); return date.toISOString().slice(0, 10); }
export function AdminView() {
  const { user, mode } = useAuth();
  const [accounts, setAccounts] = useState<AccountAccess[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [modules, setModules] = useState<AppModule[]>([...APP_MODULES]);
  const [tab, setTab] = useState<"cadastros" | "cobranca">("cadastros");
  const admin = isPlatformAdmin(user?.access);
  useEffect(() => {
    if (!admin) return;
    let active = true;
    authAdapter.listAccounts().then(items => { if (active) setAccounts(items); }).catch(() => { if (active) setError("Nao foi possivel carregar os cadastros."); });
    return () => { active = false; };
  }, [admin]);
  if (!admin) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setError(""); setCredential(null);
    try {
      const email = String(values.get("email"));
      const result = await authAdapter.registerProfessional({ email, displayName: String(values.get("name")), professionId: String(values.get("profession")) as ProfessionId, modules, accessUntil: new Date(`${values.get("until")}T23:59:59-03:00`).toISOString() });
      setCredential({ email, password: result.temporaryPassword });
      setAccounts(await authAdapter.listAccounts()); form.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel cadastrar."); }
    finally { setBusy(false); }
  }
  async function save(account: AccountAccess) {
    setBusy(true); setError("");
    try { await authAdapter.updateAccount(account.userId, { modules: account.modules, status: account.status, subscriptionStatus: account.subscriptionStatus, accessUntil: account.accessUntil }); setAccounts(await authAdapter.listAccounts()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar."); }
    finally { setBusy(false); }
  }
  const edit = (id: string, changes: Partial<AccountAccess>) => setAccounts(current => current.map(item => item.userId === id ? { ...item, ...changes } : item));
  return <div className="mx-auto max-w-6xl space-y-6 p-6">
    <div><h1 className="text-foreground text-2xl font-semibold">Administracao</h1><p className="text-muted-foreground mt-1 text-sm">Profissionais, permissoes e a cobranca da plataforma.</p></div>
    <Tabs options={[{ value: "cadastros", label: "Cadastros e acesso" }, { value: "cobranca", label: "Cobranca da plataforma" }]} value={tab} onChange={setTab} />
    {/* A aba de cobranca le somente as colecoes `platform*`. Nenhuma consulta
        daqui alcanca o financeiro operacional de organizacao nenhuma. */}
    {tab === "cobranca" ? <PlatformBillingPanel /> : <>
    <p className="bg-surface-muted text-muted-foreground rounded-lg p-3 text-sm">A validade tambem pode ser ajustada a mao aqui; com a assinatura ativa quem escreve essa data e o webhook do gateway. O cadastro nao faz cobranca nem envia mensagens.{mode === "demo" ? " Modo local: estes cadastros existem somente neste navegador." : " As contas sao gerenciadas pelo Firebase."}</p>
    {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
    <form onSubmit={submit} className="bg-surface border-border space-y-4 rounded-xl border p-5">
      <h2 className="text-foreground font-semibold">Adicionar profissional</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">{props => <Input {...props} name="name" required minLength={3} maxLength={100} />}</Field>
        <Field label="E-mail">{props => <Input {...props} name="email" type="email" required />}</Field>
        <Field label="Profissao liberada">{props => <Select {...props} name="profession">{listProfessions().map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>}</Field>
        <Field label="Acesso pago ate">{props => <Input {...props} name="until" type="date" defaultValue={nextMonth()} required />}</Field>
      </div>
      <fieldset><legend className="text-foreground mb-2 text-sm">Modulos liberados</legend><div className="flex flex-wrap gap-4">{APP_MODULES.map(module => <label key={module} className="text-muted-foreground flex items-center gap-2 text-sm"><input type="checkbox" checked={modules.includes(module)} onChange={e => setModules(current => e.target.checked ? [...current, module] : current.filter(m => m !== module))} />{MODULE_LABELS[module]}</label>)}</div></fieldset>
      <Button type="submit" disabled={busy || !modules.length}>Criar cadastro e senha inicial</Button>
    </form>
    {credential ? <section className="bg-success-soft text-success-soft-foreground space-y-2 rounded-xl p-5" aria-label="Acesso inicial criado"><h2 className="font-semibold">Cadastro criado</h2><p>{credential.email}</p><p className="break-all font-mono">{credential.password}</p><p className="text-sm">Guarde a senha inicial e entregue ao profissional. Nenhuma mensagem foi enviada. A troca sera exigida no primeiro acesso.</p><Button variant="outline" onClick={() => setCredential(null)}>Ocultar senha</Button></section> : null}
    <section className="space-y-4"><h2 className="text-foreground font-semibold">Profissionais cadastrados</h2>
      {accounts.filter(a => a.platformRole === "PROFESSIONAL").map(account => <article key={account.userId} className="bg-surface border-border space-y-4 rounded-xl border p-5">
        <div><h3 className="text-foreground font-medium">{account.displayName}</h3><p className="text-muted-foreground text-sm">{account.email} · {listProfessions().find(p => p.id === account.professionId)?.label}</p></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Situacao">{props => <Select {...props} value={account.status} onChange={e => edit(account.userId, {status: e.target.value as AccountAccess["status"]})}><option value="ACTIVE">Ativo</option><option value="SUSPENDED">Suspenso</option></Select>}</Field>
          <Field label="Mensalidade">{props => <Select {...props} value={account.subscriptionStatus} onChange={e => edit(account.userId, {subscriptionStatus: e.target.value as AccountAccess["subscriptionStatus"]})}><option value="ACTIVE">Ativa</option><option value="PENDING">Pendente</option><option value="CANCELLED">Cancelada</option></Select>}</Field>
          <Field label="Acesso ate">{props => <Input {...props} type="date" value={account.accessUntil?.slice(0, 10) ?? ""} onChange={e => edit(account.userId, {accessUntil: e.target.value ? new Date(`${e.target.value}T23:59:59-03:00`).toISOString() : null})} />}</Field>
        </div>
        <fieldset><legend className="text-foreground mb-2 text-sm">Permissoes</legend><div className="flex flex-wrap gap-4">{APP_MODULES.map(module => <label key={module} className="text-muted-foreground flex items-center gap-2 text-sm"><input type="checkbox" checked={account.modules.includes(module)} onChange={e => edit(account.userId, { modules: e.target.checked ? [...account.modules, module] : account.modules.filter(m => m !== module) })} />{MODULE_LABELS[module]}</label>)}</div></fieldset>
        <Button disabled={busy || !account.modules.length} onClick={() => void save(account)}>Salvar acesso</Button>
      </article>)}
      {!accounts.some(a => a.platformRole === "PROFESSIONAL") ? <p className="text-muted-foreground text-sm">Nenhum profissional cadastrado.</p> : null}
    </section>
    </>}
  </div>;
}
