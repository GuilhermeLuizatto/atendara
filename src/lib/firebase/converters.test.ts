import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import { fromFirestoreData, toFirestoreData, toISO } from "./converters";

/**
 * A conversao acontece so aqui. Se este arquivo estiver certo, nenhum tipo do
 * dominio precisa conhecer `Timestamp` — e nenhuma data chega a interface como
 * objeto do SDK.
 */

const ISO = "2026-09-09T15:00:00.000Z";

describe("conversao entre dominio e Firestore", () => {
  it("grava data conhecida como Timestamp e devolve ISO na leitura", () => {
    const written = toFirestoreData("appointments", {
      startsAt: ISO,
      administrativeNotes: null,
    });

    expect(written.startsAt).toBeInstanceOf(Timestamp);

    const read = fromFirestoreData<{ startsAt: string }>(
      "appointments",
      "appt-1",
      written,
    );
    expect(read.startsAt).toBe(ISO);
  });

  it("nao converte campo que nao esta declarado como data", () => {
    const written = toFirestoreData("clients", { administrativeNotes: ISO });
    expect(written.administrativeNotes).toBe(ISO);
  });

  it("preserva null e remove undefined, que o Firestore recusa", () => {
    const written = toFirestoreData("clients", {
      lastAppointmentAt: null,
      email: null,
      phone: undefined,
    });

    expect(written.lastAppointmentAt).toBeNull();
    expect(written.email).toBeNull();
    expect("phone" in written).toBe(false);
  });

  it("o id vem do caminho, nunca do corpo do documento", () => {
    const read = fromFirestoreData<{ id: string }>("clients", "real", {
      id: "forjado",
      fullName: "Cliente",
    });

    expect(read.id).toBe("real");
  });

  it("dinheiro em centavos atravessa sem virar ponto flutuante", () => {
    const written = toFirestoreData("transactions", { amountInCents: 18000 });
    expect(written.amountInCents).toBe(18000);
    expect(Number.isInteger(written.amountInCents)).toBe(true);
  });

  it("valor desconhecido nao vira data invalida", () => {
    expect(toISO(undefined)).toBeNull();
    expect(toISO(42)).toBeNull();
    expect(toISO(Timestamp.fromDate(new Date(ISO)))).toBe(ISO);
  });
});
