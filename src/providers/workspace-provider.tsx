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

import { accountPermissions, hasActiveAccess, isPlatformAdmin } from "@/config/access";
import {
  DEFAULT_PROFESSION,
  getProfession,
  isProfessionId,
} from "@/config/professions";
import {
  createPreferenceStore,
  hydrationStore,
} from "@/lib/storage/preference-store";
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

import { useAuth } from "./auth-provider";

const professionStore = createPreferenceStore<ProfessionId>(
  "atendo:profession",
  DEFAULT_PROFESSION,
  (raw) => (isProfessionId(raw) ? raw : null),
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
  data: WorkspaceSnapshot | null;
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

  const platformAdmin = isPlatformAdmin(user?.access);
  const professionId = platformAdmin ? preferredProfessionId : user?.access?.professionId ?? DEFAULT_PROFESSION;
  const scope = user?.access?.organizationId ?? user?.userId;
  const userId = user?.userId ?? null;

  const organizationId = platformAdmin
    ? null
    : (user?.access?.organizationId ?? null);

  const repository = useMemo(
    () =>
      hydrated && hasActiveAccess(user?.access)
        ? createWorkspaceRepository({
            professionId,
            organizationId,
            userId,
            scope,
          })
        : null,
    [hydrated, professionId, organizationId, userId, scope, user?.access],
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

  const data = useSyncExternalStore(subscribe, getSnapshot, NULL_SNAPSHOT);

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

  const session = useMemo<ActiveSession | null>(() => {
    if (!user || !data) return null;
    const admin = isPlatformAdmin(user.access);
    // O papel autoritativo e o do vinculo em `members/{uid}`, o mesmo que as
    // rules conferem. A operadora abre so o conjunto demonstrativo, como OWNER.
    const role: Role = admin ? "OWNER" : (data.membership?.role ?? "PROFESSIONAL");
    const isOrganizationHolder = !admin && data.organization.ownerId === user.userId;
    return {
      user,
      organizationId: data.organization.id,
      role,
      isOrganizationHolder,
      permissions: accountPermissions(user.access, { role, isOrganizationHolder }),
      // Em uma clinica ha varios perfis na organizacao; o do usuario e o que
      // carrega o proprio uid. O primeiro da lista so serve de retomada para a
      // demonstracao, onde o titular e o unico profissional.
      professionalId:
        data.professionals.find(
          (professional) => professional.userId === user.userId,
        )?.id ??
        data.professionals[0]?.id ??
        null,
    };
  }, [user, data]);

  // Sincroniza o autor das escritas com a sessao. E um efeito de sistema
  // externo (nao ha `setState`), que e o uso legitimo de `useEffect`.
  useEffect(() => {
    repository?.setActor({
      userId: user?.userId ?? null,
      name: user?.displayName ?? "Sistema",
      role: session?.role ?? (isPlatformAdmin(user?.access) ? "OWNER" : "PROFESSIONAL"),
      permissions: session?.permissions ?? accountPermissions(user?.access),
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
      organization: data?.organization ?? null,
      session,
      data,
      repository,
    }),
    [data, loadState, retry, profession, setProfession, session, repository],
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
