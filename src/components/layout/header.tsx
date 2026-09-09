"use client";

import { Menu } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";

import { NotificationsMenu } from "./notifications-menu";
import { ProfessionSwitcher } from "./profession-switcher";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { mode } = useAuth();
  const { repository } = useWorkspace();
  const demonstrative = repository?.mode !== "firestore";

  return (
    <header
      className={cn(
        "border-border sticky top-0 z-40 flex h-14 items-center gap-2 border-b",
        "bg-surface/85 px-3 backdrop-blur-sm sm:px-5",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMenu}
        aria-label="Abrir menu de navegacao"
      >
        <Menu className="size-5" aria-hidden strokeWidth={1.75} />
      </Button>

      {/* Enquanto os dados nao vierem do Firestore, o aviso precisa estar
          visivel: e o que impede alguem de confundir a demonstracao com
          prontuario e cadastrar gente de verdade. */}
      {demonstrative ? (
        <Badge tone="warning" className="hidden sm:inline-flex">
          {mode === "demo" ? "Modo demonstracao" : "Dados demonstrativos locais"}
        </Badge>
      ) : null}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <ProfessionSwitcher />
        <NotificationsMenu />
        <ThemeToggle />
        <div className="border-border ml-1 border-l pl-1 sm:pl-2">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
