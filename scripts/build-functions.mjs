import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { posix } from "node:path";
import ts from "typescript";

// O backend usa o mesmo contrato de caminhos, enums e politica do aplicativo.
// Transpilar em vez de duplicar e o que impede caminho, catalogo de planos,
// regra de acesso e travas dos avisos de divergirem entre o navegador e as
// functions.
const SOURCES = [
  ["src/lib/firebase/paths.ts", "paths"],
  ["src/lib/firebase/date-fields.ts", "date-fields"],
  ["src/types/access.ts", "access"],
  ["src/types/profession.ts", "profession"],
  ["src/config/billing.ts", "billing-config"],
  ["src/lib/billing/policy.ts", "billing-policy"],
  ["src/types/platform.ts", "platform-types"],
  ["src/config/platform.ts", "platform-config"],
  ["src/lib/platform/access-gate.ts", "access-gate"],
  ["src/types/privacy.ts", "privacy-types"],
  ["src/config/privacy.ts", "privacy-config"],
  ["src/lib/privacy/redaction.ts", "privacy-redaction"],

  // Fila de automacao (Fase 3, 13.2): o despachante confere as MESMAS travas
  // de `eligibility.ts` que a tela mostra.
  ["src/types/index.ts", "types"],
  ["src/types/ai.ts", "types-ai"],
  ["src/types/appointment.ts", "types-appointment"],
  ["src/types/audit.ts", "types-audit"],
  ["src/types/automation.ts", "types-automation"],
  ["src/types/billing.ts", "types-billing"],
  ["src/types/classification.ts", "types-classification"],
  ["src/types/client.ts", "types-client"],
  ["src/types/common.ts", "types-common"],
  ["src/types/conversation.ts", "types-conversation"],
  ["src/types/finance.ts", "types-finance"],
  ["src/types/notification.ts", "types-notification"],
  ["src/types/notifications.ts", "types-notifications"],
  ["src/types/organization.ts", "types-organization"],
  ["src/types/pagination.ts", "types-pagination"],
  ["src/types/professional.ts", "types-professional"],
  ["src/types/rules.ts", "types-rules"],
  ["src/config/app.ts", "app-config"],
  ["src/config/automation.ts", "automation-config"],
  ["src/config/notifications.ts", "notifications-config"],
  ["src/config/organization.ts", "organization-config"],
  ["src/config/professions/index.ts", "professions"],
  ["src/config/professions/definitions.ts", "profession-definitions"],
  ["src/lib/utils/format.ts", "format"],
  ["src/lib/notifications/consent-record.ts", "notifications-consent-record"],
  ["src/lib/notifications/contacts.ts", "notifications-contacts"],
  ["src/lib/notifications/delivery.ts", "notifications-delivery"],
  ["src/lib/notifications/eligibility.ts", "notifications-eligibility"],
  ["src/lib/notifications/planner.ts", "notifications-planner"],
  ["src/lib/notifications/schedule.ts", "notifications-schedule"],
  ["src/lib/notifications/templates.ts", "notifications-templates"],
  ["src/lib/notifications/providers/index.ts", "notifications-providers"],
  ["src/lib/notifications/providers/simulated.ts", "notifications-providers-simulated"],
  ["src/lib/notifications/providers/types.ts", "notifications-providers-types"],
  ["src/lib/automation/index.ts", "automation"],
  ["src/lib/automation/appointment-changes.ts", "automation-appointment-changes"],
  ["src/lib/automation/dispatch.ts", "automation-dispatch"],
  ["src/lib/automation/effects.ts", "automation-effects"],
  ["src/lib/automation/tasks.ts", "automation-tasks"],
];

const TARGETS = new Map(SOURCES);

// As functions nao tem o alias `@/`. Todo import de valor — por alias ou
// relativo — precisa apontar para um arquivo da lista acima; qualquer outro
// quebra o build de proposito, em vez de gerar um modulo que so falha em
// producao. Pacotes (`zod`, `firebase-admin`) ficam como estao.
function resolve(source, specifier) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const base = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : posix.join(posix.dirname(source), specifier);
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (TARGETS.has(candidate)) return `./${TARGETS.get(candidate)}.js`;
  }
  throw new Error(
    `${source} importa valor de "${specifier}", que nao tem equivalente gerado. Adicione a SOURCES ou use "import type".`,
  );
}

mkdirSync("functions/generated", { recursive: true });

for (const [source, target] of SOURCES) {
  const result = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });

  const code = result.outputText.replace(
    /from ["']([^"']+)["']/g,
    (match, specifier) => {
      const mapped = resolve(source, specifier);
      return mapped ? `from "${mapped}"` : match;
    },
  );

  writeFileSync(
    `functions/generated/${target}.js`,
    "// Gerado por scripts/build-functions.mjs.\n" + code,
  );
}
