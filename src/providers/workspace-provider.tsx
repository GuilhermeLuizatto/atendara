"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { ACCESS_RECHECK_INTERVAL_MS, accountPermissions, hasActiveAccess, isPlatformAdmin } from "@/config/access";
import {
  DEFAULT_PROFESSION,
  getProfession,
  isProfessionId,
} from "@/config/professions";
import {
  createPreferenceStore,
  hydrationStore,
} from "@/lib/storage/preference-store";
import { professionalScopeFor } from "@/lib/access/professional-scope";
import {
  createWorkspaceRepository,
  type WorkspaceLoadState,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from "@/services";
import type {
  ActiveSession,
  Organization,
  ProfessionConfig,
  ProfessionId,
  ProfessionTerminology,
  Role,
} from "@/types";

import { useNow } from "@/lib/utils/use-now";

import { useAuth } from "./auth-provider";
import {
  availableProfessionalContexts,
  resolveActiveProfessionalId,
  snapshotForProfessional,
} from "./professional-context";

const professionStore = createPreferenceStore<ProfessionId>(
  "atendo:profession",
  DEFAULT_PROFESSION,
  (raw) => (isProfessionId(raw) ? raw : null),
);

type ProfessionalContextPreferences = Record<string, string>;

const professionalContextStore = createPreferenceStore<ProfessionalContextPreferences>(
  "atendo:professional-context",
  {},
  (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return null;
    }
  },
  JSON.stringify,
);

