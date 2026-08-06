// Auto-update checker — fetches latest release from GitHub
// Repo: github.com/pinkaroo/Meridian

const VERCEL_UPDATE = "https://meridianagent.vercel.app/update.json";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  assets: Array<{ name: string; downloadUrl: string; size: number }>;
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
}

// Reject any tag containing a non-numeric suffix like -beta, -rc.1, -alpha.
// Pre-release builds shouldn't auto-prompt stable users to upgrade; if you
// genuinely want to publish a beta, ship it through a different channel.
function hasPreReleaseSuffix(v: string): boolean {
  return /[-+]/.test(v.replace(/^v/, ""));
}

function isNewer(latest: string, current: string): boolean {
  if (hasPreReleaseSuffix(latest)) return false;
  const l = parseVersion(latest);
  const c = parseVersion(current);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

// Get the actual running version from Tauri (reads CARGO_PKG_VERSION at compile time)
async function getCurrentVersion(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("get_app_version");
  } catch {
    return "0.0.0";
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    // The updater is a native desktop capability. Browser builds must not
    // call the Tauri bridge or present a misleading v0.0.0 update banner.
    if (typeof window === "undefined" || !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return null;
    const [currentVersion, res] = await Promise.all([
      getCurrentVersion(),
      fetch(VERCEL_UPDATE, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }),
    ]);

    if (!res.ok) return null;

    const data = await res.json();
    const latestVersion: string = String(data.version ?? "").replace(/^v/, "");

    if (!latestVersion || !isNewer(latestVersion, currentVersion)) return null;

    const assets = [
      data.installer && { name: "MeridianSetup.exe", downloadUrl: new URL(data.installer, VERCEL_UPDATE).href, size: 0 },
      data.executable && { name: "meridian.exe", downloadUrl: new URL(data.executable, VERCEL_UPDATE).href, size: 0 },
    ].filter(Boolean) as UpdateInfo["assets"];

    return {
      currentVersion,
      latestVersion,
      releaseUrl: VERCEL_UPDATE,
      releaseNotes: (data.body ?? "").slice(0, 500),
      publishedAt: data.published_at ?? "",
      assets,
    };
  } catch {
    return null;
  }
}

// Find the best asset.
// Prefer an NSIS installer (MeridianSetup.exe / *Setup*.exe / *install*.exe) because the app
// is installed in Program Files and requires admin rights to update in-place.  The installer
// handles elevation + relaunch itself, which is far more reliable than a binary-swap.
// Fall back to a plain exe if no installer asset is present.
export function getBestAsset(assets: UpdateInfo["assets"]): UpdateInfo["assets"][0] | null {
  // 1. Prefer an NSIS setup / installer exe
  const setupExe = assets.find(a => {
    const n = a.name.toLowerCase();
    return n.endsWith(".exe") && (n.includes("setup") || n.includes("install"));
  });
  if (setupExe) return setupExe;
  // 2. Plain app exe (e.g. meridian.exe, meridian_x64.exe, meridian-1.2.3.exe)
  const appExe = assets.find(a =>
    a.name.toLowerCase() === "meridian.exe" ||
    a.name.toLowerCase().match(/^meridian[_\-]?x64\.exe$/i) !== null ||
    a.name.toLowerCase().match(/^meridian[_\-]?\d+\.\d+\.\d+\.exe$/i) !== null
  );
  if (appExe) return appExe;
  // 3. Any exe
  const anyExe = assets.find(a => a.name.endsWith(".exe"));
  if (anyExe) return anyExe;
  return assets[0] ?? null;
}

// Returns true when the asset is an NSIS-style installer that should be run silently
// rather than swapped in-place.
export function isInstallerAsset(asset: UpdateInfo["assets"][0]): boolean {
  const n = asset.name.toLowerCase();
  return n.includes("setup") || n.includes("install");
}
