import { describe, expect, it } from "vitest";
import { isWorkingDay, workingScheduleWarning } from "./working-hours";

// Segunda a sexta, 08:00–18:00. 26/09/2026 é sábado; 28/09, segunda.
const agenda = { workingDays: [1, 2, 3, 4, 5], workdayStart: "08:00", workdayEnd: "18:00" };

describe("expediente da agenda", () => {
  it("reconhece sábado e domingo fora dos dias de atendimento", () => {
    expect(isWorkingDay(agenda, "2026-09-26")).toBe(false);
    expect(isWorkingDay(agenda, "2026-09-27")).toBe(false);
    expect(isWorkingDay(agenda, "2026-09-28")).toBe(true);
  });

  it("avisa dia sem atendimento antes de olhar o horário", () => {
    expect(workingScheduleWarning(agenda, "2026-09-26", "10:00", 50)).toBe("OFF_DAY");
  });

  it("avisa atendimento que começa antes ou termina depois do expediente", () => {
    expect(workingScheduleWarning(agenda, "2026-09-28", "07:30", 50)).toBe("OUTSIDE_HOURS");
    expect(workingScheduleWarning(agenda, "2026-09-28", "17:30", 50)).toBe("OUTSIDE_HOURS");
  });

  it("não avisa quando cabe inteiro no expediente", () => {
    expect(workingScheduleWarning(agenda, "2026-09-28", "08:00", 50)).toBeNull();
    expect(workingScheduleWarning(agenda, "2026-09-28", "17:10", 50)).toBeNull();
  });
});
