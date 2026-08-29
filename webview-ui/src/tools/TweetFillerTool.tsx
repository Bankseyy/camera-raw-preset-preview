import React, { useEffect, useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

function stripSurrogates(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xD800 || c > 0xDFFF) out += s[i];
  }
  return out.trim();
}

function htmlDecode(s: string): string {
  const map: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  return s
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, m => map[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseInput(raw: string): { name: string; handle: string; text: string } {
  const s = raw.trim();

  if (s.startsWith("{") || /"name"\s*:|author_name/.test(s)) {
    const safe = stripSurrogates(s);
    let data: any = null;
    try { data = JSON.parse(safe); } catch (_) {}
    if (data) {
      const name = stripSurrogates(data.name || data.author_name || "");
      const handle = data.handle || data.screen_name || "";
      const text = data.text || data.full_text || data.body || "";
      if (name || handle || text) return { name, handle, text };
    }
  }

  let cleaned = s
    .split(/\r?\n/)
    .filter(l => !/^\s*[\-]\s+.+\(@[^)]+\).*/.test(l))
    .join("\n");

  if (/<\/?[a-z]/i.test(cleaned)) {
    cleaned = htmlDecode(
      cleaned
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1")
        .replace(/<[^>]+>/g, "")
    );
  }

  const lines = cleaned.split(/\r?\n/).filter(l => l.replace(/\s/g, "").length > 0);
  if (lines.length >= 2) {
    let handle = lines[1];
    if (!/^@/.test(handle)) {
      const m = /@[\w.]+/.exec(cleaned);
      if (m) handle = m[0];
    }
    return { name: lines[0], handle, text: lines.slice(2).join("\n") };
  }

  return { name: "", handle: "", text: "" };
}

type AvatarFolderConfig = {
  token: string;
  name: string;
  path: string;
  persistent?: boolean;
};

const AVATAR_FOLDER_STORAGE_KEY = "tweetFillerAvatarFolder";
const AVATAR_FOLDER_TOKEN_KEY = "tweetFillerAvatarFolderToken";
const AVATAR_FOLDER_NAME_KEY = "tweetFillerAvatarFolderName";
const AVATAR_FOLDER_AUTO_KEY = "tweetFillerAutoLatestAvatar";

let rememberedAvatarFolder: AvatarFolderConfig | null = null;

const normalizeAvatarFolder = (value: Partial<AvatarFolderConfig> | null | undefined): AvatarFolderConfig | null => {
  if (!value?.token) return null;
  return {
    token: String(value.token),
    name: String(value.name ?? "Avatar folder"),
    path: String(value.path ?? value.name ?? "Avatar folder"),
    persistent: Boolean(value.persistent),
  };
};

const readStoredAvatarFolder = (): AvatarFolderConfig | null => {
  try {
    const stored = window.localStorage.getItem(AVATAR_FOLDER_STORAGE_KEY);
    if (stored) {
      const parsed = normalizeAvatarFolder(JSON.parse(stored) as Partial<AvatarFolderConfig>);
      if (parsed) {
        rememberedAvatarFolder = parsed;
        return parsed;
      }
    }

    const legacyToken = window.localStorage.getItem(AVATAR_FOLDER_TOKEN_KEY);
    if (legacyToken) {
      const legacyName = window.localStorage.getItem(AVATAR_FOLDER_NAME_KEY) || "Avatar folder";
      rememberedAvatarFolder = { token: legacyToken, name: legacyName, path: legacyName };
      return rememberedAvatarFolder;
    }
  } catch (_) {}

  return rememberedAvatarFolder;
};

const writeStoredAvatarFolder = (folder: AvatarFolderConfig) => {
  rememberedAvatarFolder = normalizeAvatarFolder(folder);
  if (!rememberedAvatarFolder) return;
  try {
    window.localStorage.setItem(AVATAR_FOLDER_STORAGE_KEY, JSON.stringify(rememberedAvatarFolder));
    window.localStorage.setItem(AVATAR_FOLDER_TOKEN_KEY, rememberedAvatarFolder.token);
    window.localStorage.setItem(AVATAR_FOLDER_NAME_KEY, rememberedAvatarFolder.name);
  } catch (_) {}
};

const readStoredAutoLatestAvatar = (): boolean => {
  try {
    return window.localStorage.getItem(AVATAR_FOLDER_AUTO_KEY) !== "false";
  } catch (_) {
    return true;
  }
};
function safeName(value: string): string {
  return String(value || "tweet")
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "tweet";
}

export const TweetFillerTool = ({ api }: { api: API }) => {
  const [multiMode, setMultiMode] = useState(false);
  const [pasteInput, setPasteInput] = useState("");
  const [multiInputs, setMultiInputs] = useState<string[]>(["", "", ""]);
  const [tweetCount, setTweetCount] = useState(3);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [body, setBody] = useState("");
  const [showBadge, setShowBadge] = useState(true);
  const initialAvatarFolder = readStoredAvatarFolder();
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarName, setAvatarName] = useState<string | null>(null);
  const [avatarFolderToken, setAvatarFolderToken] = useState<string | null>(() => initialAvatarFolder?.token ?? null);
  const [avatarFolderName, setAvatarFolderName] = useState<string | null>(() => initialAvatarFolder?.name ?? null);
  const [autoLatestAvatar, setAutoLatestAvatar] = useState(() => Boolean(initialAvatarFolder?.token) && readStoredAutoLatestAvatar());
  const [showSpacing, setShowSpacing] = useState(false);
  const [badgeGap, setBadgeGap] = useState(6);
  const [badgeOffY, setBadgeOffY] = useState(0);
  const [bodyToRT, setBodyToRT] = useState(45);
  const [rtToEdge, setRtToEdge] = useState(45);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;

    const restoreAvatarFolder = async (attempt: number) => {
      try {
        let storedFolder = await (api as any).getTweetAvatarFolder();
        if (!storedFolder) storedFolder = readStoredAvatarFolder();
        storedFolder = normalizeAvatarFolder(storedFolder);
        if (cancelled) return;

        if (!storedFolder?.token) {
          if (attempt < 2) {
            retryTimer = window.setTimeout(() => restoreAvatarFolder(attempt + 1), 250);
          }
          return;
        }

        writeStoredAvatarFolder(storedFolder);
        setAvatarFolderToken(storedFolder.token);
        setAvatarFolderName(storedFolder.name);
        if (readStoredAutoLatestAvatar()) setAutoLatestAvatar(true);
      } catch (e: any) {
        if (cancelled) return;
        if (attempt < 2) {
          retryTimer = window.setTimeout(() => restoreAvatarFolder(attempt + 1), 250);
        } else {
          setStatus("Avatar folder restore error: " + (e?.message ?? String(e)));
        }
      }
    };

    restoreAvatarFolder(0);
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [api]);

  const pickLatestAvatar = async (quiet = false, folderTokenOverride?: string | null): Promise<boolean> => {
    const token = folderTokenOverride ?? avatarFolderToken;
    if (!token) {
      if (!quiet) setStatus("Choose an avatar folder first.");
      return false;
    }

    try {
      const latest = await (api as any).selectLatestTweetAvatarFromFolder(token);
      if (!latest) {
        if (!quiet) setStatus("No image files found in the avatar folder.");
        return false;
      }
      setAvatarPath(latest.token);
      setAvatarName(`Latest: ${latest.name}`);
      if (!quiet) setStatus(`Latest avatar selected: ${latest.name}`);
      return true;
    } catch (e: any) {
      if (!quiet) setStatus("Error: " + (e?.message ?? String(e)));
      return false;
    }
  };

  const chooseAvatarFolder = async () => {
    try {
      const picked = await (api as any).selectTweetAvatarFolder();
      if (!picked) return;
      setAvatarFolderToken(picked.token);
      setAvatarFolderName(picked.name);
      setAutoLatestAvatar(true);
      writeStoredAvatarFolder(picked);
      try { window.localStorage.setItem(AVATAR_FOLDER_AUTO_KEY, "true"); } catch (_) {}
      try {
        await (api as any).setTweetAvatarFolder?.(picked);
      } catch (_) {}
      if (!multiMode) await pickLatestAvatar(false, picked.token);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    }
  };

  const doParse = async () => {
    const parsed = parseInput(pasteInput);
    setName(parsed.name);
    setHandle(parsed.handle);
    setBody(parsed.text);

    if (autoLatestAvatar && avatarFolderToken) {
      const picked = await pickLatestAvatar(true);
      setStatus(picked ? "Parsed and latest avatar selected." : "Parsed. No avatar found in folder.");
    } else {
      setStatus(null);
    }
  };

  const parsedMultiTweets = () => multiInputs
    .slice(0, tweetCount)
    .map(parseInput)
    .filter(tweet => tweet.text.trim());

  const parseAll = () => {
    const parsed = parsedMultiTweets();
    setStatus(`Parsed ${parsed.length} tweet${parsed.length === 1 ? "" : "s"}.`);
  };

  const setMultiCount = (value: number) => {
    const nextCount = Math.max(1, Math.min(50, value || 1));
    setTweetCount(nextCount);
    setMultiInputs(prev => Array.from({ length: nextCount }, (_, index) => prev[index] ?? ""));
  };

  const setMultiInput = (index: number, value: string) => {
    setMultiInputs(prev => {
      const next = Array.from({ length: tweetCount }, (_, i) => prev[i] ?? "");
      next[index] = value;
      return next;
    });
  };

  const runSingle = async () => {
    if (!handle) { setStatus("Handle is required."); return; }
    if (!body) { setStatus("Tweet body is required."); return; }
    setRunning(true);
    setStatus(null);
    try {
      let avatarToken = avatarPath;
      if (autoLatestAvatar && avatarFolderToken) {
        const latest = await (api as any).selectLatestTweetAvatarFromFolder(avatarFolderToken);
        if (latest) {
          avatarToken = latest.token;
          setAvatarPath(latest.token);
          setAvatarName(`Latest: ${latest.name}`);
        }
      }

      const result = await api.runTweetFiller({
        displayName: name,
        handle,
        tweetBody: body,
        showVerifiedBadge: showBadge,
        badgeGap,
        badgeOffY,
        bodyToRT,
        rtToEdge,
        ...(avatarToken ? { avatarToken } : {}),
      });
      setStatus(result);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const runBatch = async () => {
    const parsed = parsedMultiTweets();
    if (!parsed.length) { setStatus("Paste at least one tweet."); return; }

    setRunning(true);
    setStatus(null);
    try {
      const notes: string[] = [];
      const tweets = [];
      for (let index = 0; index < parsed.length; index++) {
        const tweet = parsed[index];
        let avatarToken = "";
        if (autoLatestAvatar && avatarFolderToken && tweet.handle) {
          const match = await (api as any).selectTweetAvatarForHandleFromFolder(avatarFolderToken, tweet.handle);
          if (match) avatarToken = match.token;
          else notes.push(`tweet_${index + 1}: no avatar match for ${tweet.handle}`);
        }
        tweets.push({
          displayName: tweet.name,
          handle: tweet.handle,
          tweetBody: tweet.text,
          showVerifiedBadge: showBadge,
          badgeGap,
          badgeOffY,
          bodyToRT,
          rtToEdge,
          ...(avatarToken ? { avatarToken } : {}),
          outputName: `tweet_${index + 1}_${safeName(tweet.handle || tweet.name)}`,
        });
      }

      const result = await (api as any).runTweetFillerBatch({ tweets });
      setStatus(result + (notes.length ? "\n" + notes.join("\n") : ""));
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  return (
    <div className="tool-panel tweet-filler-tool">
      <label className="checkbox-row">
        <input type="checkbox" checked={multiMode} onChange={e => setMultiMode(e.target.checked)} />
        Multiple tweets
      </label>

      {!multiMode ? (
        <>
          <textarea
            value={pasteInput}
            onChange={e => setPasteInput(e.target.value)}
            placeholder={"Paste JSON or 3 lines:\nDisplay Name\n@handle\nTweet text"}
            rows={4}
          />
          <button className="secondary-btn" onClick={doParse}>Parse -&gt;</button>

          <div className="field-row">
            <label>Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Display Name" />
          </div>
          <div className="field-row">
            <label>Handle</label>
            <input type="text" value={handle} onChange={e => setHandle(e.target.value)} placeholder="@handle" />
          </div>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Tweet text"
            rows={4}
          />
        </>
      ) : (
        <>
          <div className="field-row">
            <label>Tweet count</label>
            <input className="input-narrow" type="number" min={1} max={50} value={tweetCount} onChange={e => setMultiCount(+e.target.value)} />
          </div>
          <div className="tweet-multi-list">
            {Array.from({ length: tweetCount }, (_, index) => (
              <textarea
                key={index}
                value={multiInputs[index] ?? ""}
                onChange={e => setMultiInput(index, e.target.value)}
                placeholder={`Tweet ${index + 1} JSON or text`}
                rows={4}
              />
            ))}
          </div>
          <button className="secondary-btn" onClick={parseAll}>Parse all</button>
        </>
      )}

      <div className="tweet-meta-row">
        <label className="checkbox-row">
          <input type="checkbox" checked={showBadge} onChange={e => setShowBadge(e.target.checked)} />
          Verified badge
        </label>
        {!multiMode && (
          <button
            className="secondary-btn"
            onClick={async () => {
              const token = await api.selectAvatarFile();
              if (token) {
                setAutoLatestAvatar(false);
                setAvatarPath(token);
                setAvatarName("Avatar selected");
              }
            }}
          >
            {avatarName ?? "Choose Avatar"}
          </button>
        )}
      </div>

      <div className="tweet-avatar-row">
        <label className="checkbox-row">
          <input type="checkbox" checked={autoLatestAvatar} onChange={e => {
            setAutoLatestAvatar(e.target.checked);
            try { window.localStorage.setItem(AVATAR_FOLDER_AUTO_KEY, String(e.target.checked)); } catch (_) {}
          }} />
          {multiMode ? "Match avatars by handle" : "Auto latest avatar"}
        </label>
        <button className="secondary-btn" onClick={chooseAvatarFolder}>
          {avatarFolderName ?? "Avatar folder"}
        </button>
        {!multiMode && (
          <button className="secondary-btn" onClick={() => pickLatestAvatar(false)} disabled={!avatarFolderToken}>
            Use latest
          </button>
        )}
      </div>

      <button className="secondary-btn" onClick={() => setShowSpacing(v => !v)}>
        Spacing {showSpacing ? "up" : "down"}
      </button>

      {showSpacing && (
        <div className="spacing-grid">
          <span className="spacing-label">Badge gap</span>
          <input type="number" value={badgeGap} onChange={e => setBadgeGap(+e.target.value)} className="input-narrow" />
          <span className="spacing-label">Badge V offset</span>
          <input type="number" value={badgeOffY} onChange={e => setBadgeOffY(+e.target.value)} className="input-narrow" />
          <span className="spacing-label">Body to RT</span>
          <input type="number" value={bodyToRT} onChange={e => setBodyToRT(+e.target.value)} className="input-narrow" />
          <span className="spacing-label">RT to edge</span>
          <input type="number" value={rtToEdge} onChange={e => setRtToEdge(+e.target.value)} className="input-narrow" />
        </div>
      )}

      <button className="run-btn" onClick={multiMode ? runBatch : runSingle} disabled={running}>
        {running ? "Running..." : multiMode ? "Parse all + Fill + Auto-layout" : "Fill + Auto-layout"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
