import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { launcherApi, listenToLauncherEvents } from "../lib/api";
import { safeMessage } from "../lib/utils";
import { useLauncherUpdater } from "./useLauncherUpdater";
import type {
  AccountSummary,
  BootstrapPayload,
  ConsoleLine,
  GameStatus,
  InstanceProfile,
  LauncherSettings,
  ProgressEvent,
} from "../lib/types";

const MAX_CONSOLE_LINES = 600;
export type AuthenticationState =
  | "checking"
  | "authenticated"
  | "unauthenticated";

const canonicalAccountId = (value: string): string =>
  value.replaceAll("-", "").trim().toLowerCase();

export const isAuthenticationReconnectError = (value: unknown): boolean => {
  const message = safeMessage(value).toLowerCase();
  return (
    message.includes("reauthentication is required") ||
    message.includes("session expired") ||
    message.includes("sign in again") ||
    message.includes("no saved account credential") ||
    message.includes("minecraft rejected the current access token")
  );
};

const reconnectMessage = "Continue with Microsoft to reconnect.";

function reconcileAccounts(
  accounts: AccountSummary[],
  preferred?: AccountSummary,
): AccountSummary[] {
  if (!preferred) return accounts;
  const preferredId = canonicalAccountId(preferred.id);
  const index = accounts.findIndex(
    (account) => canonicalAccountId(account.id) === preferredId,
  );
  if (index < 0) {
    return [
      ...accounts.map((account) => ({ ...account, active: false })),
      { ...preferred, active: true },
    ];
  }
  return accounts.map((account, accountIndex) => ({
    ...(accountIndex === index ? { ...account, ...preferred } : account),
    active: accountIndex === index,
  }));
}

