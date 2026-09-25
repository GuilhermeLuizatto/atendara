import { describe, expect, it } from "vitest";

import { importDuplicateKey, isImportDuplicate } from "./administrative-import-policy.js";

describe("duplicidades da importação administrativa", () => {
  it("normaliza o e-mail de profissionais", () => {
    expect(importDuplicateKey("PROFESSIONALS", { email: " Teste@Exemplo.com " }))
      .toBe(importDuplicateKey("PROFESSIONALS", { email: "teste@exemplo.com" }));
  });

  it("usa e-mail e telefone disponíveis para clientes", () => {
    expect(importDuplicateKey("CLIENTS", { email: "a@b.com", phone: null })).toBe("email:a@b.com|");
    expect(importDuplicateKey("CLIENTS", { email: null, phone: "11 99999-0000" })).toBe("|phone:11 99999-0000");
  });

  it("considera cliente duplicado quando e-mail ou telefone coincide", () => {
    expect(isImportDuplicate("CLIENTS", { email: "a@b.com", phone: "1" }, { email: "a@b.com", phone: "2" })).toBe(true);
    expect(isImportDuplicate("CLIENTS", { email: "a@b.com", phone: "1" }, { email: "c@d.com", phone: "1" })).toBe(true);
    expect(isImportDuplicate("CLIENTS", { email: "a@b.com", phone: "1" }, { email: "c@d.com", phone: "2" })).toBe(false);
  });

  it("inclui o fim calculado na chave de atendimento", () => {
    expect(importDuplicateKey("APPOINTMENTS", {
      clientId: "cliente", professionalId: "profissional",
      startsAt: "2026-09-25T12:00:00.000Z", durationMinutes: 60,
    })).toBe("cliente|profissional|2026-09-25T12:00:00.000Z|2026-09-25T13:00:00.000Z");
  });

  it("usa os cinco campos definidos para o financeiro", () => {
    expect(importDuplicateKey("TRANSACTIONS", {
      type: "INCOME", dueDate: "2026-09-25T12:00:00.000Z", amountInCents: 1234,
      clientId: "cliente", description: " Consulta ",
    })).toBe("INCOME|2026-09-25T12:00:00.000Z|1234|cliente|consulta");
  });
});
