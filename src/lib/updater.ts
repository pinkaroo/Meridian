
const GITHUB_RELEASES = "https://api.github.com/repos/pinkaroo/Meridian/releases/latest";

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
    if (typeof window === "undefined" || !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return null;
    const [currentVersion, res] = await Promise.all([
      getCurrentVersion(),
      fetch(GITHUB_RELEASES, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }),
    ]);

    if (!res.ok) return null;

    const data = await res.json() as { tag_name?: string; name?: string; body?: string; published_at?: string; assets?: Array<{ name: string; browser_download_url: string; size?: number }> };
    const latestVersion: string = String(data.tag_name ?? data.name ?? "").replace(/^v/, "");

    if (!latestVersion || !isNewer(latestVersion, currentVersion)) return null;

    const assets = (data.assets ?? [])
      .filter(asset => /\.exe$/i.test(asset.name))
      .map(asset => ({ name: asset.name, downloadUrl: asset.browser_download_url, size: asset.size ?? 0 }));

    return {
      currentVersion,
      latestVersion,
      releaseUrl: `https://github.com/pinkaroo/Meridian/releases/tag/v${latestVersion}`,
      releaseNotes: (data.body ?? "").slice(0, 500),
      publishedAt: data.published_at ?? "",
      assets,
    };
  } catch {
    return null;
  }
}

export function getBestAsset(assets: UpdateInfo["assets"]): UpdateInfo["assets"][0] | null {
  const setupExe = assets.find(a => {
    const n = a.name.toLowerCase();
    return n.endsWith(".exe") && (n.includes("setup") || n.includes("install"));
  });
  if (setupExe) return setupExe;
  const appExe = assets.find(a =>
    a.name.toLowerCase() === "meridian.exe" ||
    a.name.toLowerCase().match(/^meridian[_\-]?x64\.exe$/i) !== null ||
    a.name.toLowerCase().match(/^meridian[_\-]?\d+\.\d+\.\d+\.exe$/i) !== null
  );
  if (appExe) return appExe;
  const anyExe = assets.find(a => a.name.endsWith(".exe"));
  if (anyExe) return anyExe;
  return assets[0] ?? null;
}

export function isInstallerAsset(asset: UpdateInfo["assets"][0]): boolean {
  const n = asset.name.toLowerCase();
  return n.includes("setup") || n.includes("install");
}
