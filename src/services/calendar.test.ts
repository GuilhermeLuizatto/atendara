import { describe, expect, it } from "vitest";

import { readableCalendarError } from "./calendar";

describe("mensagem da integração Google Calendar", () => {
  it("remove somente o status HTTP acrescentado pelo SDK no fim", () => {
    expect(
      readableCalendarError(
        new Error(
          "A autorização Google expirou ou foi revogada. Conecte sua agenda novamente. [503]",
        ),
      ),
    ).toBe(
      "A autorização Google expirou ou foi revogada. Conecte sua agenda novamente.",
    );
    expect(readableCalendarError(new Error("Falha [503] no provedor"))).toBe(
      "Falha [503] no provedor",
    );
    expect(readableCalendarError("indisponível")).toBe("");
  });
});
