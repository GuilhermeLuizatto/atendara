"use client";

import { Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

export interface ModuleStat {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
}

const TONE_CLASSES = {
  default: "text-foreground",
  warning: "text-warning-soft-foreground",
  danger: "text-danger-soft-foreground",
  success: "text-success-soft-foreground",
} as const;

/**
 * Andaime das telas de modulo na Fase 0.
 *
 * Nao e uma tela vazia: os numeros vem do conjunto de dados real do workspace,
 * entao a pagina ja comprova que rota, sessao, terminologia e repositorio estao
 * ligados antes de o modulo existir.
 */
export function ModulePlaceholder({
  title,
  description,
  stats,
  upcoming,
  phase,
}: {
  title: string;
  description: string;
  stats: ModuleStat[] | null;
  upcoming: string[];
  phase: string;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={<Badge tone="neutral">{phase}</Badge>}
      />

      <section
        aria-label="Indicadores"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {stats
          ? stats.map((stat) => (
              <Card key={stat.label} className="p-4">
                <p className="text-muted-foreground text-xs font-medium">
                  {stat.label}
                </p>
                <p
                  className={cn(
                    "mt-1.5 text-2xl font-semibold tracking-tight tabular-nums",
                    TONE_CLASSES[stat.tone ?? "default"],
                  )}
                >
                  {stat.value}
                </p>
                {stat.hint ? (
                  <p className="text-subtle-foreground mt-1 text-xs">
                    {stat.hint}
                  </p>
                ) : null}
              </Card>
            ))
          : Array.from({ length: 4 }).map((_, index) => (
              <Card key={index} className="p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-7 w-16" />
                <Skeleton className="mt-2 h-3 w-20" />
              </Card>
            ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Nesta tela, na proxima fase</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2.5">
            {upcoming.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm">
                <Lock
                  className="text-subtle-foreground mt-0.5 size-3.5 shrink-0"
                  aria-hidden
                  strokeWidth={1.75}
                />
                <span className="text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
