import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { adcFileName, installCleanup, removeLeftovers } from "./adc-credential.js";

/**
 * O que estes testes protegem: a credencial temporaria dos scripts de console
 * carrega um token de atualizacao. Se ela sobreviver ao fim do processo, fica
 * um segredo de longa duracao no disco.
 */

function directoryWith(names) {
  const directory = mkdtempSync(join(tmpdir(), "adc-"));
  for (const name of names) writeFileSync(join(directory, name), "{}");
  return directory;
}

describe("sobra de credencial", () => {
  it("apaga credencial de execucao anterior e nao toca no resto", () => {
    const directory = directoryWith([
      adcFileName(4242),
      adcFileName(99),
      "firebase-admin-initial-access.txt",
      "config.json",
    ]);

    const removed = removeLeftovers(directory);

    expect(removed.sort()).toEqual([adcFileName(4242), adcFileName(99)].sort());
    expect(readdirSync(directory).sort()).toEqual(
      ["config.json", "firebase-admin-initial-access.txt"].sort(),
    );
  });

  it("nao quebra quando a pasta nao existe nem quando o arquivo esta preso", () => {
    expect(removeLeftovers(join(tmpdir(), "pasta-que-nao-existe-adc"))).toEqual([]);

    const preso = () => {
      throw new Error("EBUSY");
    };
    expect(
      removeLeftovers(directoryWith([adcFileName(7)]), { unlink: preso }),
    ).toEqual([]);
  });
});

describe("limpeza ao terminar", () => {
  it("apaga no fim normal e em cada sinal de interrupcao", () => {
    const handlers = new Map();
    const unlink = vi.fn();
    const exit = vi.fn();

    installCleanup("/tmp/credencial.json", {
      on: (event, handler) => handlers.set(event, handler),
      unlink,
      exit,
    });

    expect([...handlers.keys()]).toEqual([
      "exit",
      "SIGINT",
      "SIGTERM",
      "SIGHUP",
      "SIGBREAK",
    ]);

    handlers.get("exit")();
    expect(unlink).toHaveBeenCalledWith("/tmp/credencial.json");

    handlers.get("SIGINT")();
    expect(exit).toHaveBeenCalledWith(130);

    handlers.get("SIGTERM")();
    expect(exit).toHaveBeenCalledWith(143);
    expect(unlink).toHaveBeenCalledTimes(3);
  });

  it("engole erro de arquivo ja apagado: o processo nao pode morrer na limpeza", () => {
    const remove = installCleanup("/tmp/sumiu.json", {
      on: () => {},
      unlink: () => {
        throw new Error("ENOENT");
      },
    });

    expect(() => remove()).not.toThrow();
  });
});
