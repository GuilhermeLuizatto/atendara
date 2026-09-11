"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { ACCESS_GRANT_KIND_LABELS, ACCESS_GRANT_REASON_LENGTH, MAX_ACCESS_GRANT_DAYS } from "@/config/platform";
import { authAdapter } from "@/lib/auth";
import { isGrantInForce } from "@/lib/platform/access-gate";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { useNow } from "@/lib/utils/use-now";
import { platformAccessReader } from "@/services/platform-access";
import { ACCESS_GRANT_KINDS, type AccessGrantKind, type PageRequest } from "@/types";
import type { AccountAccess } from "@/types/access";

import { LATEST_GRANT_OFFSET_DAYS, dateInputValue, untilFromDateInput } from "./grant-dates";
import { usePagedList } from "./use-paged-list";

/**
 * Concessao manual de acesso. Conceder e revogar passam pelas callables, que
 * exigem segundo fator e gravam o registro na mesma transacao; esta tela so
 * pede e le.
 */
export function AccessGrantsPanel() {
  const reader = platformAccessReader();
  const now = useNow().getTime();
  const fetchAccounts = useCallback((request: PageRequest) => authAdapter.listAccounts(request), []);
  const fetchGrants = useCallback((request: PageRequest) => reader.allAccessGrants(request), [reader]);
  const accounts = usePagedList(fetchAccounts, "Nao foi possivel carregar os cadastros.");
  const grants = usePagedList(fetchGrants, "Nao foi possivel carregar as concessoes.");
  // Titular citado numa concessao que ainda nao apareceu na pagina de cadastros.
  const [cited, setCited] = useState<AccountAccess[]>([]);
  const looked = useRef(new Set<string>());
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const known = new Set([...accounts.items, ...cited].map((account) => account.userId));
    const missing = [...new Set(grants.items.map((item) => item.subscriberUserId))].filter(
      (userId) => !known.has(userId) && !looked.current.has(userId),
    );
    if (missing.length === 0) return;
    for (const userId of missing) looked.current.add(userId);
    let active = true;
    authAdapter
      .accountsById(missing)
      .then((found) => {
        if (active) setCited((current) => [...current, ...found]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [grants.items, accounts.items, cited]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await Promise.all([accounts.reload(), grants.reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel concluir.");
    } finally {
      setBusy(false);
    }
  }

  function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void run(async () => {
      await authAdapter.grantAccess({
        organizationId: String(values.get("organizationId")),
        kind: String(values.get("kind")) as AccessGrantKind,
        until: untilFromDateInput(String(values.get("until"))),
        reason: String(values.get("reason")),
      });
      form.reset();
    });
  }

  const titulares = accounts.items.filter((account) => account.platformRole === "PROFESSIONAL" && account.organizationId);
  const nameOf = (userId: string) => {
    const account = [...accounts.items, ...cited].find((item) => item.userId === userId);
    return account ? `${account.displayName} · ${account.email}` : userId;
  };
  const shownError = error || accounts.error || grants.error;

  return (
    <div className="space-y-6">
      <p className="bg-surface-muted text-muted-foreground rounded-lg p-3 text-sm">
        Concessao libera acesso sem cobranca, por no maximo {MAX_ACCESS_GRANT_DAYS} dias, com tipo e motivo. O
        acesso vale ate a maior data entre a assinatura paga e a concessao vigente: conceder nunca encurta um ciclo
        pago, e revogar fecha so a parte concedida.
      </p>
      {shownError ? <p role="alert" className="text-danger text-sm">{shownError}</p> : null}

      <form onSubmit={grant} className="bg-surface border-border space-y-4 rounded-xl border p-5">
        <h2 className="text-foreground font-semibold">Conceder acesso</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Titular"
            hint={accounts.page.hasMore ? `Lista com os ${accounts.items.length} primeiros cadastros por e-mail.` : undefined}
          >
            {(props) => (
              <Select {...props} name="organizationId" required disabled={accounts.status === "loading"}>
                {titulares.map((account) => (
                  <option key={account.userId} value={account.organizationId!}>
                    {account.displayName} · {account.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tipo">
            {(props) => (
              <Select {...props} name="kind">
                {ACCESS_GRANT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{ACCESS_GRANT_KIND_LABELS[kind]}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Acesso ate">
            {(props) => <Input {...props} name="until" type="date" required defaultValue={dateInputValue(LATEST_GRANT_OFFSET_DAYS)} min={dateInputValue(0)} max={dateInputValue(LATEST_GRANT_OFFSET_DAYS)} />}
          </Field>
        </div>
        <LoadMore
          className="px-0"
          page={accounts.page}
          summary="O titular procurado pode estar nos cadastros ainda nao carregados."
          label="Carregar mais cadastros"
          onLoadMore={() => void accounts.loadMore()}
        />
        <Field label="Motivo" hint="Fica na trilha da operadora. Renovar exige novo motivo.">
          {(props) => <Textarea {...props} name="reason" required minLength={ACCESS_GRANT_REASON_LENGTH.min} maxLength={ACCESS_GRANT_REASON_LENGTH.max} />}
        </Field>
        <Button type="submit" disabled={busy || !titulares.length}>Conceder</Button>
      </form>

      <section className="space-y-3" aria-busy={grants.status === "loading" || undefined}>
        <h2 className="text-foreground font-semibold">Concessoes registradas</h2>
        {!reader.available ? (
          <p className="text-muted-foreground text-sm">Na demonstracao, concessoes nao tem registro; o efeito aparece em Cadastros.</p>
        ) : grants.status === "loading" ? (
          <p role="status" className="text-muted-foreground text-sm">Carregando concessoes...</p>
        ) : grants.items.length === 0 && grants.status === "ready" ? (
          <p className="text-muted-foreground text-sm">Nenhuma concessao registrada.</p>
        ) : (
          <ul className="space-y-3">
            {grants.items.map((item) => {
              const inForce = isGrantInForce(item, now);
              return (
                <li key={item.organizationId} className="bg-surface border-border space-y-2 rounded-xl border p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={inForce ? "success" : "neutral"}>
                      {item.revokedAt ? "Revogada" : inForce ? "Vigente" : "Vencida"}
                    </Badge>
                    <span className="text-foreground font-medium break-words">{nameOf(item.subscriberUserId)}</span>
                    <span className="text-muted-foreground">{ACCESS_GRANT_KIND_LABELS[item.kind]} · ate {formatDate(item.until)}</span>
                  </div>
                  <p className="text-muted-foreground">{item.reason}</p>
                  <p className="text-subtle-foreground text-xs">
                    Concedida em {formatDateTime(item.grantedAt)}
                    {item.revokedAt ? ` · revogada em ${formatDateTime(item.revokedAt)}: ${item.revokeReason ?? ""}` : ""}
                  </p>
                  {inForce && revoking !== item.organizationId ? (
                    <Button variant="outline" disabled={busy} onClick={() => { setRevoking(item.organizationId); setRevokeReason(""); }}>
                      Revogar antes do prazo
                    </Button>
                  ) : null}
                  {inForce && revoking === item.organizationId ? (
                    <div className="space-y-2">
                      <Field label="Motivo da revogacao">
                        {(props) => <Textarea {...props} required minLength={ACCESS_GRANT_REASON_LENGTH.min} maxLength={ACCESS_GRANT_REASON_LENGTH.max} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} />}
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={busy} onClick={() => void run(async () => { await authAdapter.revokeAccess(item.organizationId, revokeReason); setRevoking(null); })}>
                          Confirmar revogacao
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => setRevoking(null)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <LoadMore
          page={grants.page}
          summary={`Mostrando as ${grants.items.length} concessoes mais recentes.`}
          label="Carregar concessoes anteriores"
          onLoadMore={() => void grants.loadMore()}
        />
      </section>
    </div>
  );
}
