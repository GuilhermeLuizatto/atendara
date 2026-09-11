"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { hasActiveAccess, canAccessModule, canManageSubscription, isPlatformAdmin } from "@/config/access";
import { APP_MODULES, type AppModule } from "@/types/access";
import { PasswordSetup } from "@/features/auth/password-setup";
import { Button } from "@/components/ui/button";

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
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 15000);
    return () => clearInterval(timer);
  }, []);

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
  const area = pathname.split("/")[1];
  // "Minha assinatura" e a unica area que NAO exige acesso vigente: quem esta
  // com a mensalidade vencida precisa chegar ate ela para regularizar. As
  // Security Rules e a callable continuam decidindo o que ela consegue ler e
  // pedir; esconder a rota seria conveniencia, liberar o dado seria erro.
  const allowed = area === "assinatura"
    ? canManageSubscription(user?.access)
    : hasActiveAccess(user?.access) && (area === "admin" ? isPlatformAdmin(user?.access) : APP_MODULES.includes(area as AppModule) && canAccessModule(user?.access, area as AppModule));
  if (!allowed) return <main className="bg-background flex min-h-dvh items-center justify-center p-6"><div className="max-w-md space-y-4">
    <h1 className="text-foreground text-xl font-semibold">Acesso nao liberado</h1>
    <p className="text-muted-foreground text-sm">Seu cadastro precisa estar ativo, com mensalidade vigente e permissao para esta area. Consulte o administrador.</p>
    {hasActiveAccess(user?.access) ? <Button onClick={() => router.replace(`/${user?.access?.modules[0] ?? "dashboard"}` as "/dashboard")}>Abrir meu painel</Button> : null}
    <Button variant="outline" onClick={() => void signOut()}>Sair</Button>
  </div></main>;
  return <>{children}</>;
}