export function useLauncher() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthenticationState>("checking");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [status, setStatus] = useState<GameStatus>({ state: "idle" });
  const [launchConsoleVisible, setLaunchConsoleVisible] = useState(false);
  const bootstrapRef = useRef<BootstrapPayload | null>(null);
  const signInInFlightRef = useRef<Promise<AccountSummary> | null>(null);
  const updater = useLauncherUpdater({
    currentVersion: bootstrap?.appVersion ?? "",
    autoCheck: bootstrap?.settings.autoCheckUpdates ?? false,
    autoDownload: bootstrap?.settings.autoDownloadUpdates ?? false,
    ready: Boolean(bootstrap) && !loading,
  });

  const updateBootstrap = useCallback(
    (updater: (value: BootstrapPayload) => BootstrapPayload) => {
      setBootstrap((current) => {
        if (!current) return current;
        const next = updater(current);
        bootstrapRef.current = next;
        return next;
      });
    },
    [],
  );

  const refreshAccountList = useCallback(
    async (preferred?: AccountSummary) => {
      const listed = await launcherApi.listAccounts();
      const accounts = reconcileAccounts(listed, preferred);
      updateBootstrap((value) => ({ ...value, accounts }));
      return accounts;
    },
    [updateBootstrap],
  );

  const restoreAuthentication = useCallback(
    async (payload: BootstrapPayload) => {
      const savedAccounts = await launcherApi
        .listAccounts()
        .catch(() => payload.accounts);
      const candidate =
        savedAccounts.find((account) => account.active) ??
        (savedAccounts.length === 1 ? savedAccounts[0] : undefined);
      if (!candidate) {
        const next = { ...payload, accounts: savedAccounts };
        bootstrapRef.current = next;
        setBootstrap(next);
        setAuthError(null);
        setAuthState("unauthenticated");
        return false;
      }

      const optimistic = { ...payload, accounts: savedAccounts };
      bootstrapRef.current = optimistic;
      setBootstrap(optimistic);
      setAuthError(null);
      setAuthState("authenticated");
      try {
        if (!candidate.active) await launcherApi.switchAccount(candidate.id);
        const restored = await launcherApi.restoreActiveAccount();
        const listed = await launcherApi
          .listAccounts()
          .catch(() => savedAccounts);
        const accounts = reconcileAccounts(listed, restored);
        const next = { ...payload, accounts };
        bootstrapRef.current = next;
        setBootstrap(next);
        setAuthError(null);
        setAuthState("authenticated");
        void launcherApi
          .getVersionManifest()
          .then((versions) =>
            updateBootstrap((value) => ({ ...value, versions })),
          )
          .catch(() => undefined);
        return true;
      } catch (cause) {
        const message = safeMessage(cause);
        const accounts = await launcherApi
          .listAccounts()
          .catch(() => savedAccounts);
        const next = { ...payload, accounts };
        bootstrapRef.current = next;
        setBootstrap(next);
        // A saved account always keeps the launcher unlocked. If Microsoft has
        // revoked the refresh token, reconnect only when an online action is
        // attempted instead of throwing the user back to the login screen at
        // every startup.
        setAuthError(isAuthenticationReconnectError(message) ? reconnectMessage : null);
        setAuthState("authenticated");
        if (!isAuthenticationReconnectError(message)) setError(message);
        return true;
      }
    },
    [updateBootstrap],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuthError(null);
    setAuthState("checking");
    try {
      const payload = await launcherApi.bootstrap();
      bootstrapRef.current = payload;
      setBootstrap(payload);
      setStatus(payload.gameStatus);
      const lines = await launcherApi.console().catch(() => []);
      setConsoleLines(lines.slice(-MAX_CONSOLE_LINES));
      const hasSavedAccount =
        payload.accounts.some((account) => account.active) ||
        payload.accounts.length === 1;
      if (hasSavedAccount) {
        // Open directly into the launcher from the locally persisted account.
        // Token verification/refresh continues without blocking first paint.
        setAuthState("authenticated");
        setLoading(false);
        void restoreAuthentication(payload);
      } else {
        await restoreAuthentication(payload);
      }
    } catch (cause) {
      setError(safeMessage(cause));
      setAuthState("unauthenticated");
    } finally {
      setLoading(false);
    }
  }, [restoreAuthentication]);

  useEffect(() => {
    void reload();
    let disposed = false;
    let unlisten: () => void = () => {};
    void listenToLauncherEvents({
      progress: (payload) => {
        if (!disposed) setProgress(payload as ProgressEvent);
      },
      console: (payload) => {
        if (disposed) return;
        const incoming = Array.isArray(payload)
          ? (payload as ConsoleLine[])
          : [payload as ConsoleLine];
        setConsoleLines((current) =>
          [...current, ...incoming].slice(-MAX_CONSOLE_LINES),
        );
      },
      status: (payload) => {
        if (disposed) return;
        const next = payload as GameStatus;
        setStatus(next);
        if (next.state === "closed") {
          void launcherApi
            .listInstances()
            .then((instances) =>
              updateBootstrap((value) => ({ ...value, instances })),
            )
            .catch(() => undefined);
        }
      },
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [reload, updateBootstrap]);

  const selectedInstance = useMemo(() => {
    const payload = bootstrap;
    if (!payload) return null;
    return (
      payload.instances.find(
        (instance) => instance.id === payload.settings.selectedInstanceId,
      ) ??
      payload.instances[0] ??
      null
    );
  }, [bootstrap]);

  const activeAccount = useMemo(
    () => bootstrap?.accounts.find((account) => account.active) ?? null,
    [bootstrap?.accounts],
  );

  const setSelectedInstance = useCallback(
    async (instanceId: string) => {
      const current = bootstrapRef.current;
      if (!current) return;
      const settings = { ...current.settings, selectedInstanceId: instanceId };
      updateBootstrap((value) => ({ ...value, settings }));
      try {
        const saved = await launcherApi.saveSettings(settings);
        updateBootstrap((value) => ({ ...value, settings: saved }));
      } catch (cause) {
        setError(safeMessage(cause));
      }
    },
    [updateBootstrap],
  );

  const saveSettings = useCallback(
    async (settings: LauncherSettings) => {
      const saved = await launcherApi.saveSettings(settings);
      updateBootstrap((value) => ({
        ...value,
        settings: saved,
      }));
      return saved;
    },
    [updateBootstrap],
  );

  const setInstances = useCallback(
    (instances: InstanceProfile[]) => {
      updateBootstrap((value) => ({ ...value, instances }));
    },
    [updateBootstrap],
  );

  const setAccounts = useCallback(
    (accounts: AccountSummary[]) => {
      updateBootstrap((value) => ({ ...value, accounts }));
    },
    [updateBootstrap],
  );

  const finishAuthentication = useCallback(
    async (account?: AccountSummary) => {
      // signInMicrosoft already validates Minecraft ownership, saves the tokens,
      // and returns the active account. Do not immediately refresh it again.
      const accounts = await refreshAccountList(account);
      const active = accounts.find((item) => item.active) ?? account;
      if (!active) throw new Error("Microsoft sign-in could not be completed.");
      setAuthError(null);
      setError(null);
      setAuthState("authenticated");
      void launcherApi
        .getVersionManifest()
        .then((versions) =>
          updateBootstrap((value) => ({ ...value, versions })),
        )
        .catch(() => undefined);
      return accounts;
    },
    [refreshAccountList, updateBootstrap],
  );

  const signIn = useCallback(async () => {
    if (signInInFlightRef.current) return signInInFlightRef.current;

    const signInRequest = launcherApi
      .signInMicrosoft()
      .then(async (account) => {
        await finishAuthentication(account);
        return account;
      })
      .finally(() => {
        signInInFlightRef.current = null;
      });

    signInInFlightRef.current = signInRequest;
    return signInRequest;
  }, [finishAuthentication]);

  const runAuthenticated = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation();
      } catch (cause) {
        if (!isAuthenticationReconnectError(cause)) throw cause;

        setError(null);
        setAuthError(null);
        try {
          await signIn();
        } catch (signInError) {
          const message = safeMessage(signInError);
          setAuthState("unauthenticated");
          setAuthError(
            message.toLowerCase().includes("cancel") ? null : reconnectMessage,
          );
          throw signInError;
        }
        return operation();
      }
    },
    [signIn],
  );

  const activateAccount = useCallback(
    async (accountId: string) => {
      const current = bootstrapRef.current?.accounts.find(
        (account) => account.active,
      );
      try {
        if (
          !current ||
          canonicalAccountId(current.id) !== canonicalAccountId(accountId)
        ) {
          await launcherApi.switchAccount(accountId);
        }
        const restored = await launcherApi.restoreActiveAccount();
        return await finishAuthentication(restored);
      } catch (cause) {
        const message = safeMessage(cause);
        await refreshAccountList().catch(() => []);
        setAuthState("unauthenticated");
        setAuthError(
          isAuthenticationReconnectError(message) ? reconnectMessage : message,
        );
        throw cause;
      }
    },
    [finishAuthentication, refreshAccountList],
  );

  const removeAccount = useCallback(
    async (accountId: string) => {
      const accounts = await launcherApi.removeAccount(accountId);
      setAccounts(accounts);
      const active = accounts.find((account) => account.active);
      if (!active) {
        setAuthState("unauthenticated");
        setAuthError(null);
        return accounts;
      }
      try {
        await launcherApi.restoreActiveAccount();
        await refreshAccountList();
        setAuthState("authenticated");
        setAuthError(null);
      } catch (cause) {
        setAuthState("unauthenticated");
        setAuthError(safeMessage(cause));
      }
      return accounts;
    },
    [refreshAccountList, setAccounts],
  );

  const refreshInstances = useCallback(async () => {
    const instances = await launcherApi.listInstances();
    setInstances(instances);
    return instances;
  }, [setInstances]);

  const launchRequest = useCallback(
    async (instanceId: string, server?: string) => {
      if (authState !== "authenticated")
        throw new Error("Sign in with Microsoft before launching Minecraft.");
      const shouldShowConsole =
        bootstrapRef.current?.settings.showConsoleOnLaunch ?? true;
      setConsoleLines([]);
      setLaunchConsoleVisible(shouldShowConsole);
      try {
        await runAuthenticated(() => launcherApi.launch({ instanceId, server }));
      } catch (cause) {
        if (
          !isAuthenticationReconnectError(cause) &&
          !safeMessage(cause).toLowerCase().includes("cancel")
        ) {
          setError(safeMessage(cause));
        }
        throw cause;
      }
    },
    [authState, runAuthenticated],
  );

  const launchInstance = useCallback(
    async (instanceId: string) => launchRequest(instanceId),
    [launchRequest],
  );

  const launchSelected = useCallback(async () => {
    const instance = selectedInstance;
    if (!instance) throw new Error("Create or select an instance first.");
    await launchRequest(instance.id);
  }, [launchRequest, selectedInstance]);

  const launchServer = useCallback(async (server: string) => {
    const instance = selectedInstance;
    if (!instance) throw new Error("Create or select an instance first.");
    await launchRequest(instance.id, server);
  }, [launchRequest, selectedInstance]);

  return {
    bootstrap,
    activeAccount,
    loading,
    error,
    setError,
    authError,
    setAuthError,
    authState,
    progress,
    consoleLines,
    setConsoleLines,
    status,
    launchConsoleVisible,
    setLaunchConsoleVisible,
    selectedInstance,
    setSelectedInstance,
    saveSettings,
    setInstances,
    setAccounts,
    refreshInstances,
    launchInstance,
    launchSelected,
    launchServer,
    finishAuthentication,
    signIn,
    runAuthenticated,
    activateAccount,
    removeAccount,
    reload,
    ...updater,
  };
}

export type LauncherController = ReturnType<typeof useLauncher>;
