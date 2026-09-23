import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";
import type { CalendarConnectionView } from "@/types/calendar";

async function call<T>(name: string, professionalId: string): Promise<T> {
  if (isDemoMode)
    throw new Error(
      "Conecte uma conta do Atendara para usar sua agenda Google.",
    );
  try {
    return (
      await httpsCallable<{ professionalId: string }, T>(
        getFirebaseFunctions(),
        name,
        { timeout: 60000 },
      )({ professionalId })
    ).data;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code === "functions/failed-precondition" ||
      code === "functions/unavailable" ||
      code === "functions/resource-exhausted"
    ) {
      throw new Error((error as Error).message);
    }
    if (
      code === "functions/permission-denied" ||
      code === "functions/unauthenticated"
    ) {
      throw new Error(
        "Confira seu acesso ao Atendara. Cada profissional conecta apenas a própria agenda.",
      );
    }
    throw new Error(
      "Não foi possível acessar a integração Google Calendar. Tente novamente em instantes.",
    );
  }
}

export const calendarService = {
  get: (professionalId: string) =>
    call<CalendarConnectionView>("getCalendarConnection", professionalId),
  connect: (professionalId: string) =>
    call<{ url: string }>("startCalendarConnection", professionalId),
  refresh: (professionalId: string) =>
    call<{ blocks: number }>("refreshCalendarBusy", professionalId),
  disconnect: (professionalId: string) =>
    call<{ status: "REVOKED"; revokedAtGoogle: boolean }>(
      "disconnectCalendar",
      professionalId,
    ),
};
