import React, { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/tauri";

type Profile = { id: string; name: string };

type McVersion = {
  id: string;
  type: string;
  release_time: string;
};

type NewsItem = {
  title: string;
  summary: string;
  url: string;
  date: string;
};

type ModrinthProject = {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string;
};

type LoaderKind = "vanilla" | "fabric";

const FALLBACK_VERSIONS: McVersion[] = [
  "1.8.9","1.9.4","1.10.2","1.11.2","1.12.2","1.13.2","1.14.4","1.15.2","1.16.5","1.17.1","1.18.2","1.19.4","1.20.1","1.20.4","1.20.6","1.21.1","1.21.2","1.21.3","1.21.4","1.21.5",
].map((id) => ({ id, type: "release", release_time: "1970-01-01T00:00:00Z" }));


type Instance = {
  id: string;
  name: string;
  mc_version: string | null;
  loader: LoaderKind;
  created_at?: string | null;
};

type InstanceMod = { file: string; enabled: boolean };


type LauncherUpdate = {
  tag: string;
  name: string;
  body: string;
  url: string;
  date: string;
};


const Button = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={
      "rounded-xl px-4 py-2 font-medium transition disabled:opacity-50 btn-polish " +
      (props.className ?? "")
    }
  />
);

const Card: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ children, className }) => (
  <div className={"rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-lg " + (className ?? "")}>{children}</div>
);

type ToastKind = "info" | "success" | "error";

