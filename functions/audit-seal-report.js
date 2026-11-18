import { verifyAuditSealChain } from "./audit-seal-chain.js";

/**
 * Conferencia da trilha selada: a parte que so calcula.
 *
 * O gatilho (`audit-seal.js`) sela; isto confere depois, com o que foi lido do
 * banco. A leitura mora em `verify-audit-seals.js`, que e o script de console —
 * aqui nao ha I/O, para que o relatorio possa ser testado inteiro.
 *
 * **Nenhum dado pessoal entra no relatorio.** O selo nao guarda nenhum, e da
 * entrada o relatorio usa somente o id, o indice e o tipo de problema. Resumo,
 * nome de quem agiu e id do recurso ficam de fora de proposito: a trilha e
 * conferida pela corrente, nao pelo conteudo, e um relatorio gravado em disco
 * nao precisa carregar nome de paciente.
 */

/** Projetos onde este script pode rodar, e com que nome. */
const PRODUCTION_PROJECT = "atendo-a3481";

export function parseVerifyArguments(args, env = process.env) {
  const option = (name) => {
    const at = args.indexOf(name);
    const value = at >= 0 ? args[at + 1] : null;
    return value && !value.startsWith("--") ? value : null;
  };
  const projectId = args[0];
  const emulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (emulator ? !projectId?.startsWith("demo-") : projectId !== PRODUCTION_PROJECT) {
    throw new Error(
      emulator
        ? "Contra o emulador use um projeto demo-*."
        : `Informe explicitamente o projeto ${PRODUCTION_PROJECT}.`,
    );
  }
  const organizationId = option("--organizacao");
  const sealedFrom = option("--selado-desde");
  if (sealedFrom && Number.isNaN(Date.parse(sealedFrom))) {
    throw new Error("--selado-desde pede uma data ISO, como 2026-11-17T00:00:00.000Z.");
  }
  return { projectId, emulator, organizationId, sealedFrom };
}

/**
 * De quando em diante a trilha e selada, quando ninguem informou.
 *
 * O selo nasceu num dia; entrada escrita antes dele nao tem selo e isso nao e
 * defeito. Sem este limite, a primeira conferencia de uma organizacao antiga
 * acusaria "selo faltando" em toda a trilha anterior — ruido que esconderia o
 * que importa. O limite e o horario do PRIMEIRO selo da organizacao, que e o
 * momento em que o gatilho entrou no ar para ela.
 */
export function boundaryOf(seals, informed = null) {
  if (informed) return informed;
  const first = seals.find((seal) => seal.index === 1) ?? null;
  return first?.writtenAt ?? null;
}

/** Quantos problemas de cada tipo, para o resumo de uma linha por organizacao. */
export function countByKind(problems) {
  const counts = {};
  for (const problem of problems) counts[problem.kind] = (counts[problem.kind] ?? 0) + 1;
  return counts;
}

/** Conferencia de uma organizacao. `seals` e `entries` vem do banco. */
export function verifyOrganization({ organizationId, seals, entries, sealedFrom = null }) {
  const boundary = boundaryOf(seals, sealedFrom);
  const result = verifyAuditSealChain({ seals, entries, sealedFrom: boundary });
  return {
    organizationId,
    sealedFrom: boundary,
    seals: seals.length,
    entries: entries.length,
    sealed: result.sealed,
    outsideChain: result.outsideChain,
    ok: result.ok,
    counts: countByKind(result.problems),
    // Id, indice e tipo. Nunca `summary`, `actorName` ou `resource.id`.
    problems: result.problems.map((problem) => ({
      kind: problem.kind,
      logId: problem.logId ?? null,
      index: problem.index ?? null,
      expected: problem.expected ?? null,
    })),
  };
}

/** O relatorio inteiro, pronto para gravar e para a saida no terminal. */
export function buildReport({ projectId, runId, at, organizations }) {
  const broken = organizations.filter((organization) => !organization.ok);
  return {
    report: {
      tool: "atendara.conferencia-do-selo",
      version: 1,
      projectId,
      runId,
      generatedAt: at,
      organizations,
      summary: {
        organizations: organizations.length,
        withProblems: broken.length,
        seals: organizations.reduce((total, organization) => total + organization.seals, 0),
        entries: organizations.reduce((total, organization) => total + organization.entries, 0),
      },
    },
    // Problema na trilha nao pode terminar em sucesso: quem rodar isto dentro
    // de outra conferencia precisa ver a falha sem ler o relatorio.
    exitCode: broken.length > 0 ? 1 : 0,
  };
}

/** Uma linha por organizacao, na ordem em que foram conferidas. */
export function formatLines(report) {
  const lines = report.organizations.map((organization) => {
    const head = `${organization.organizationId}: ${organization.seals} selo(s), ${organization.entries} entrada(s)`;
    if (organization.ok) {
      const outside = organization.outsideChain > 0 ? `, ${organization.outsideChain} antes do selo` : "";
      return `${head}${outside} — corrente íntegra`;
    }
    const kinds = Object.entries(organization.counts)
      .map(([kind, total]) => `${kind}=${total}`)
      .join(" ");
    return `${head} — PROBLEMA: ${kinds}`;
  });
  const { organizations, withProblems } = report.summary;
  lines.push(
    withProblems > 0
      ? `${withProblems} de ${organizations} organização(ões) com problema na trilha.`
      : `${organizations} organização(ões) conferida(s), nenhuma divergência.`,
  );
  return lines;
}
