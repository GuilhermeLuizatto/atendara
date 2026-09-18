"use client";

import Link from "next/link";
import { Clock } from "lucide-react";

import { buttonStyles } from "@/components/ui/button";
import { trialState } from "@/lib/platform/trial";
import { useAuth } from "@/providers/auth-provider";
import { useNow } from "@/lib/utils/use-now";

/**
 * Aviso de que o teste esta acabando, dentro do painel.
 *
 * Aviso de PLATAFORMA: fica aqui e nunca sai pelo canal da clinica (regra 12).
 * Enquanto nao houver remetente proprio de e-mail, este e o unico aviso que
 * podemos dar com honestidade — a pessoa le quando abre o painel.
 *
 * Aparece so nos ultimos dias. Um contador permanente desde o primeiro dia
 * viraria paisagem, e ninguem leria justamente no dia em que importa.
 */
export function TrialNotice() {
  const { user } = useAuth();
  const now = useNow();
  const state = trialState(user?.access, now.getTime());

  if (state.phase !== "ENDING") return null;

  return (
    <div
      role="status"
      className="bg-warning-soft text-warning-soft-foreground mb-5 flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm"
    >
      <Clock className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {state.daysLeft === 1
          ? "Seu teste termina amanhã."
          : `Seu teste termina em ${state.daysLeft} dias.`}{" "}
        Depois disso o painel fecha, e seus dados continuam guardados enquanto você decide.
      </p>
      <Link href="/assinatura" className={buttonStyles({ variant: "outline", size: "sm" })}>
        Ver minha assinatura
      </Link>
    </div>
  );
}
