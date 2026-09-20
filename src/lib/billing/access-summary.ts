import { isGrantInForce, type GrantSource } from "@/lib/platform/access-gate";
import type { AccessGrantKind, ISODateString, PlatformSubscription } from "@/types";

/** O minimo da concessao que esta tela precisa: validade, revogacao e tipo. */
export type GrantForAccess = GrantSource & { kind: AccessGrantKind };

/**
 * O que a tela "Minha assinatura" diz sobre acesso, concessão e devolução.
 *
 * Existe porque três textos daquela tela estavam errados, e errados de um jeito
 * que só aparece no caso real:
 *
 * 1. **"A operadora liberou seu acesso"** no teste do autocadastro. Ninguém
 *    liberou nada: a própria pessoa começou o teste ao confirmar o e-mail. O
 *    teste é uma concessão de tipo `TRIAL`, e ela merece outro texto.
 * 2. **"Acesso liberado até 19/09"** para quem tinha teste até 02/10. A tela
 *    mostrava só a data da assinatura; o acesso vale até a **mais distante**
 *    entre as duas.
 * 3. **"Pagamento pendente — atualize a forma de pagamento"** depois de um
 *    reembolso. O dinheiro foi devolvido; pedir para regularizar é cobrar de
 *    novo o que já voltou.
 */

export interface AccessSummary {
  /** Até quando o painel fica aberto, somando assinatura e concessão. */
  accessUntil: ISODateString | null;
  /** A data que vale vem da concessão, e não da assinatura. */
  fromGrant: boolean;
  /** A concessão em vigor é o teste do autocadastro. */
  isTrial: boolean;
  /** O ciclo foi devolvido: não é inadimplência. */
  refunded: boolean;
}

export function accessSummary(input: {
  subscription: Pick<PlatformSubscription, "accessUntil" | "status" | "refundedAt"> | null;
  grant: GrantForAccess | null;
  now: Date;
}): AccessSummary {
  const { subscription, grant } = input;
  const inForce = grant && isGrantInForce(grant, input.now.getTime()) ? grant : null;

  const datas = [subscription?.accessUntil ?? null, inForce?.until ?? null].filter(
    (data): data is ISODateString => Boolean(data),
  );
  const accessUntil = datas.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

  return {
    accessUntil,
    fromGrant: Boolean(inForce?.until && accessUntil === inForce.until && accessUntil !== subscription?.accessUntil),
    isTrial: inForce?.kind === "TRIAL",
    // `PAST_DUE` serve a duas situações opostas — quem não pagou e quem foi
    // reembolsado —, e é `refundedAt` que as separa.
    refunded: Boolean(subscription?.refundedAt) && subscription?.status === "PAST_DUE",
  };
}
