import { useEffect, useState } from "react";
import { ImagePlus, RefreshCw, Shirt, Sparkles } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { CapePreview } from "../components/CapePreview";
import { MinecraftSkinViewer } from "../components/MinecraftSkinViewer";
import { SectionHeader } from "../components/SectionHeader";
import {
  isAuthenticationReconnectError,
  type LauncherController,
} from "../hooks/useLauncher";
import { launcherApi, pickPng } from "../lib/api";
import type { SkinProfile } from "../lib/types";
import { safeMessage } from "../lib/utils";

export function SkinsPage({ controller }: { controller: LauncherController }) {
  const [profile, setProfile] = useState<SkinProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { bootstrap, setError } = controller;
  const account = controller.activeAccount;

  const reportError = (error: unknown) => {
    const message = safeMessage(error);
    if (
      !isAuthenticationReconnectError(error) &&
      !message.toLowerCase().includes("cancel")
    ) {
      setError(message);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      setProfile(
        await controller.runAuthenticated(() => launcherApi.skinProfile()),
      );
    } catch (error) {
      reportError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [account?.id]);

  const upload = async (variant: "classic" | "slim") => {
    const path = await pickPng();
    if (!path) return;
    setBusy(true);
    try {
      await controller.runAuthenticated(() =>
        launcherApi.uploadSkin(path, variant),
      );
      await load();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await controller.runAuthenticated(() => launcherApi.resetSkin());
      await load();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <SectionHeader
        title="Appearance"
        action={
          <button className="button button--ghost" onClick={() => void load()}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />
      {!account ? (
        <EmptyState
          icon={Shirt}
          title="Sign in to manage appearance"
          description="Sign in to continue."
        />
      ) : (
        <div className="skin-layout">
          <section className="skin-stage panel">
            <div className="skin-stage__halo" />
            <div className="skin-model" aria-label="Skin preview">
              <MinecraftSkinViewer
                skinUrl={profile?.skinUrl}
                variant={profile?.skinVariant}
                name={profile?.name || account.name}
              />
            </div>
            <div className="skin-stage__caption">
              <span className="status-dot" />
              <div>
                <strong>{profile?.name || account.name}</strong>
                <small>{profile?.skinVariant || "classic"} model</small>
              </div>
            </div>
          </section>
          <div className="skin-controls">
            <section className="panel">
              <div className="panel__heading">
                <div>
                  <span className="eyebrow">Skin</span>
                  <h2>Player model</h2>
                </div>
                <ImagePlus size={19} />
              </div>
              <p>Choose a 64×64 PNG.</p>
              <div className="skin-buttons">
                <button
                  className="button button--primary"
                  disabled={busy || loading}
                  onClick={() => void upload("classic")}
                >
                  Upload classic
                </button>
                <button
                  className="button button--ghost"
                  disabled={busy || loading}
                  onClick={() => void upload("slim")}
                >
                  Upload slim
                </button>
              </div>
              <button
                className="text-button text-button--danger"
                disabled={busy}
                onClick={() => void reset()}
              >
                Reset to default skin
              </button>
            </section>
            <section className="panel">
              <div className="panel__heading">
                <div>
                  <span className="eyebrow">Cape</span>
                  <h2>Owned capes</h2>
                </div>
                <Sparkles size={19} />
              </div>
              <div className="cape-list">
                {profile?.capes.map((cape) => (
                  <button
                    key={cape.id}
                    className={
                      cape.active ? "cape-item is-active" : "cape-item"
                    }
                    onClick={() =>
                      void controller
                        .runAuthenticated(() => launcherApi.setCape(cape.id))
                        .then(load)
                        .catch(reportError)
                    }
                  >
                    <CapePreview url={cape.url} name={cape.alias} />
                    <span>
                      <strong>{cape.alias}</strong>
                      <small>
                        {cape.active ? "Currently active" : "Click to equip"}
                      </small>
                    </span>
                  </button>
                ))}
                {!loading && (profile?.capes.length ?? 0) === 0 && (
                  <p className="quiet-copy">
                    No capes are available on this account.
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
