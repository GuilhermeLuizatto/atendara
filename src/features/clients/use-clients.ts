"use client";

import { useMemo, useState } from "react";

import { useWorkspace } from "@/providers/workspace-provider";
import type { Client, ClientStatus, ID } from "@/types";

export type ClientSort = "name" | "recent" | "next" | "balance";

export interface ClientFilters {
  search: string;
  status: ClientStatus | "ALL";
  professionalId: ID | "ALL";
  sort: ClientSort;
}

const INITIAL_FILTERS: ClientFilters = {
  search: "",
  status: "ALL",
  professionalId: "ALL",
  sort: "name",
};

/** Normaliza para busca: sem acento, sem caixa, sem pontuacao de telefone. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/**
 * Referencia estavel para o caso "ainda carregando".
 * `?? []` criaria um array novo a cada render e invalidaria os memos abaixo.
 */
const NO_CLIENTS: Client[] = [];

/**
 * Filtro, busca e ordenacao do CRM.
 *
 * Tudo acontece em memoria sobre a fotografia do tenant. Para a escala de um
 * consultorio isso e instantaneo e evita uma query por tecla digitada; quando
 * uma organizacao passar de alguns milhares de cadastros, a troca e mover este
 * filtro para uma query no Firestore — a interface nao muda.
 */
export function useClients() {
  const { data } = useWorkspace();
  const [filters, setFilters] = useState<ClientFilters>(INITIAL_FILTERS);

  const clients = data?.clients ?? NO_CLIENTS;

  const filtered = useMemo(() => {
    const term = normalize(filters.search.trim());
    const digits = filters.search.replace(/\D/g, "");

    const matches = clients.filter((client) => {
      if (filters.status !== "ALL" && client.status !== filters.status) {
        return false;
      }
      if (
        filters.professionalId !== "ALL" &&
        client.assignedProfessionalId !== filters.professionalId
      ) {
        return false;
      }
      if (!term) return true;

      return (
        normalize(client.fullName).includes(term) ||
        normalize(client.email ?? "").includes(term) ||
        (digits.length >= 3 && (client.phone ?? "").includes(digits))
      );
    });

    return sortClients(matches, filters.sort);
  }, [clients, filters]);

  const countsByStatus = useMemo(() => {
    const counts = new Map<ClientStatus | "ALL", number>([["ALL", clients.length]]);
    for (const client of clients) {
      counts.set(client.status, (counts.get(client.status) ?? 0) + 1);
    }
    return counts;
  }, [clients]);

  return {
    filters,
    setFilters,
    resetFilters: () => setFilters(INITIAL_FILTERS),
    clients: filtered,
    total: clients.length,
    countsByStatus,
    professionals: data?.professionals ?? [],
  };
}

function sortClients(clients: Client[], sort: ClientSort): Client[] {
  const sorted = [...clients];

  switch (sort) {
    case "name":
      return sorted.sort((a, b) => collator.compare(a.fullName, b.fullName));
    case "recent":
      // Sem atendimento anterior vai para o fim, nao para o topo.
      return sorted.sort((a, b) =>
        (b.lastAppointmentAt ?? "").localeCompare(a.lastAppointmentAt ?? ""),
      );
    case "next":
      return sorted.sort((a, b) => {
        if (!a.nextAppointmentAt) return 1;
        if (!b.nextAppointmentAt) return -1;
        return a.nextAppointmentAt.localeCompare(b.nextAppointmentAt);
      });
    case "balance":
      return sorted.sort(
        (a, b) => b.outstandingBalanceInCents - a.outstandingBalanceInCents,
      );
  }
}
