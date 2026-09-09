import { afterEach, expect, it, vi } from "vitest";
import { buildMockDataset } from "@/mocks";
import { createStateWriter, loadState } from "./persistence";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("salva a ultima alteracao quando a pagina fecha antes do debounce", () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  const stored = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    localStorage: {
      getItem: (key: string) => stored.get(key),
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  const writer = createStateWriter("PSYCHOLOGIST");
  const snapshot = buildMockDataset(
    "PSYCHOLOGIST",
    new Date("2026-09-09T15:00:00Z"),
  );
  writer.schedule({ dateKey: "2026-09-09", sequence: 1, snapshot });
  writer.schedule({ dateKey: "2026-09-09", sequence: 2, snapshot });
  expect(loadState("PSYCHOLOGIST", "2026-09-09")).toBeNull();
  events.dispatchEvent(new Event("pagehide"));
  expect(loadState("PSYCHOLOGIST", "2026-09-09")?.sequence).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});