function getSeason(): "spring" | "summer" | "autumn" | "winter" {
  const m = new Date().getMonth() + 1; // 1..12
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

function Toast({ msg, kind, onClose }: { msg: string; kind: ToastKind; onClose: () => void }) {


  return (
    <div className="fixed bottom-5 right-5 z-[200] max-w-md">
      <div
        className={
          "rounded-2xl border px-4 py-3 backdrop-blur-xl shadow-2xl " +
          (kind === "error"
            ? "bg-red-500/15 border-red-500/25"
            : kind === "success"
            ? "bg-emerald-500/15 border-emerald-500/25"
            : "bg-white/10 border-white/15")
        }
      >
        <div className="flex items-start gap-3">
          <div className="text-sm text-white/80 whitespace-pre-wrap">{msg}</div>
          <button
            className="ml-auto text-white/60 hover:text-white rounded-lg px-2"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return d;
  }
}


function Sidebar({
  page,
  setPage,
  onPlay,
  selectedInstance,
  account,
  onOpenFolder,
}: {
  page: string;
  setPage: (p: string) => void;
  onPlay: () => void;
  selectedInstance: Instance | null;
  account: Profile | null;
  onOpenFolder: () => void;
}) {
  return (
    <div className="h-full self-stretch w-[280px] shrink-0 rounded-2xl border border-white/10 bg-black/25 backdrop-blur-xl p-4 flex flex-col">
      <div className="mb-4">
        <div className="text-xl font-semibold tracking-tight">MegaClient</div>
        <div className="text-xs text-white/60 mt-1">
          {account ? `Signed in as ${account.name}` : "Sign in required"}
        </div>
      </div>

      <nav className="flex-1 space-y-2">
        {[
          ["news", "News"],
          ["instances", "Instances"],
          ["downloads", "Add-ons"],
          ["servers", "Servers"],
          ["accounts", "Account"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            className={
              "w-full text-left rounded-xl px-3 py-2 transition border " +
              (page === id ? "bg-white/10 border-white/15" : "bg-transparent border-transparent hover:bg-white/5")
            }
          >
            <div className="text-sm font-medium flex items-center gap-2">
              <span>{label}</span>
            </div>
          </button>
        ))}
      </nav>

      <Card className="p-3">
        <div className="text-xs text-white/60">Selected instance</div>
        <div className="text-sm font-semibold truncate mt-1">{selectedInstance ? selectedInstance.name : "None"}</div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-white/50 truncate">
              {selectedInstance?.mc_version ?? "latest"} • {selectedInstance?.loader ?? "vanilla"}
            </div>
          </div>
          <Button
            onClick={onOpenFolder}
            className="bg-white/10 hover:bg-white/15 border border-white/10 px-3 py-2"
            title="Open instance folder"
          >
            📂
          </Button>
        </div>

        <Button
          onClick={onPlay}
          className="mt-3 w-full bg-emerald-500/90 hover:bg-emerald-500 text-black"
          disabled={!account || !selectedInstance}
        >
          Play
        </Button>
      </Card>

      <div className="mt-3 text-xs text-white/40">Support: discord.gg/6x24MhsyNm</div>
    </div>
  );
}

function VersionsModal({
  open,
  onClose,
  versions,
  filter,
  setFilter,
  selected,
  setSelected,
  selectedLoader,
  setSelectedLoader,
  onOpenFiles,
}: {
  open: boolean;
  onClose: () => void;
  versions: McVersion[];
  filter: string;
  setFilter: (s: string) => void;
  selected: string | null;
  setSelected: (id: string) => void;
  selectedLoader: LoaderKind;
  setSelectedLoader: (l: LoaderKind) => void;
  onOpenFiles: (id: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return versions;
    return versions.filter((v) => v.id.toLowerCase().includes(q));
  }, [versions, filter]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b0d12] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div className="text-lg font-semibold">Versions</div>
            <div className="text-xs text-white/50">1.8.9+ only • Latest selected by default</div>
          </div>
          <Button onClick={onClose} className="bg-white/10 hover:bg-white/15 border border-white/10">Close</Button>
        </div>

        <div className="p-4">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search versions (e.g. 1.20, 1.8.9)…"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-white/20"
          />

          <div className="mt-4 max-h-[520px] overflow-auto space-y-2 pr-1">
            {filtered.map((v) => (
              <div
                key={v.id}
                className={
                  "flex items-center justify-between rounded-2xl border p-3 transition " +
                  (selected === v.id ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/7")
                }
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{v.id}</div>
                  <div className="text-xs text-white/50">
                    {v.type} • {fmtDate(v.release_time)}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <Button
                    onClick={() => onOpenFiles(v.id)}
                    className="bg-white/10 hover:bg-white/15 border border-white/10"
                    title="Open files"
                  >
                    📁
                  </Button>
                  <Button
                    onClick={() => setSelected(v.id)}
                    className="bg-white/10 hover:bg-white/15 border border-white/10"
                  >
                    Select
                  </Button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-sm text-white/60 p-4">No versions match your search.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginGate({ onLoggedIn }: { onLoggedIn: (p: Profile) => void }) {
  const season = getSeason();
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [status, setStatus] = useState<string>("Sign in with Microsoft to continue.");

  const start = async () => {
    setLoading(true);
    setStatus("Opening Microsoft sign-in…");
    try {
      const authUrl = (await invoke("start_microsoft_auth_code")) as string;
      // Option A: open automatically
      await invoke("open_url", { url: authUrl });
      setStarted(true);
      setRedirectUrl("");
      setStatus(
        "We opened the Microsoft sign-in page in your browser. After you finish signing in, you'll be redirected to a blank page. Copy the FULL URL from your browser and paste it below."
      );
    } catch (e: any) {
      setStatus(String(e));
    } finally {
      setLoading(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setRedirectUrl(t);
    } catch {
      // ignore
    }
  };

  const finish = async () => {
    if (!redirectUrl.trim()) return;
    setLoading(true);
    setStatus("Finishing sign-in…");
    try {
      // Tauri maps Rust snake_case command args to camelCase on the JS side.
      // Rust: finish_microsoft_auth_code(redirect_url: String)
      // JS must send: { redirectUrl: "..." }
      const profile = (await invoke("finish_microsoft_auth_code", { redirectUrl })) as Profile;
      onLoggedIn(profile);
    } catch (e: any) {
      setStatus(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`h-screen w-screen grid place-items-center season-bg season-${season}`}>
      <Card className="w-full max-w-lg p-6">
        <div className="text-2xl font-semibold">MegaClient</div>
        <div className="text-sm text-white/60 mt-1">Please sign in to use the launcher.</div>

        <div className="mt-5 text-sm text-white/70">{status}</div>

        {!started && (
          <Button
            onClick={start}
            disabled={loading}
            className="mt-6 w-full bg-white/10 hover:bg-white/15 border border-white/10"
          >
            {loading ? "Starting…" : "Add Microsoft Account"}
          </Button>
        )}

        {started && (
          <div className="mt-6">
            <div className="text-xs text-white/60 mb-2">Paste redirect URL</div>
            <div className="flex items-center gap-2">
              <input
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://login.live.com/oauth20_desktop.srf?code=..."
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-white/20"
              />
              <Button onClick={pasteFromClipboard} className="bg-white/10 hover:bg-white/15 border border-white/10">
                Paste
              </Button>
            </div>
            <Button
              onClick={finish}
              disabled={loading || !redirectUrl.trim()}
              className="mt-3 w-full bg-emerald-500/90 hover:bg-emerald-500 text-black"
            >
              {loading ? "Signing in…" : "Continue"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [updates, setUpdates] = useState<LauncherUpdate[]>([]);
  const [updatesErr, setUpdatesErr] = useState<string | null>(null);


  // Launcher updates are pulled from releases (or your own endpoint).
  const combinedUpdates = updates;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = (await invoke("get_news")) as NewsItem[];
        if (!cancelled) setItems(res);
      } catch (e: any) {
        // fallback to Mojang launcher content
        try {
          const r = await fetch("https://launchercontent.mojang.com/v2/news.json", { cache: "no-store" });
          const j = await r.json();
          const mapped: NewsItem[] = (j?.entries ?? []).slice(0, 12).map((n: any) => ({
            title: n.title ?? "Minecraft News",
            summary: (n.shortText ?? n.text ?? "").toString().replace(/<[^>]*>/g, "").slice(0, 220),
            url: n.readMoreLink ?? n.url ?? n.link ?? "https://minecraft.net",
            date: n.date ?? n.timestamp ?? "",
          }));
          if (!cancelled) setItems(mapped);
        } catch {
          if (!cancelled) setErr(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = (await invoke("get_launcher_updates")) as LauncherUpdate[];
        if (!cancelled) setUpdates(res);
      } catch (e: any) {
        if (!cancelled) setUpdatesErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xl font-semibold">News</div>
        <div className="text-sm text-white/60">Minecraft news + MegaClient updates.</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold">Minecraft</div>
            <div className="text-xs text-white/60">Latest from Mojang.</div>
          </div>

          {err && <Card className="p-4 text-sm text-red-200">{err}</Card>}

          <div className="grid grid-cols-1 gap-3">
            {items.map((n, idx) => (
              <Card key={idx} className="p-4">
                <div className="text-sm font-semibold line-clamp-1">{n.title}</div>
                <div className="text-xs text-white/50 mt-1">{fmtDate(n.date)}</div>
                <div className="text-sm text-white/70 mt-2 line-clamp-3">{n.summary}</div>
                <Button
                  className="mt-3 bg-white/10 hover:bg-white/15 border border-white/10"
                  onClick={() => invoke("open_url", { url: n.url })}
                >
                  Read
                </Button>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold">MegaClient Updates</div>
            <div className="text-xs text-white/60">Launcher updates and news.</div>
          </div>

          {updatesErr && <Card className="p-4 text-sm text-red-200">{updatesErr}</Card>}

          <div className="grid grid-cols-1 gap-3">
            {combinedUpdates.map((u, idx) => (
              <Card key={idx} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold line-clamp-1">{u.name}</div>
                    <div className="text-xs text-white/50 mt-1">{u.tag ? `${u.tag} • ` : ""}{fmtDate(u.date)}</div>
                  </div>
                  <Button
                    className="bg-white/10 hover:bg-white/15 border border-white/10"
                    onClick={() => invoke("open_url", { url: u.url })}
                  >
                    Open
                  </Button>
                </div>
                {u.body ? (
                  <div className="text-sm text-white/70 mt-3 line-clamp-4">
                    {u.body.replace(/\r/g, "").split("\n").filter(Boolean).slice(0, 6).join("\n")}
                  </div>
                ) : (
                  <div className="text-sm text-white/60 mt-3">No release notes provided.</div>
                )}
              </Card>
            ))}
            {combinedUpdates.length === 0 && !updatesErr && (
              <Card className="p-4 text-sm text-white/60">No releases found yet.</Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InstancesPage({
  versions,
  instances,
  selectedInstanceId,
  refreshAll,
  select,
  notify,
}: {
  versions: McVersion[];
  instances: Instance[];
  selectedInstanceId: string | null;
  refreshAll: () => Promise<void>;
  select: (id: string) => Promise<void>;
  notify: (k: ToastKind, msg: string) => void;
}) {
  const selected = instances.find((i) => i.id === selectedInstanceId) ?? null;

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newVersion, setNewVersion] = useState("latest");
  const [newLoader, setNewLoader] = useState<LoaderKind>("vanilla");

  const [mods, setMods] = useState<InstanceMod[]>([]);
  const [modsLoading, setModsLoading] = useState(false);

  const refreshMods = async () => {
    if (!selected) return;
    setModsLoading(true);
    try {
      const m = (await invoke("list_instance_mods", { instanceId: selected.id })) as InstanceMod[];
      setMods(m);
    } catch (e: any) {
      notify("error", String(e));
    } finally {
      setModsLoading(false);
    }
  };

  useEffect(() => {
    refreshMods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstanceId]);

  const create = async () => {
    try {
      await invoke("create_instance", {
        name: newName,
        mcVersion: newVersion === "latest" ? null : newVersion,
        loader: newLoader,
      });
      setCreating(false);
      setNewName("");
      setNewVersion("latest");
      setNewLoader("vanilla");
      await refreshAll();
      notify("success", "Instance created.");
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  const saveSelected = async () => {
    if (!selected) return;
    try {
      await invoke("update_instance", {
        instanceId: selected.id,
        name: selected.name,
        mcVersion: selected.mc_version,
        loader: selected.loader,
      });
      await refreshAll();
      notify("success", "Instance saved.");
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  const delInstance = async (id: string) => {
    if (!confirm("Delete this instance? This removes its folder too.")) return;
    try {
      await invoke("delete_instance", { instanceId: id });
      await refreshAll();
      notify("success", "Instance deleted.");
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  const openFolder = async () => {
    if (!selected) return;
    try {
      await invoke("open_instance_folder", { instanceId: selected.id });
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  const toggleMod = async (file: string, enabled: boolean) => {
    if (!selected) return;
    try {
      await invoke("set_instance_mod_enabled", { instanceId: selected.id, file, enabled });
      await refreshMods();
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  const removeMod = async (file: string) => {
    if (!selected) return;
    try {
      await invoke("delete_instance_mod", { instanceId: selected.id, file });
      await refreshMods();
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">Instances</div>
          <div className="text-sm text-white/60">Multiple installs with different versions/loaders/mods.</div>
        </div>
        <Button className="bg-white/10 hover:bg-white/15 border border-white/10" onClick={() => setCreating(true)}>
          + New
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          {instances.map((i) => (
            <Card key={i.id} className={"p-4 " + (i.id === selectedInstanceId ? "border-white/20 bg-white/10" : "")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{i.name}</div>
                  <div className="text-xs text-white/50 mt-1">{(i.mc_version ?? "latest")} • {i.loader}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button className="bg-white/10 hover:bg-white/15 border border-white/10" onClick={() => select(i.id)}>
                    Select
                  </Button>
                  <Button className="bg-white/10 hover:bg-white/15 border border-white/10" onClick={() => delInstance(i.id)} title="Delete">
                    🗑️
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {instances.length === 0 && <Card className="p-4 text-sm text-white/60">No instances yet.</Card>}
        </div>

        <div className="space-y-3">
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold">Selected instance</div>
                <div className="text-xs text-white/60 mt-1">Edit version/loader and manage mods.</div>
              </div>
              <div className="flex gap-2">
                <Button className="bg-white/10 hover:bg-white/15 border border-white/10" onClick={openFolder}>📂</Button>
                <Button className="bg-white/10 hover:bg-white/15 border border-white/10" onClick={refreshMods}>↻</Button>
              </div>
            </div>

            {!selected && <div className="text-sm text-white/60 mt-4">Select an instance to manage it.</div>}

            {selected && (
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-xs text-white/60 mb-1">Name</div>
                  <input
                    value={selected.name}
                    onChange={(e) => {
                      selected.name = e.target.value;
                      notify("info", "Name changed (press Save).");
                    }}
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-white/20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-white/60 mb-1">Minecraft version</div>
                    <select
                      value={selected.mc_version ?? "latest"}
                      onChange={(e) => {
                        selected.mc_version = e.target.value === "latest" ? null : e.target.value;
                        notify("info", "Version changed (press Save).");
                      }}
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-white/20 text-white"
                    >
                      <option value="latest">latest</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>{v.id}</option>
                      ))}
                    </select>
</div>

                  <div>
                    <div className="text-xs text-white/60 mb-1">Loader</div>
                    <select
                      value={selected.loader}
                      onChange={(e) => {
                        selected.loader = e.target.value as LoaderKind;
                        notify("info", "Loader changed (press Save).");
                      }}
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-white/20 text-white"
                    >
                      <option value="vanilla">Vanilla</option>
                      <option value="fabric">Fabric</option>
                      {/* Only Vanilla + Fabric are supported */}
                    </select>
                  </div>
                </div>

                <Button className="w-full bg-emerald-500/90 hover:bg-emerald-500 text-black" onClick={saveSelected}>
                  Save
                </Button>

                {selected.loader === "fabric" ? (
                  <div className="mt-2">
                    <div className="text-sm font-semibold">Mods</div>
                    <div className="text-xs text-white/60">Toggle mods on/off or remove them.</div>

                    {modsLoading && <div className="text-sm text-white/60 mt-2">Loading…</div>}

                    {!modsLoading && (
                      <div className="mt-3 space-y-2">
                        {mods.map((m) => (
                          <div key={m.file} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                            <div className="text-sm truncate max-w-[340px]">{m.file}</div>
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-2 text-xs text-white/70">
                                <input type="checkbox" checked={m.enabled} onChange={(e) => toggleMod(m.file, e.target.checked)} />
                                {m.enabled ? "On" : "Off"}
                              </label>
                              <Button className="bg-white/10 hover:bg-white/15 border border-white/10" onClick={() => removeMod(m.file)} title="Remove">🗑️</Button>
                            </div>
                          </div>
                        ))}
                        {mods.length === 0 && <div className="text-sm text-white/60">No mods in this instance yet.</div>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-sm font-semibold">Mods disabled for Vanilla</div>
                    <div className="text-xs text-white/60 mt-1">Switch loader to <b>Fabric</b> then press Save to enable mods for this instance.</div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0d12] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <div className="text-lg font-semibold">New Instance</div>
                <div className="text-xs text-white/50">Separate install with its own mods folder.</div>
              </div>
              <Button onClick={() => setCreating(false)} className="bg-white/10 hover:bg-white/15 border border-white/10">Close</Button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs text-white/60 mb-1">Name</div>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My Fabric Instance"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-white/20" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-white/60 mb-1">Minecraft version</div>
                  <select
                      value={newVersion}
                      onChange={(e) => setNewVersion(e.target.value)}
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-white/20 text-white"
                    >
                      <option value="latest">latest</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>{v.id}</option>
                      ))}
                    </select>
                </div>
                <div>
                  <div className="text-xs text-white/60 mb-1">Loader</div>
                  <select value={newLoader} onChange={(e) => setNewLoader(e.target.value as LoaderKind)}
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-white/20 text-white">
                    <option value="vanilla">Vanilla</option>
                    <option value="fabric">Fabric</option>
                    {/* Only Vanilla + Fabric are supported */}
                  </select>
                </div>
              </div>

              <Button className="w-full bg-emerald-500/90 hover:bg-emerald-500 text-black" onClick={create}>Create</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ServersPage({ notify }: { notify: (kind: ToastKind, msg: string) => void }) {
  const servers = [
    {
      name: "SeekSMP",
      address: "play.seeksmp.org.uk",
      versions: "1.20.x",
    },
    {
      name: "Hypixel",
      address: "mc.hypixel.net",
      versions: "1.8–1.20",
    },
  ];

  const [icons, setIcons] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const s of servers) {
        try {
          const dataUrl = (await invoke("get_server_icon", { host: s.address })) as string;
          if (!cancelled && dataUrl) {
            setIcons((prev) => ({ ...prev, [s.address]: dataUrl }));
          }
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-semibold">Featured Servers</div>
        <div className="text-sm text-white/60">One-click join from MegaClient.</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {servers.map((s) => (
          <Card key={s.address} className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-white/5 border border-white/10 overflow-hidden grid place-items-center shrink-0">
              {icons[s.address] ? (
                <img src={icons[s.address]} className="h-full w-full object-cover" />
              ) : (
                <div className="text-sm text-white/50">🧊</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{s.name}</div>
              <div className="text-xs text-white/60 truncate">{s.address}</div>
              <div className="text-xs text-white/50 mt-1">{s.versions}</div>
            </div>
            <Button
              className="bg-white/10 hover:bg-white/15 border border-white/10"
              onClick={async () => {
                try {
                  await invoke("set_join_server", { host: s.address });
                  notify("success", `Server set to ${s.address}\nPress Play to join.`);
                } catch (e: any) {
                  notify("error", String(e));
                }
              }}
              title="Click, then press Play"
            >
              Join
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DownloadsPage({
  selectedVersion,
  selectedLoader,
  notify,
}: {
  selectedVersion: string | null;
  selectedLoader: LoaderKind;
  notify: (kind: ToastKind, msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"mod" | "resourcepack" | "shader">("mod");
  const [results, setResults] = useState<ModrinthProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mcVersion = selectedVersion ?? "latest";
  const modsAllowed = !(selectedLoader === "vanilla" && kind === "mod");

  const search = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = (await invoke("modrinth_search", { query, kind, limit: 20, loader: selectedLoader })) as ModrinthProject[];
      setResults(r);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Curated one-click packs (Modrinth slugs). Some mods may not yet support a brand-new
  // Minecraft patch; the backend installs what it can and skips the rest.
  
const packs = [
  {
    name: "Performance",
    desc: "Max FPS, smoother chunks, lower memory.",
    slugs: {
      fabric: ["sodium","lithium","ferrite-core","entityculling","moreculling","modernfix","sodium-extra","indium","immediatelyfast","lazydfu","noisium","c2me-fabric"],
    },
  },
  {
    name: "Quality of Life",
    desc: "Better UI, inventory helpers, small niceties.",
    slugs: {
      fabric: ["modmenu","appleskin","mouse-tweaks","chat-heads","shulkerboxtooltip","inventory-profiles-next","betterf3","language-reload","tooltipfix"],
    },
  },
  {
    name: "Visuals",
    desc: "Shaders-ready, lighting, cosmetic polish.",
    slugs: {
      fabric: ["iris","continuity","lambdynamiclights","entitytexturefeatures","entity-model-features","camerautils","zoomify"],
    },
  },
  {
    name: "Utility",
    desc: "Debugging, performance tools, safe chat options.",
    slugs: {
      fabric: ["no-chat-reports","spark","better-stats","memoryleakfix","anti-ghost","replaymod"],
    },
  },
  {
    name: "Builder",
    desc: "Building & editing essentials.",
    slugs: {
      fabric: ["worldedit","litematica","malilib","minihud","tweakeroo","item-scroller"],
    },
  },
  {
    name: "Adventure",
    desc: "Exploration helpers + maps.",
    slugs: {
      fabric: ["xaeros-minimap","xaeros-world-map","jade","travelersbackpack","inventory-sorting"],
    },
  },
];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-semibold">Add-ons</div>
        <div className="text-sm text-white/60">Mods, resource packs & shaders via Modrinth.</div>
      </div>

      {!modsAllowed && (
        <Card className="p-4">
          <div className="text-sm font-semibold">Mods are disabled for Vanilla instances</div>
          <div className="text-xs text-white/60 mt-1">
            Switch this instance to <b>Fabric</b> to install mods, or change the type above to install <b>resource packs</b> / <b>shader packs</b>.
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Modrinth…"
            className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-white/20 text-white placeholder:text-white/40"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as any)}
            className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none text-white"
          >
            <option value="mod">Mods</option>
            <option value="resourcepack">Resource Packs</option>
            <option value="shader">Shader Packs</option>
          </select>
          <Button onClick={search} className="bg-white/10 hover:bg-white/15 border border-white/10">
            {loading ? "Searching…" : "Search"}
          </Button>
        </div>
        <div className="text-xs text-white/50 mt-2">
          Target: {selectedVersion ? selectedVersion : "Latest"} (you can choose a specific version in Versions)
        </div>
      </Card>

      {err && <Card className="p-4 text-sm text-red-200">{err}</Card>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {results.map((p) => (
          <Card key={p.id} className="p-4 flex gap-3">
            <div className="h-12 w-12 rounded-xl bg-white/5 border border-white/10 overflow-hidden shrink-0">
              {p.icon_url ? <img src={p.icon_url} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{p.title}</div>
              <div className="text-xs text-white/60 line-clamp-2">{p.description}</div>
              <div className="mt-3 flex gap-2">
                <Button
                  className="bg-white/10 hover:bg-white/15 border border-white/10"
                  disabled={!modsAllowed}
                  onClick={async () => {
                    if (!modsAllowed) return;
                    try {
                      await invoke("install_modrinth_project", {
                        projectId: p.id,
                        mcVersion,
                        kind,
                        loader: selectedLoader,
                      });
                      notify("success", `Downloaded: ${p.title}`);
                    } catch (e: any) {
                      notify("error", String(e));
                    }
                  }}
                >
                  Download
                </Button>
                <Button
                  className="bg-white/10 hover:bg-white/15 border border-white/10"
                  onClick={() => invoke("open_url", { url: `https://modrinth.com/project/${p.slug || p.id}` })}
                >
                  View
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {selectedLoader !== "vanilla" && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">⭐ Curated packs</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {packs.map((p) => (
              <Card key={p.name} className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="text-xs text-white/60">One-click install curated set</div>
                </div>
                <Button
                  className="bg-white/10 hover:bg-white/15 border border-white/10"
                  onClick={async () => {
                    try {
                      const slugs = (p.slugs as any)[selectedLoader] || [];
                      const rep = (await invoke("install_modrinth_pack", { slugs, mcVersion, loader: selectedLoader })) as any;
                      const installed = (rep?.installed ?? []) as string[];
                      const skipped = (rep?.skipped ?? []) as string[];
                      notify("success", `Installed pack: ${p.name} (${installed.length} mods)`);
                      if (skipped.length) {
                        const shown = skipped.slice(0, 10);
                        // Build a readable multi-line message safely (avoid unterminated string literals)
                        let msg = `Some mods were skipped (no compatible version for ${mcVersion}):\n- ${shown.join("\n- ")}`;
                        if (skipped.length > 10) msg += `\n… +${skipped.length - 10} more`;
                        notify("info", msg);
                      }
                    } catch (e: any) {
                      notify("error", String(e));
                    }
                  }}
                >
                  Install
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function AccountsPage({
  account,
  onLogout,
  particlesEnabled,
  setParticlesEnabled,
}: {
  account: Profile | null;
  onLogout: () => void;
  particlesEnabled: boolean;
  setParticlesEnabled: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-semibold">Account</div>
        <div className="text-sm text-white/60">Microsoft account linked to Minecraft.</div>
      </div>

      <Card className="p-4">
        {account ? (
          <>
            <div className="text-sm font-semibold">{account.name}</div>
            <div className="text-xs text-white/60 mt-1">UUID: {account.id}</div>
            <Button className="mt-4 bg-white/10 hover:bg-white/15 border border-white/10" onClick={onLogout}>
              🚪 Log out
            </Button>
          </>
        ) : (
          <div className="text-sm text-white/70">No account found (you should be asked to sign in on start).</div>
        )}
      </Card>

      <div>
        <div className="text-xl font-semibold">Preferences</div>
        <div className="text-sm text-white/60">Small visual tweaks (optional).</div>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Seasonal particles</div>
            <div className="text-xs text-white/60 mt-1">
              Snow in winter, petals in spring, warm glows in summer, falling leaves in autumn.
            </div>
          </div>

          <button
            className={
              "rounded-full w-12 h-7 border transition " +
              (particlesEnabled ? "bg-emerald-500/25 border-emerald-500/35" : "bg-white/10 border-white/15")
            }
            onClick={() => setParticlesEnabled(!particlesEnabled)}
            title="Toggle particles"
          >
            <span
              className={
                "block w-6 h-6 rounded-full bg-white/80 translate-x-0 transition " +
                (particlesEnabled ? "translate-x-5" : "translate-x-1")
              }
            />
          </button>
        </div>
      </Card>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("news");
  const [account, setAccount] = useState<Profile | null>(null);

  const [versions, setVersions] = useState<McVersion[]>([]);

  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  const [isLaunching, setIsLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);
  const [launchBlocked, setLaunchBlocked] = useState<null | { title: string; body: string; file?: string; detected?: string }>(null);

  const [toast, setToast] = useState<{ kind: ToastKind; msg: string } | null>(null);

  const [particlesEnabled, setParticlesEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("megaclient_particles") !== "0"; } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem("megaclient_particles", particlesEnabled ? "1" : "0"); } catch { /* ignore */ }
  }, [particlesEnabled]);

  const notify = (kind: ToastKind, msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), 5000);
  };

  // Close the splashscreen once the React UI is mounted, and start Discord RPC.
  useEffect(() => {
    // best effort (works even if Discord is not running)
    invoke("close_splash").catch(() => void 0);
    invoke("rpc_enable").catch(() => void 0);
    return () => {
      // Ensure RPC is fully cleared when the launcher is closed.
      invoke("rpc_disable").catch(() => void 0);
    };
  }, []);

  // Listen for backend launch status events so Play never feels like it did nothing.
  useEffect(() => {
    let un1: (() => void) | null = null;
    let un2: (() => void) | null = null;
    let un3: (() => void) | null = null;

    (async () => {
      un1 = await listen<string>("mc:launching", (e) => {
        setIsLaunching(true);
        setLaunchMsg(e.payload || "Preparing game...");
      });
      un2 = await listen<string>("mc:started", (e) => {
        setIsLaunching(false);
        setLaunchMsg(null);
        notify("success", e.payload || "Minecraft launched.");
      });
      un3 = await listen<string>("mc:exited", (e) => {
        notify("info", e.payload || "Minecraft closed.");
      });
    })();

    return () => {
      try { un1?.(); } catch {}
      try { un2?.(); } catch {}
      try { un3?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshInstances = async () => {
    try {
      const list = (await invoke("list_instances")) as Instance[];
      setInstances(list);
      const sel = (await invoke("get_selected_instance")) as Instance;
      // get_selected_instance() may return a synthetic "default" instance when no selection exists.
      // Ensure the selected id is actually present in the list; otherwise pick the first instance.
      const preferred = sel?.id ?? null;
      const next = preferred && list.some((i) => i.id === preferred) ? preferred : (list[0]?.id ?? null);
      setSelectedInstanceId(next);
      if (next && next !== preferred) {
        // Persist the corrected selection so backend + frontend agree.
        try {
          await invoke("select_instance", { instanceId: next });
        } catch {
          // ignore
        }
      }
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  // boot: account + versions + instances
  useEffect(() => {
    (async () => {
      try {
        const acc = (await invoke("get_current_account")) as Profile | null;
        setAccount(acc);
      } catch {
        setAccount(null);
      }

      try {
        const list = (await invoke("list_versions")) as McVersion[];
        setVersions(list && list.length ? list : FALLBACK_VERSIONS);
      } catch {
        setVersions(FALLBACK_VERSIONS);
      }

      await refreshInstances();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Minecraft launch lifecycle events from Rust (prevents "Play does nothing" confusion)
  useEffect(() => {
    let un1: any, un2: any, un3: any;
    (async () => {
      un1 = await listen<string>("mc:launching", (e) => {
        setIsLaunching(true);
        setLaunchMsg(e.payload || "Preparing game...");
      });
      un2 = await listen<string>("mc:started", (e) => {
        setLaunchMsg(e.payload || "Minecraft launched");
        notify("success", e.payload || "Minecraft launched");
      });
      un3 = await listen<string>("mc:exited", (e) => {
        setIsLaunching(false);
        setLaunchMsg(null);
        notify("info", e.payload || "Minecraft closed");
      });
    })();
    return () => {
      try { un1?.(); } catch {}
      try { un2?.(); } catch {}
      try { un3?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedInstance = useMemo(() => instances.find((i) => i.id === selectedInstanceId) ?? null, [instances, selectedInstanceId]);

  const selectInstance = async (id: string) => {
    setSelectedInstanceId(id);
    try {
      await invoke("select_instance", { instanceId: id });
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  const play = async () => {
    if (!selectedInstance) {
      notify("error", "No instance selected. Create one in Instances first.");
      return;
    }
    const v = selectedInstance.mc_version ?? "latest";
    try {
      setIsLaunching(true);
      setLaunchMsg("Preparing game...");
      setLaunchBlocked(null);
      await invoke("launch_game", { instanceId: selectedInstance.id });
      // Rust will emit richer events; keep this as a fallback.
      notify("info", "Starting Minecraft…");
    } catch (e: any) {
      setIsLaunching(false);
      setLaunchMsg(null);
      const raw = String(e);
      // Show a centered "blocked" modal for disallowed mods / hack clients.
      if (/Blocked by signature|Blocked by filename|Delete the mod and try again|blocked/i.test(raw)) {
        // Extract detected pattern + jar filename if available.
        // Rust formats:
        //  - "Blocked by filename: C:\\...\\mods\\wurst.jar"
        //  - "Blocked by signature: C:\\...\\mods\\wurst.jar (wurst)"
        let detected = "";
        let filePath = "";

        const sig = raw.match(/Blocked by signature:\s*([^\n]+?)\s*\(([^)]+)\)/i);
        if (sig) {
          filePath = sig[1].trim();
          detected = sig[2].trim();
        }
        if (!filePath) {
          const byName = raw.match(/Blocked by filename:\s*([^\n]+)/i);
          if (byName) filePath = byName[1].trim();
        }

        // Fallback: sometimes the server/anticheat message includes a client label.
        if (!detected) {
          const m2 = raw.match(/client\s*[:\-]\s*([^\n]+)/i);
          detected = (m2?.[1] || "").trim();
        }

        // Best-effort jar filename.
        const file = filePath ? filePath.split(/[/\\]/).pop() || "" : "";
        const detectedLabel = detected || (file ? file.replace(/\.jar(\.disabled)?$/i, "") : "");

        const title = "Launch blocked";
        const body = (() => {
          const head = detectedLabel
            ? `MegaClient blocked the launch because a disallowed mod / hack client was detected: ${detectedLabel}.`
            : `MegaClient blocked the launch because a disallowed mod / hack client was detected.`;

          const fileLine = file ? `\n\nDetected file: ${file}` : "";
          return `${head}${fileLine}\n\nRemove it from your mods folder and try again.`;
        })();

        setLaunchBlocked({ title, body, file: file || undefined, detected: detectedLabel || undefined });
      } else {
        notify("error", raw);
      }
    }
  };

  const openFolder = async () => {
    if (!selectedInstance) return;
    try {
      await invoke("open_instance_folder", { instanceId: selectedInstance.id });
    } catch (e: any) {
      notify("error", String(e));
    }
  };

  const logout = async () => {
    await invoke("logout_account");
    setAccount(null);
  };

  if (!account) {
    // Login view already has seasonal backgrounds.
    return <LoginGate onLoggedIn={(p) => setAccount(p)} />;
  }

  const season = getSeason();


  const SeasonParticles = () => {
    if (!particlesEnabled) return null;
    const season = getSeason();
    // deterministic-ish positions per session
    const items = Array.from({ length: 28 }).map((_, i) => ({
      id: i,
      left: (i * 37) % 100,
      size: 6 + ((i * 13) % 10),
      dur: 10 + ((i * 7) % 12),
      delay: -((i * 9) % 12),
      drift: (((i * 19) % 30) - 15),
      o: 0.35 + (((i * 11) % 35) / 100),
    }));

    return (
      <div className="fx-particles" aria-hidden>
        {items.map((p) => (
          <div
            key={p.id}
            className={`fx-particle ${season}`}
            style={{
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              opacity: p.o as any,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              transform: `translateX(${p.drift}px)`,
            }}
          />
        ))}
      </div>
    );
  };

  const BackgroundFX = () => (
    <div className="fx-layer" aria-hidden>
      <div className="fx-grid" />
      <div className="fx-glow g1" />
      <div className="fx-glow g2" />
    </div>
  );

  return (
    <div className={`fixed inset-0 p-6 box-border overflow-hidden text-white season-bg season-${season}`}>
      <div className="relative h-full w-full">
        <BackgroundFX />
        <SeasonParticles />

        {launchBlocked && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-[520px] max-w-[92vw] rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/15 border border-red-400/20">
                  <span className="text-lg">⛔</span>
                </div>
                <div className="flex-1">
                  <div className="text-lg font-semibold">{launchBlocked.title}</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-white/75">{launchBlocked.body}</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {launchBlocked.file && selectedInstance && (
                      <button
                        className="rounded-xl bg-red-500/15 hover:bg-red-500/20 border border-red-400/20 px-4 py-2 text-sm"
                        onClick={async () => {
                          const file = launchBlocked.file!;
                          try {
                            // Simple confirm to avoid accidental deletion.
                            const ok = window.confirm(`Remove the detected mod?\n\n${file}`);
                            if (!ok) return;
                            await invoke("delete_instance_mod", { instanceId: selectedInstance.id, file });
                            setLaunchBlocked(null);
                            // Retry launch immediately.
                            await play();
                          } catch (e: any) {
                            notify("error", String(e));
                          }
                        }}
                      >
                        🧹 Remove &amp; retry
                      </button>
                    )}
                    <button
                      className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2 text-sm"
                      onClick={() => {
                        setLaunchBlocked(null);
                        try { openFolder(); } catch {}
                      }}
                    >
                      📁 Open instance folder
                    </button>
                    <button
                      className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2 text-sm"
                      onClick={() => setLaunchBlocked(null)}
                    >
                      ✅ Close
                    </button>
                  </div>
                  <div className="mt-3 text-xs text-white/50">
                    Tip: remove the detected jar from the <span className="text-white/70">mods</span> folder, then try again.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isLaunching && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[420px] rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <div>
                <div className="text-lg font-semibold">Launching Minecraft</div>
                <div className="text-sm text-white/70">{launchMsg ?? "Working..."}</div>
              </div>
            </div>
          </div>
        </div>
        )}

        <div className="h-full w-full flex gap-4 items-stretch">
        <Sidebar
          page={page}
          setPage={setPage}
          onPlay={play}
          selectedInstance={selectedInstance}
          account={account}
          onOpenFolder={openFolder}
        />

        <div className="flex-1 min-h-0 h-full overflow-auto rounded-2xl border border-white/10 bg-black/20 backdrop-blur-xl p-5">
          {page === "news" && <NewsPage />}
          {page === "instances" && (
            <InstancesPage
              versions={versions}
              instances={instances}
              selectedInstanceId={selectedInstanceId}
              refreshAll={refreshInstances}
              select={selectInstance}
              notify={notify}
            />
          )}
          {page === "downloads" && (
            <DownloadsPage
              selectedVersion={selectedInstance?.mc_version ?? null}
              selectedLoader={(selectedInstance?.loader ?? "vanilla") as LoaderKind}
              notify={notify}
            />
          )}
          {page === "servers" && <ServersPage notify={notify} />}
          {page === "accounts" && (
            <AccountsPage
              account={account}
              onLogout={logout}
              particlesEnabled={particlesEnabled}
              setParticlesEnabled={setParticlesEnabled}
            />
          )}
        </div>
        </div>

        {toast && <Toast msg={toast.msg} kind={toast.kind} onClose={() => setToast(null)} />}
      </div>
    </div>
  );
}