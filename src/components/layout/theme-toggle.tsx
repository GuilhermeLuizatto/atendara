"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/providers/theme-provider";

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const nextLabel = resolved === "dark" ? "claro" : "escuro";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Mudar para o tema ${nextLabel}`}
      title={`Tema ${nextLabel}`}
    >
      {resolved === "dark" ? (
        <Moon className="size-4" aria-hidden strokeWidth={1.75} />
      ) : (
        <Sun className="size-4" aria-hidden strokeWidth={1.75} />
      )}
    </Button>
  );
}
