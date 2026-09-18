"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { hasActiveAccess, canAccessModule, canManageSubscription, isPlatformAdmin } from "@/config/access";
import { APP_MODULES, type AppModule } from "@/types/access";
import { EmailConfirmation } from "@/features/auth/email-confirmation";
import { PasswordSetup } from "@/features/auth/password-setup";
import { TrialEnded } from "@/features/auth/trial-ended";
import { trialState } from "@/lib/platform/trial";
import { Button } from "@/components/ui/button";

import { useNow } from "@/lib/utils/use-now";
import { useAuth } from "@/providers/auth-provider";

/**
 * Guarda de rota do cliente.
 *
 * Com export estatico nao existe middleware, entao o redirecionamento acontece
 * aqui. Isso e suficiente porque a barreira real nao e a navegacao: dado nenhum
 * chega ao navegador sem as Firestore Security Rules autorizarem. Esconder a
 * tela e conveniencia; negar o dado e seguranca.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Releitura periodica: o acesso vence pela HORA, e sem o tique a tela
  // continuaria aberta ate a proxima navegacao.
  const now = useNow(15_000);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center">
        <p role="status" className="text-muted-foreground text-sm">Carregando...</p>
      </div>
    );
  }

  if (user?.access?.mustChangePassword) return <PasswordSetup />;
  // Cadastro aberto que ainda nao teve teste nenhum: a conta existe, e o que
  // falta e a confirmacao do e-mail. Depois do 15o dia `accessUntil` existe e
  // esta vencido — ai o caminho e outro, e nao este.
  if (user?.access?.origin === "SELF_SERVICE" && !user.access.accessUntil) return <EmailConfirmation />;
  // Teste vencido: o painel ja esta fechado pela data. Esta tela existe para
  // fechar nao virar perder — assinar, exportar e apagar continuam aqui.
  // "assinatura" passa direto: e para onde ela manda.
  if (trialState(user?.access, now.getTime()).phase === "BLOCKED" && pathname.split("/")[1] !== "assinatura") {
    return <TrialEnded />;
  }
  const area = pathname.split("/")[1];
  // "Minha assinatura" e a unica area que NAO exige acesso vigente: quem esta
  // com a mensalidade vencida precisa chegar ate ela para regularizar. As
  // Security Rules e a callable continuam decidindo o que ela consegue ler e
  // pedir; esconder a rota seria conveniencia, liberar o dado seria erro.
  const allowed = area === "assinatura"
    ? canManageSubscription(user?.access)
    : hasActiveAccess(user?.access) && (area === "admin" ? isPlatformAdmin(user?.access) : APP_MODULES.includes(area as AppModule) && canAccessModule(user?.access, area as AppModule));
  if (!allowed) return <main className="bg-background flex min-h-dvh items-center justify-center p-6"><div className="max-w-md space-y-4">
    <h1 className="text-foreground text-xl font-semibold">Acesso não liberado</h1>
    <p className="text-muted-foreground text-sm">Seu cadastro precisa estar ativo, com mensalidade vigente e permissão para esta área. Consulte o administrador.</p>
    {hasActiveAccess(user?.access) ? <Button onClick={() => router.replace(`/${user?.access?.modules[0] ?? "dashboard"}` as "/dashboard")}>Abrir meu painel</Button> : null}
    <Button variant="outline" onClick={() => void signOut()}>Sair</Button>
  </div></main>;
  return <>{children}</>;
}

