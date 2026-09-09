"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { APP_NAME, APP_TAGLINE } from "@/config/app";
import { AuthError } from "@/lib/auth";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/providers/auth-provider";

const FIELD_CLASSES = cn(
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm",
  "text-foreground placeholder:text-subtle-foreground",
  "transition-colors focus:border-primary",
);

export default function LoginPage() {
  const { status, mode, signIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace("/dashboard");
    } catch (caught) {
      setError(
        caught instanceof AuthError
          ? caught.message
          : "Nao foi possivel entrar. Tente novamente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-accent="violet"
      className="bg-background flex min-h-dvh items-center justify-center px-6 py-12"
    >
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5">
          <span className="bg-accent flex size-9 items-center justify-center rounded-lg text-white">
            <Sparkles className="size-4.5" aria-hidden strokeWidth={2} />
          </span>
          <div>
            <p className="text-foreground text-sm font-semibold">{APP_NAME}</p>
            <p className="text-muted-foreground text-xs">{APP_TAGLINE}</p>
          </div>
        </div>

        <h1 className="text-foreground mt-8 text-lg font-semibold tracking-tight">
          Entrar no painel
        </h1>

        {mode === "demo" ? (
          <p className="border-border bg-surface-muted text-muted-foreground mt-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed">
            Demonstracao local. Entre com um cadastro criado pelo administrador.
            As contas e os dados deste modo ficam apenas neste navegador.
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="text-foreground block text-xs font-medium"
            >
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@exemplo.com"
              className={FIELD_CLASSES}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="text-foreground block text-xs font-medium"
            >
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="******"
              className={FIELD_CLASSES}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="border-danger-soft bg-danger-soft text-danger-soft-foreground rounded-lg border px-3 py-2 text-xs"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full justify-center"
            disabled={submitting}
          >
            {submitting ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          <Link href="/" className="underline underline-offset-2">
            Voltar para a apresentacao
          </Link>
        </p>
      </div>
    </div>
  );
}