interface WorkspaceContextValue {
  loading: boolean;
  /** Carregando, pronto ou indisponivel — ver `WorkspaceLoadState`. */
  loadState: WorkspaceLoadState;
  /** Descarta as leituras abertas e tenta carregar de novo. */
  retry: () => void;
  profession: ProfessionConfig;
  terminology: ProfessionTerminology;
  setProfession: (id: ProfessionId) => void;
  organization: Organization | null;
  session: ActiveSession | null;
  /** Fotografia operacional limitada à aba profissional ativa. */
  data: WorkspaceSnapshot | null;
  /** Fotografia autorizada completa, reservada aos fluxos administrativos. */
  organizationData: WorkspaceSnapshot | null;
  availableProfessionals: WorkspaceSnapshot["professionals"];
  activeProfessional: WorkspaceSnapshot["professionals"][number] | null;
  activeProfessionalId: string | null;
  setActiveProfessionalId: (id: string) => void;
  /** Camada de persistencia. Toda escrita passa por aqui. */
  repository: WorkspaceRepository | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const NOOP_SUBSCRIBE = () => () => {};
const NULL_SNAPSHOT = () => null;
const INITIAL_LOAD: WorkspaceLoadState = { status: "loading", slow: false };
const INITIAL_LOAD_SNAPSHOT = () => INITIAL_LOAD;

/**
 * Estado do espaco de trabalho.
 *
 * O provider nao guarda dados em `useState`: ele assina o repositorio via
 * `useSyncExternalStore`. O repositorio E a fonte da verdade, exatamente como
 * o Firestore sera — o que elimina a classe de bugs em que a tela e o backend
 * divergem porque alguem esqueceu de sincronizar.
 *
 * O repositorio so e criado depois da hidratacao: o conjunto de demonstracao e
 * ancorado em "hoje", e monta-lo durante o build estatico congelaria a agenda
 * na data do deploy.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const hydrated = useSyncExternalStore(
    hydrationStore.subscribe,
    hydrationStore.getSnapshot,
    hydrationStore.getServerSnapshot,
  );

  const preferredProfessionId = useSyncExternalStore(
    professionStore.subscribe,
    professionStore.getSnapshot,
    professionStore.getServerSnapshot,
  );

  const professionalContextPreferences = useSyncExternalStore(
    professionalContextStore.subscribe,
    professionalContextStore.getSnapshot,
    professionalContextStore.getServerSnapshot,
  );

  const platformAdmin = isPlatformAdmin(user?.access);
  const professionId = platformAdmin ? preferredProfessionId : user?.access?.professionId ?? DEFAULT_PROFESSION;
  const scope = user?.access?.organizationId ?? user?.userId;
  const userId = user?.userId ?? null;

  const organizationId = platformAdmin
    ? null
    : (user?.access?.organizationId ?? null);

  // S-13: o acesso vence pela hora, e nenhuma escrita avisa o navegador. No
  // emulador, uma leitura aberta antes do vencimento continuou recebendo dado
  // depois dele — as regras so barram quem abre uma leitura nova. Por isso a
  // validade entra aqui como valor reavaliado no relogio: ao vencer, o
  // repositorio vira `null`, o efeito abaixo chama `dispose` e os listeners do
  // Firestore fecham. Quem fecha o dado de verdade continuam sendo as regras,
  // na proxima leitura; isto encurta a janela de "ate reconectar" para segundos.
  const now = useNow(ACCESS_RECHECK_INTERVAL_MS);
  const accessOpen = hasActiveAccess(user?.access, now);

  const repository = useMemo(
    () =>
      hydrated && accessOpen
        ? createWorkspaceRepository({
            professionId,
            organizationId,
            userId,
            scope,
          })
        : null,
    // `user?.access` fica de proposito, mesmo sem ser lido aqui dentro: retirar
    // um modulo ou suspender a conta muda o que as regras permitem, e as leituras
    // abertas com a permissao antiga precisam fechar — o mesmo problema da S-13,
    // por outro caminho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, accessOpen, professionId, organizationId, userId, scope, user?.access],
  );

  // Trocar de conta, de organizacao ou de profissao cria um repositorio novo;
  // sem isso os listeners do Firestore do anterior seguiriam abertos e cobrando.
  useEffect(() => () => repository?.dispose?.(), [repository]);

  // Metodos de classe perdem `this` quando passados como referencia; os
  // wrappers abaixo preservam o vinculo e a identidade estavel que o
  // `useSyncExternalStore` exige.
  const subscribe = useMemo(
    () =>
      repository
        ? (listener: () => void) => repository.subscribe(() => listener())
        : NOOP_SUBSCRIBE,
    [repository],
  );

  const getSnapshot = useMemo(
    () => (repository ? () => repository.getSnapshot() : NULL_SNAPSHOT),
    [repository],
  );

  const organizationData = useSyncExternalStore(
    subscribe,
    getSnapshot,
    NULL_SNAPSHOT,
  );

  const subscribeLoad = useMemo(
    () =>
      repository
        ? (listener: () => void) => repository.subscribeLoadState(listener)
        : NOOP_SUBSCRIBE,
    [repository],
  );

  const getLoadState = useMemo(
    () => (repository ? () => repository.getLoadState() : INITIAL_LOAD_SNAPSHOT),
    [repository],
  );

  const loadState = useSyncExternalStore(
    subscribeLoad,
    getLoadState,
    INITIAL_LOAD_SNAPSHOT,
  );

  const retry = useCallback(() => repository?.retry(), [repository]);

  const setProfession = useCallback((id: ProfessionId) => {
    if (isPlatformAdmin(user?.access)) professionStore.set(id);
  }, [user?.access]);

  const profession = useMemo(() => getProfession(professionId), [professionId]);

  const access = useMemo(() => {
    if (!user || !organizationData) return null;
    const admin = isPlatformAdmin(user.access);
    // O papel autoritativo e o do vinculo em `members/{uid}`, o mesmo que as
    // rules conferem. A operadora abre so o conjunto demonstrativo, como OWNER.
    const role: Role = admin
      ? "OWNER"
      : (organizationData.membership?.role ?? "PROFESSIONAL");
    const isOrganizationHolder =
      !admin && organizationData.organization.ownerId === user.userId;
    const professionalScope = admin || repository?.mode === "memory"
      ? {
          organizationWide: true,
          professionalIds: organizationData.professionals.map((item) => item.id),
        }
      : professionalScopeFor(
          organizationData.membership ?? { role, linkedProfessionalIds: [] },
        );
    return { role, isOrganizationHolder, professionalScope };
  }, [user, organizationData, repository]);

  const availableProfessionals = useMemo(
    () =>
      organizationData && access
        ? availableProfessionalContexts(
            organizationData.professionals,
            access.professionalScope,
          )
        : [],
    [organizationData, access],
  );

  const professionalContextKey =
    user && organizationData
      ? `${user.userId}:${organizationData.organization.id}`
      : null;
  const activeProfessionalId = resolveActiveProfessionalId(
    professionalContextKey
      ? professionalContextPreferences[professionalContextKey]
      : null,
    availableProfessionals,
  );
  const activeProfessional =
    availableProfessionals.find((item) => item.id === activeProfessionalId) ?? null;

  const setActiveProfessionalId = useCallback(
    (id: string) => {
      if (
        !professionalContextKey ||
        !availableProfessionals.some((item) => item.id === id)
      ) {
        return;
      }
      professionalContextStore.set({
        ...professionalContextStore.read(),
        [professionalContextKey]: id,
      });
    },
    [professionalContextKey, availableProfessionals],
  );

  const data = useMemo(
    () =>
      organizationData
        ? snapshotForProfessional(organizationData, activeProfessionalId)
        : null,
    [organizationData, activeProfessionalId],
  );

  const session = useMemo<ActiveSession | null>(() => {
    if (!user || !organizationData || !access) return null;
    return {
      user,
      organizationId: organizationData.organization.id,
      role: access.role,
      isOrganizationHolder: access.isOrganizationHolder,
      permissions: accountPermissions(user.access, {
        role: access.role,
        isOrganizationHolder: access.isOrganizationHolder,
      }),
      professionalId: activeProfessionalId,
      linkedProfessionalIds: access.professionalScope.professionalIds,
      organizationWideProfessionalScope: access.professionalScope.organizationWide,
    };
  }, [user, organizationData, access, activeProfessionalId]);

  // Sincroniza o autor das escritas com a sessao. E um efeito de sistema
  // externo (nao ha `setState`), que e o uso legitimo de `useEffect`.
  useEffect(() => {
    repository?.setActor({
      userId: user?.userId ?? null,
      name: user?.displayName ?? "Sistema",
      role: session?.role ?? (isPlatformAdmin(user?.access) ? "OWNER" : "PROFESSIONAL"),
      permissions: session?.permissions ?? accountPermissions(user?.access),
      linkedProfessionalIds: session?.linkedProfessionalIds ?? [],
      organizationWideProfessionalScope:
        session?.organizationWideProfessionalScope ?? isPlatformAdmin(user?.access),
    });
  }, [repository, user, session]);

  const value = useMemo(
    () => ({
      loading: data === null,
      loadState,
      retry,
      profession,
      terminology: profession.terminology,
      setProfession,
      organization: organizationData?.organization ?? null,
      session,
      data,
      organizationData,
      availableProfessionals,
      activeProfessional,
      activeProfessionalId,
      setActiveProfessionalId,
      repository,
    }),
    [
      data,
      organizationData,
      loadState,
      retry,
      profession,
      setProfession,
      session,
      availableProfessionals,
      activeProfessional,
      activeProfessionalId,
      setActiveProfessionalId,
      repository,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error(
      "useWorkspace precisa estar dentro de <WorkspaceProvider>.",
    );
  }
  return context;
}

/** Atalho para a terminologia da profissao ativa. */
export function useTerminology(): ProfessionTerminology {
  return useWorkspace().terminology;
}
