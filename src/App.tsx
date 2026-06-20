import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { ProgressOverlay } from "./components/ProgressOverlay";
import { LaunchConsoleModal } from "./components/LaunchConsoleModal";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { UpdateNotification } from "./components/UpdateNotification";
import {
  isAuthenticationReconnectError,
  useLauncher,
} from "./hooks/useLauncher";
import type { RouteKey } from "./lib/types";

const LoginPage = lazy(() =>
  import("./pages/Login").then((module) => ({ default: module.LoginPage })),
);
const HomePage = lazy(() =>
  import("./pages/Home").then((module) => ({ default: module.HomePage })),
);
const LibraryPage = lazy(() =>
  import("./pages/Library").then((module) => ({ default: module.LibraryPage })),
);
const DiscoverPage = lazy(() =>
  import("./pages/Discover").then((module) => ({
    default: module.DiscoverPage,
  })),
);
const SkinsPage = lazy(() =>
  import("./pages/Skins").then((module) => ({ default: module.SkinsPage })),
);
const ServersPage = lazy(() =>
  import("./pages/Servers").then((module) => ({ default: module.ServersPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/Settings").then((module) => ({
    default: module.SettingsPage,
  })),
);

export default function App() {
  const controller = useLauncher();
  const [route, setRoute] = useState<RouteKey>("home");
  const [progressVisible, setProgressVisible] = useState(true);
  const {
    bootstrap,
    loading,
    error,
    authState,
    activeAccount,
  } = controller;
  const visibleError =
    error &&
    !isAuthenticationReconnectError(error) &&
    !error.toLowerCase().includes("microsoft sign-in was cancelled")
      ? error
      : null;

  useEffect(() => {
    if (authState !== "authenticated") setRoute("home");
  }, [authState]);

  const page = useMemo(() => {
    switch (route) {
      case "library":
        return <LibraryPage controller={controller} />;
      case "discover":
        return <DiscoverPage controller={controller} />;
      case "skins":
        return <SkinsPage controller={controller} />;
      case "servers":
        return <ServersPage controller={controller} />;
      case "settings":
        return <SettingsPage controller={controller} />;
      default:
        return <HomePage controller={controller} onRoute={setRoute} />;
    }
  }, [
    route,
    controller.bootstrap,
    controller.selectedInstance?.id,
    controller.status,
    controller.consoleLines,
    controller.loading,
    controller.updateState,
  ]);

  if (loading || !bootstrap || authState === "checking") {
    return (
      <div className="app-window app-window--loading">
        <TitleBar version="2.3.2" />
        <div className="boot-screen">
          <div className="boot-mark">
            <LoaderCircle className="spin" size={28} />
          </div>
          <h1>MegaClient</h1>
          <p>
            {authState === "checking"
              ? "Signing you in…"
              : "Starting MegaClient…"}
          </p>
        </div>
      </div>
    );
  }

  if (authState !== "authenticated" || !activeAccount) {
    return (
      <div
        className={
          bootstrap.settings.reducedMotion
            ? "app-window app-window--login reduce-motion"
            : "app-window app-window--login"
        }
      >
        <TitleBar version={bootstrap.appVersion} />
        <Suspense
          fallback={
            <div className="page-loading">
              <LoaderCircle className="spin" size={22} /> Loading…
            </div>
          }
        >
          <LoginPage controller={controller} />
        </Suspense>
        {visibleError && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={17} />
            <span>{visibleError}</span>
            <button
              onClick={() => controller.setError(null)}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <UpdateNotification
          state={controller.updateState}
          onCheck={controller.checkForUpdates}
          onDownload={controller.downloadUpdate}
          onInstall={controller.installUpdate}
        />
      </div>
    );
  }

  return (
    <div
      className={
        bootstrap.settings.reducedMotion
          ? "app-window reduce-motion"
          : "app-window"
      }
    >
      <TitleBar version={bootstrap.appVersion} />
      <div className="app-body">
        <Sidebar
          route={route}
          onRoute={setRoute}
          compact={bootstrap.settings.compactNavigation}
          account={activeAccount}
        />
        <main className="content-area">
          <Suspense
            fallback={
              <div className="page-loading">
                <LoaderCircle className="spin" size={22} /> Loading…
              </div>
            }
          >
            {page}
          </Suspense>
        </main>
      </div>
      {visibleError && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={17} />
          <span>{visibleError}</span>
          <button
            onClick={() => controller.setError(null)}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <LaunchConsoleModal controller={controller} />
      <ProgressOverlay
        progress={progressVisible ? controller.progress : null}
        onDismiss={() => setProgressVisible(false)}
      />
      <UpdateNotification
        state={controller.updateState}
        onCheck={controller.checkForUpdates}
        onDownload={controller.downloadUpdate}
        onInstall={controller.installUpdate}
      />
    </div>
  );
}
