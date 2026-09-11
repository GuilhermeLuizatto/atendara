import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCard } from "@/features/auth/auth-card";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = { title: "Criar nova senha" };

/**
 * Destino do link de recuperacao de senha. O codigo vem na URL, entao o
 * formulario le a query no cliente — e o `Suspense` e o que deixa o resto da
 * pagina sair pronto no export estatico.
 */
export default function ResetPasswordPage() {
  return (
    <AuthCard title="Criar nova senha">
      <Suspense
        fallback={
          <p role="status" className="text-muted-foreground mt-4 text-sm">
            Carregando...
          </p>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
