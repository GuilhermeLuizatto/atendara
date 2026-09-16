"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { PROFESSION_CHANGE_REASON_LENGTH } from "@/config/platform";
import { getProfession, listProfessions } from "@/config/professions";
import { formatDateTime } from "@/lib/utils/format";
import { authAdapter } from "@/lib/auth";
import { platformAccessReader } from "@/services/platform-access";
import type { ProfessionChangeRequest, ProfessionId } from "@/types";

/**
 * Pedido de troca de profissao (A.7).
 *
 * A pessoa nao troca sozinha. A profissao decide vocabulario, taxonomia e o
 * quanto um aviso pode revelar: um dentista que vira medico, ou um psiquiatra
 * que vira psicologo, muda tudo isso de uma vez. Aqui ela pede e acompanha; a
 * decisao e da operadora, com registro.
 */
export function ProfessionChange({
  organizationId,
  current,
  isHolder,
}: {
  organizationId: string;
  current: ProfessionId;
  /** Somente o titular pede. A callable confere de novo no servidor. */
  isHolder: boolean;
}) {
  const reader = platformAccessReader();
  const [pedido, setPedido] = useState<ProfessionChangeRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Em `.then`, e nao com `await`: o compilador do React recusa `setState`
  // sincrono no corpo de um efeito, e o mesmo formato ja e o de `usePagedList`.
  const load = useCallback(
    () =>
      reader
        .professionChangeRequest(organizationId)
        .then(setPedido)
        // Sem pedido legivel a tela segue oferecendo o formulario: o servidor
        // recusa um segundo pedido aberto de qualquer jeito.
        .catch(() => setPedido(null)),
    [reader, organizationId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const outras = listProfessions().filter((profession) => profession.id !== current);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await authAdapter.requestProfessionChange(
        String(values.get("profession")) as ProfessionId,
        String(values.get("reason")),
      );
      form.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar o pedido.");
    } finally {
      setBusy(false);
    }
  }

  if (pedido?.status === "PENDING") {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-foreground">
          Pedido enviado: <strong>{getProfession(pedido.from).label}</strong> para{" "}
          <strong>{getProfession(pedido.to).label}</strong>.
        </p>
        <p className="text-muted-foreground">
          Enviado em {formatDateTime(pedido.requestedAt)}. Enquanto não houver resposta, sua
          profissão continua {getProfession(pedido.from).label}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pedido?.status === "REJECTED" ? (
        <p className="border-danger-soft bg-danger-soft text-danger-soft-foreground rounded-lg border px-3 py-2 text-sm">
          Seu último pedido foi recusado{pedido.decisionReason ? `: ${pedido.decisionReason}` : "."} Você
          pode pedir de novo.
        </p>
      ) : null}

      {isHolder ? (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Trocar de profissão muda o vocabulário do painel, a forma como as mensagens são
            classificadas e o que um aviso pode dizer. Por isso o pedido passa por nós. Se você tiver
            registro em conselho, informe o novo depois da aprovação — o anterior não vale para a
            profissão nova.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nova profissão">
              {(props) => (
                <Select {...props} name="profession" required>
                  {outras.map((profession) => (
                    <option key={profession.id} value={profession.id}>
                      {profession.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Por quê" hint="Fica registrado junto do pedido.">
            {(props) => (
              <Textarea
                {...props}
                name="reason"
                required
                minLength={PROFESSION_CHANGE_REASON_LENGTH.min}
                maxLength={PROFESSION_CHANGE_REASON_LENGTH.max}
              />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-danger-soft-foreground bg-danger-soft rounded-lg px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Enviando..." : "Pedir a troca"}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">
          Somente o titular da organização pede a troca de profissão.
        </p>
      )}
    </div>
  );
}
