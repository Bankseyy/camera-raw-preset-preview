import { uxp } from "../../globals";

const REPO_OWNER = "Bankseyy";
const REPO_NAME = "bankseytoolbox";
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const CCX_NAME = "com.bolt.uxp.bankseytoolbox_PS.ccx";
const GITHUB_TOKEN_KEY = "githubUpdateToken";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  assetName?: string;
  assetUrl?: string;
  assetApiUrl?: string;
  usesAuth: boolean;
  message: string;
}

function cleanVersion(value: string): string {
  return String(value ?? "").trim().replace(/^v/i, "");
}

function compareVersions(a: string, b: string): number {
  const left = cleanVersion(a).split(".").map(part => parseInt(part, 10) || 0);
  const right = cleanVersion(b).split(".").map(part => parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function currentPluginVersion(): string {
  const info = (uxp as any)?.entrypoints?._pluginInfo;
  return String(info?.version ?? "");
}

function getStoredGithubToken(): string {
  try {
    return String(window.localStorage.getItem(GITHUB_TOKEN_KEY) ?? "").trim();
  } catch (_) {
    return "";
  }
}

function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const token = getStoredGithubToken();
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export const getGithubUpdateTokenStatus = async (): Promise<{ configured: boolean }> => ({
  configured: Boolean(getStoredGithubToken()),
});

export const setGithubUpdateToken = async (token: string): Promise<string> => {
  const clean = String(token ?? "").trim();
  if (!clean) throw new Error("Paste a GitHub token first.");
  window.localStorage.setItem(GITHUB_TOKEN_KEY, clean);
  return "GitHub update token saved locally.";
};

export const clearGithubUpdateToken = async (): Promise<string> => {
  window.localStorage.removeItem(GITHUB_TOKEN_KEY);
  return "GitHub update token cleared.";
};

async function fetchLatestRelease(): Promise<any> {
  const response = await fetch(LATEST_RELEASE_API_URL, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      const hasToken = Boolean(getStoredGithubToken());
      throw new Error(hasToken
        ? `Could not check GitHub releases (${response.status}). The saved token may not have access to ${REPO_OWNER}/${REPO_NAME}.`
        : `Could not check GitHub releases (${response.status}). Add a GitHub token in Settings for private repo updates.`);
    }
    throw new Error(`Could not check GitHub releases (${response.status}).`);
  }

  return response.json();
}

export const checkForUpdates = async (): Promise<UpdateCheckResult> => {
  const currentVersion = currentPluginVersion();
  const latest = await fetchLatestRelease();
  const latestVersion = cleanVersion(latest?.tag_name || latest?.name || "");
  const releaseUrl = String(latest?.html_url || RELEASES_URL);
  const asset = (Array.isArray(latest?.assets) ? latest.assets : [])
    .find((item: any) => String(item?.name ?? "").toLowerCase() === CCX_NAME.toLowerCase())
    ?? (Array.isArray(latest?.assets) ? latest.assets : [])
      .find((item: any) => String(item?.name ?? "").toLowerCase().endsWith(".ccx"));

  if (!latestVersion) {
    throw new Error("Latest release did not include a version tag.");
  }

  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseUrl,
    assetName: asset?.name,
    assetUrl: asset?.browser_download_url,
    assetApiUrl: asset?.url,
    usesAuth: Boolean(getStoredGithubToken()),
    message: updateAvailable
      ? `Update available: ${currentVersion || "unknown"} -> ${latestVersion}${getStoredGithubToken() ? " (private repo access OK)" : ""}`
      : `You're up to date (${currentVersion || latestVersion})${getStoredGithubToken() ? " (private repo access OK)" : ""}.`,
  };
};

export const openReleasesPage = async (): Promise<string> => {
  const { shell } = require("uxp") as any;
  const error = await shell.openExternal(RELEASES_URL);
  return error ? `Could not open releases page: ${error}` : `Opened releases page.`;
};

export const downloadAndInstallLatestUpdate = async (): Promise<string> => {
  const { shell, storage } = require("uxp") as any;
  let latest: UpdateCheckResult;

  try {
    latest = await checkForUpdates();
  } catch (e: any) {
    const error = await shell.openExternal(RELEASES_URL);
    return error
      ? `Update check failed: ${e?.message ?? String(e)}\nCould not open releases page: ${error}`
      : `Update check failed: ${e?.message ?? String(e)}\nOpened releases page instead.`;
  }

  if (!latest.updateAvailable) return latest.message;
  if (!latest.assetUrl) {
    const error = await shell.openExternal(latest.releaseUrl || RELEASES_URL);
    return error
      ? `${latest.message}\nCould not open release page: ${error}`
      : `${latest.message}\nNo CCX asset was found, so I opened the release page.`;
  }

  const response = latest.assetApiUrl && latest.usesAuth
    ? await fetch(latest.assetApiUrl, { headers: githubHeaders("application/octet-stream") })
    : await fetch(latest.assetUrl, { headers: { Accept: "application/octet-stream" } });
  if (!response.ok) {
    const error = await shell.openExternal(latest.releaseUrl || RELEASES_URL);
    return error
      ? `${latest.message}\nDownload failed (${response.status}) and release page could not be opened: ${error}`
      : `${latest.message}\nDownload failed (${response.status}), so I opened the release page.`;
  }

  const bytes = await response.arrayBuffer();
  const tempFolder = await storage.localFileSystem.getTemporaryFolder();
  const fileName = latest.assetName || CCX_NAME;
  const installer = await tempFolder.createFile(fileName, { overwrite: true });
  await installer.write(bytes, { format: storage.formats.binary });

  let openError = "";
  if (typeof shell.openPath === "function") {
    openError = await shell.openPath(installer.nativePath);
  } else {
    openError = await shell.openExternal(latest.releaseUrl || RELEASES_URL);
  }

  return openError
    ? `${latest.message}\nDownloaded ${fileName}, but could not open installer: ${openError}`
    : `${latest.message}\nDownloaded ${fileName} and opened the installer. Photoshop may need a restart after install.`;
};
