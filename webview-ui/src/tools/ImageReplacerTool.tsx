import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type InputMode = "list" | "fields";

interface ImageReplacerPayload {
  prefix: string;
  names: string[];
  folderToken?: string;
  fileTokens?: string[];
  recurse: boolean;
  makeUnique: boolean;
  removeBackground?: boolean;
}

interface MissingImage {
  index: number;
  targetLayerName: string;
  name: string;
  reason: string;
  matchedFileName?: string;
}

interface ManualRow {
  name: string;
  fileToken?: string;
  fileName?: string;
}

const stripExtension = (value: string) => value.replace(/\.[a-z0-9]+$/i, "");

export const ImageReplacerTool = ({ api }: { api: API }) => {
  const [prefix, setPrefix] = useState("player_");
  const [inputMode, setInputMode] = useState<InputMode>("list");
  const [folderToken, setFolderToken] = useState("");
  const [folderLabel, setFolderLabel] = useState<string | null>(null);
  const [namesText, setNamesText] = useState("");
  const [manualCountText, setManualCountText] = useState("11");
  const [manualRows, setManualRows] = useState<ManualRow[]>(
    Array.from({ length: 11 }, () => ({ name: "" }))
  );
  const [recurse, setRecurse] = useState(true);
  const [makeUnique, setMakeUnique] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [missingRows, setMissingRows] = useState<MissingImage[]>([]);
  const [overrideNames, setOverrideNames] = useState<Record<number, string>>({});
  const [skipMissing, setSkipMissing] = useState<Record<number, boolean>>({});
  const [lastPayload, setLastPayload] = useState<ImageReplacerPayload | null>(null);

  const clearMissing = () => {
    setMissingRows([]);
    setOverrideNames({});
    setSkipMissing({});
    setLastPayload(null);
  };

  const names = () => {
    const parsed = namesText
      .split(/\r?\n|,/)
      .map(name => name.trim());
    while (parsed.length && !parsed[parsed.length - 1]) parsed.pop();
    return parsed;
  };

  const manualCount = () => {
    const parsed = parseInt(manualCountText, 10);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 0;
  };

  const resizeManualRows = (count: number) => {
    setManualRows(prev => Array.from({ length: count }, (_, index) => prev[index] ?? { name: "" }));
  };

  const chooseFolder = async () => {
    try {
      const picked = await (api as any).selectImageReplacerFolder();
      if (!picked) return;
      setFolderToken(picked.token);
      setFolderLabel(picked.path || picked.name);
      clearMissing();
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    }
  };

  const chooseManualFile = async (index: number) => {
    try {
      const picked = await (api as any).selectImageReplacerFile();
      if (!picked) return;
      setManualRows(prev => {
        const next = [...prev];
        const current = next[index] ?? { name: "" };
        next[index] = {
          ...current,
          fileToken: picked.token,
          fileName: picked.name,
          name: current.name.trim() || stripExtension(picked.name),
        };
        return next;
      });
      clearMissing();
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    }
  };

  const buildPayload = (): ImageReplacerPayload | null => {
    if (!prefix.trim()) {
      setStatus("Enter a layer prefix.");
      return null;
    }

    if (inputMode === "list") {
      const assetNames = names();
      if (!folderToken) {
        setStatus("Choose an image folder first.");
        return null;
      }
      if (!assetNames.some(Boolean)) {
        setStatus("Enter at least one player name.");
        return null;
      }

      return {
        prefix: prefix.trim(),
        names: assetNames,
        folderToken,
        fileTokens: [],
        recurse,
        makeUnique,
        removeBackground,
      };
    }

    const count = manualCount();
    if (!count) {
      setStatus("Enter how many selections to use.");
      return null;
    }

    const rows = manualRows.slice(0, count);
    const fileTokens = rows.map(row => row.fileToken ?? "");
    if (!fileTokens.some(Boolean)) {
      setStatus("Choose at least one image file.");
      return null;
    }

    return {
      prefix: prefix.trim(),
      names: rows.map(row => row.name.trim() || stripExtension(row.fileName ?? "")),
      folderToken: "",
      fileTokens,
      recurse: false,
      makeUnique,
      removeBackground,
    };
  };

  const runPayload = async (payload: ImageReplacerPayload, preflight: boolean) => {
    if (preflight) {
      const result = await (api as any).preflightImageReplacer(payload);
      if (result.missing.length) {
        const nextOverrides: Record<number, string> = {};
        const nextSkips: Record<number, boolean> = {};
        result.missing.forEach((issue: MissingImage) => {
          nextOverrides[issue.index] = overrideNames[issue.index] ?? issue.name;
          nextSkips[issue.index] = true;
        });

        setLastPayload(payload);
        setMissingRows(result.missing);
        setOverrideNames(nextOverrides);
        setSkipMissing(nextSkips);
        setStatus(
          `Found ${result.missing.length} issue${result.missing.length === 1 ? "" : "s"} before running.`
        );
        return;
      }
    }

    clearMissing();
    const result = await (api as any).runImageReplacer(payload);
    setStatus(result);
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    clearMissing();
    try {
      const payload = buildPayload();
      if (payload) await runPayload(payload, true);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const retryMissing = async () => {
    if (!lastPayload) return;
    setRunning(true);
    setStatus(null);
    try {
      const nextNames = [...lastPayload.names];
      missingRows.forEach(issue => {
        nextNames[issue.index] = (overrideNames[issue.index] ?? issue.name).trim();
      });
      await runPayload({ ...lastPayload, names: nextNames }, true);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
    }
  };

  const runSkippingMissing = async () => {
    if (!lastPayload) return;
    setRunning(true);
    setStatus(null);
    try {
      const nextNames = [...lastPayload.names];
      const nextTokens = [...(lastPayload.fileTokens ?? [])];
      missingRows.forEach(issue => {
        if (skipMissing[issue.index]) {
          nextNames[issue.index] = "";
          nextTokens[issue.index] = "";
        }
      });
      await runPayload({ ...lastPayload, names: nextNames, fileTokens: nextTokens }, false);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="tool-panel image-replacer-tool expanding-tool">
      <div className="field-row">
        <label>Prefix</label>
        <input
          type="text"
          value={prefix}
          onChange={e => {
            setPrefix(e.target.value);
            clearMissing();
          }}
          placeholder="player_"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <button
          className={inputMode === "list" ? "run-btn" : "secondary-btn"}
          onClick={() => {
            setInputMode("list");
            clearMissing();
          }}
          type="button"
        >
          List
        </button>
        <button
          className={inputMode === "fields" ? "run-btn" : "secondary-btn"}
          onClick={() => {
            setInputMode("fields");
            clearMissing();
          }}
          type="button"
        >
          Per field
        </button>
      </div>

      {inputMode === "list" ? (
        <>
          <div className="field-row image-folder-row">
            <label>Folder</label>
            <button className="secondary-btn image-browse-btn" onClick={chooseFolder}>
              Browse
            </button>
            {folderLabel && <span className="file-name">{folderLabel}</span>}
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={recurse}
              onChange={e => {
                setRecurse(e.target.checked);
                clearMissing();
              }}
            />
            Search subfolders
          </label>

          <textarea
            className="large-textarea"
            value={namesText}
            onChange={e => {
              setNamesText(e.target.value);
              clearMissing();
            }}
            placeholder={"One player per line, matching detected layers in order:\nErling Haaland\nBukayo Saka\nMohamed Salah"}
            rows={9}
          />
        </>
      ) : (
        <>
          <div className="field-row">
            <label>Selections</label>
            <input
              type="number"
              min={1}
              max={200}
              value={manualCountText}
              onChange={e => {
                const value = e.target.value;
                setManualCountText(value);
                const parsed = parseInt(value, 10);
                if (Number.isFinite(parsed) && parsed > 0) {
                  resizeManualRows(Math.min(200, parsed));
                  clearMissing();
                }
              }}
            />
          </div>

          <div className="grow-scroll-list image-manual-list">
            {manualRows.slice(0, manualCount()).map((row, index) => (
              <div key={index} className="image-manual-row">
                <span className="image-manual-target">{prefix || "layer_"}{index + 1}</span>
                <input
                  type="text"
                  value={row.name}
                  onChange={e => {
                    const value = e.target.value;
                    setManualRows(prev => {
                      const next = [...prev];
                      next[index] = { ...(next[index] ?? {}), name: value };
                      return next;
                    });
                    clearMissing();
                  }}
                  placeholder={row.fileName ? stripExtension(row.fileName) : "Name"}
                />
                <button className="secondary-btn image-browse-btn" type="button" onClick={() => chooseManualFile(index)}>
                  Browse
                </button>
                {row.fileName && (
                  <span className="file-name" style={{ gridColumn: "2 / 4" }}>
                    {row.fileName}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={makeUnique}
          onChange={e => setMakeUnique(e.target.checked)}
        />
        Make Smart Objects unique first
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={removeBackground}
          onChange={e => setRemoveBackground(e.target.checked)}
        />
        Remove background before replace
      </label>

      {missingRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid #333", paddingTop: "10px" }}>
          <span className="section-label">Missing images</span>
          {missingRows.map(issue => (
            <div key={`${issue.index}-${issue.targetLayerName}-${issue.reason}`} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <label className="checkbox-row" style={{ flex: "0 0 52px", paddingTop: "5px" }}>
                <input
                  type="checkbox"
                  checked={skipMissing[issue.index] ?? true}
                  onChange={e => setSkipMissing(prev => ({ ...prev, [issue.index]: e.target.checked }))}
                />
                Skip
              </label>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ fontSize: "10px", color: "#aaa" }}>
                  {issue.targetLayerName}: {issue.reason}
                </div>
                <input
                  type="text"
                  value={overrideNames[issue.index] ?? issue.name}
                  onChange={e => setOverrideNames(prev => ({ ...prev, [issue.index]: e.target.value }))}
                  style={{
                    width: "100%",
                    background: "#2a2a2a",
                    border: "1px solid #3a3a3a",
                    borderRadius: "4px",
                    color: "#fff",
                    fontSize: "11px",
                    padding: "5px 8px",
                  }}
                />
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="secondary-btn" style={{ flex: 1 }} onClick={retryMissing} disabled={running}>
              Retry names
            </button>
            <button className="run-btn" style={{ flex: 1 }} onClick={runSkippingMissing} disabled={running}>
              Run skipping selected
            </button>
          </div>
        </div>
      )}

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Running..." : "Run"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
