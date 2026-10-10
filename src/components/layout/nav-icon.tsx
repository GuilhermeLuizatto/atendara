import {
  Bot,
  CalendarDays,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Headphones,
  Upload,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { NavIconName } from "@/config/navigation";

/**
 * Unico ponto que liga os nomes de icone da configuracao aos componentes da
 * biblioteca. Trocar de biblioteca de icones muda so este arquivo.
 */
const ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  users: Users,
  messages: MessageSquare,
  leads: UserPlus,
  finance: Wallet,
  agent: Bot,
  upload: Upload,
  support: Headphones,
  settings: Settings,
};

export function NavIcon({
  name,
  className,
}: {
  name: NavIconName;
  className?: string;
}) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden strokeWidth={1.75} />;
}
