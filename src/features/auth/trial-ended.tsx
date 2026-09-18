"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, buttonStyles } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/auth-card";
import { AuthError } from "@/lib/auth";
import { trialState } from "@/lib/platform/trial";
import { deleteOwnOrganization, exportOrganization } from "@/services/privacy";
import { useNow } from "@/lib/utils/use-now";
import { useAuth } from "@/providers/auth-provider";

/**
 * Depois do 15o dia.
 *
 * O painel fechou — e a data em `accessUntil` que o fecha, nas Security Rules e
 * na interface. O que esta tela garante e que fechar nao vira perder: assinar,
 * levar os dados embora e encerrar continuam ao alcance, que e a diferenca
 * entre bloquear e apagar.
 */
export function TrialEnded() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const organizationId = user?.access?.organizationId ?? null;
  const now = useNow();
  const { daysUntilErasure } = trialState(user?.access, now.getTime());

  function fail(caught: unknown, fallback: string) {
    setError(caught instanceof AuthError ? caught.message : fallback);
  }

  async function baixar() {
    setError(null);
    setBusy("export");
    try {
      const data = await exportOrganization((section, lidos) =>
        setProgress(`Lendo ${section}: ${lidos} registros...`),
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `atendara-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setProgress("Arquivo salvo.");
    } catch (caught) {
      setProgress(null);
      fail(caught, "Não foi possível exportar agora. Tente de novo em instantes.");
    } finally {
      setBusy(null);
    }
  }

  async function apagar() {
    if (!organizationId) return;
    setError(null);
    setBusy("delete");
    try {
      await deleteOwnOrganization(organizationId);
      await signOut();
    } catch (caught) {
      fail(caught, "Não foi possível excluir agora. Se persistir, fale com o suporte.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthCard title="Seu teste terminou">
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        O painel fechou, mas <strong className="text-foreground">nada foi apagado</strong>. Assine
        para voltar de onde parou.
      </p>
      {daysUntilErasure !== null ? (
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          {daysUntilErasure > 0
            ? `Seus dados ficam guardados por mais ${daysUntilErasure} ${daysUntilErasure === 1 ? "dia" : "dias"}. Depois disso, eles deixam de identificar alguém e não há como voltar atrás.`
            : "O prazo de guarda terminou. Seus dados estão sendo despersonalizados."}
        </p>
      ) : null}

      <div className="mt-6 space-y-3">
        {error ? (
          <p role="alert" className="border-danger-soft bg-danger-soft text-danger-soft-foreground rounded-lg border px-3 py-2 text-xs">
            {error}
          </p>
        ) : null}
        {progress ? (
          <p role="status" className="bg-surface-muted text-muted-foreground rounded-lg px-3 py-2 text-xs leading-relaxed">
            {progress}
          </p>
        ) : null}

        <Link href="/assinatura" className={buttonStyles({ size: "lg", className: "w-full justify-center" })}>
          Assinar e voltar ao painel
        </Link>
        <Button
          variant="outline"
          size="lg"
          className="w-full justify-center"
          onClick={() => void baixar()}
          disabled={busy !== null}
        >
          {busy === "export" ? "Exportando..." : "Baixar meus dados"}
        </Button>

        {confirming ? (
          <div className="border-danger-soft bg-danger-soft text-danger-soft-foreground space-y-3 rounded-lg border px-3 py-3 text-xs leading-relaxed">
            <p>
              Apagar encerra a organização e o que há nela. Não dá para desfazer, e quem
              você atende também perde o histórico. Baixe seus dados antes, se ainda não baixou.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" size="sm" onClick={() => void apagar()} disabled={busy !== null}>
                {busy === "delete" ? "Apagando..." : "Apagar tudo, sem volta"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="lg"
            className="w-full justify-center"
            onClick={() => setConfirming(true)}
            disabled={busy !== null || !organizationId}
          >
            Apagar minha conta e meus dados
          </Button>
        )}

        <Button variant="ghost" size="lg" className="w-full justify-center" onClick={() => void signOut()}>
          Sair
        </Button>
      </div>
    </AuthCard>
  );
}
