/**
 * Gerador pseudoaleatorio deterministico (mulberry32).
 *
 * Dados de demonstracao precisam ser estaveis: a mesma profissao gera sempre o
 * mesmo conjunto, entao trocar de profissao e voltar nao embaralha a tela, e o
 * que aparece num print e reproduzivel. `Math.random()` nao serve para isso.
 */

export function createSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state =
      typeof seed === "string" ? createSeed(seed) : Math.trunc(seed) >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inteiro em [min, max], inclusivo. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Amostra sem repeticao. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const picked: T[] = [];
    const total = Math.min(count, pool.length);
    for (let i = 0; i < total; i += 1) {
      picked.push(...pool.splice(Math.floor(this.next() * pool.length), 1));
    }
    return picked;
  }
}
