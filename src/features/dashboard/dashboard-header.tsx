"use client";

import Link from "next/link";
import { CalendarPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/config/app";
import { productHour } from "@/lib/utils/format";

function greetingFor(now: Date): string {
  const hour = productHour(now);
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

const fullDateFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: DEFAULT_TIMEZONE,
});

export function DashboardHeader({
  now,
  professionalName,
  appointmentLabel,
}: {
  now: Date;
  professionalName: string;
  appointmentLabel: string;
}) {
  const firstName = professionalName.split(" ")[0];
  const formattedDate = fullDateFormatter.format(now);

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          {greetingFor(now)}, {firstName}
        </h1>
        <p className="text-muted-foreground text-sm first-letter:uppercase">
          {formattedDate}
        </p>
      </div>

      <Link href="/agenda" className="shrink-0">
        <Button size="md">
          <CalendarPlus className="size-4" aria-hidden strokeWidth={1.75} />
          Novo {appointmentLabel.toLocaleLowerCase("pt-BR")}
        </Button>
      </Link>
    </header>
  );
}
