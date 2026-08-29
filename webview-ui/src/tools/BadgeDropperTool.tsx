import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type Mode = "club" | "national" | "flag";
type InputMode = "list" | "csv";
type ClubBadgeStyle = "regular" | "square" | "dark" | "light";
type FlagStyle = "square" | "rect";
type FitMode = "height" | "contain" | "cover";

interface CsvRow {
  badge: string;
  flag: string;
  name: string;
}

interface BadgeDropperPayload {
  mode: Mode;
  clubBadgeStyle: ClubBadgeStyle;
  flagStyle: FlagStyle;
  targetPrefix: string;
  startIndex: number;
  names: string[];
  textValues?: string[];
  keepBaseVisible: boolean;
  clipToBase: boolean;
  fitMode: FitMode;
  autoDetectTargetCount: boolean;
}

interface MissingAsset {
  index: number;
  targetLayerName: string;
  name: string;
  reason: string;
  relativePath?: string;
  fullPath?: string;
}

export const BadgeDropperTool = ({ api }: { api: API }) => {
  const [mode, setMode] = useState<Mode>("club");
  const [inputMode, setInputMode] = useState<InputMode>("list");
  const [clubBadgeStyle, setClubBadgeStyle] = useState<ClubBadgeStyle>("regular");
  const [flagStyle, setFlagStyle] = useState<FlagStyle>("square");
  const [targetPrefix, setTargetPrefix] = useState("shape_");
  const [startIndex, setStartIndex] = useState(1);
  const [autoDetectTargetCount, setAutoDetectTargetCount] = useState(true);
  const [namesText, setNamesText] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>("height");
  const [keepBaseVisible, setKeepBaseVisible] = useState(false);
  const [clipToBase, setClipToBase] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [missingRows, setMissingRows] = useState<MissingAsset[]>([]);
  const [overrideNames, setOverrideNames] = useState<Record<number, string>>({});
  const [skipMissing, setSkipMissing] = useState<Record<number, boolean>>({});
  const [lastPayload, setLastPayload] = useState<BadgeDropperPayload | null>(null);

  const clearMissing = () => {
    setMissingRows([]);
    setOverrideNames({});
    setSkipMissing({});
    setLastPayload(null);
  };

  const selectMode = (nextMode: Mode) => {
    setMode(nextMode);
    const shouldUseBase = nextMode === "flag";
    setKeepBaseVisible(shouldUseBase);
    setClipToBase(shouldUseBase);
    clearMissing();
  };

  const selectClubBadgeStyle = (style: ClubBadgeStyle) => {
    setClubBadgeStyle(style);
    const shouldUseBase = style === "square";
    setKeepBaseVisible(shouldUseBase);
    setClipToBase(shouldUseBase);
    clearMissing();
  };

  const names = () =>
    namesText
      .split(/\r?\n|,/)
      .map(name => name.trim());

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      setCsvText((evt.target?.result as string) ?? "");
      setCsvFileName(file.name);
      clearMissing();
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const parseCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }

    cells.push(current.trim());
    return cells;
  };

  const parseBadgeCsv = (raw: string): CsvRow[] => {
    const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const firstLine = lines.findIndex(line => line.trim());
    if (firstLine < 0) return [];

    const headers = parseCsvLine(lines[firstLine]);
    const normaliseHeader = (header: string) =>
      header.trim().replace(/["']/g, "").replace(/\s+/g, "").replace(/\//g, "").toUpperCase();

    let badgeIndex = -1;
    let flagIndex = -1;
    let nameIndex = -1;

    headers.forEach((header, index) => {
      const key = normaliseHeader(header);
      if (badgeIndex < 0 && (key === "BADGEFLAG" || key === "BADGE")) badgeIndex = index;
      if (flagIndex < 0 && (key === "BADGEFLAG" || key === "FLAG")) flagIndex = index;
      if (nameIndex < 0 && key === "NAME") nameIndex = index;
    });

    if (badgeIndex < 0 && flagIndex < 0) {
      throw new Error("Could not find BADGE, FLAG or BADGE/FLAG column.");
    }

    const rows: CsvRow[] = [];
    for (let i = firstLine + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = parseCsvLine(lines[i]);
      const row = {
        badge: badgeIndex >= 0 ? (cells[badgeIndex] ?? "").trim() : "",
        flag: flagIndex >= 0 ? (cells[flagIndex] ?? "").trim() : "",
        name: nameIndex >= 0 ? (cells[nameIndex] ?? "").trim() : "",
      };
      if (row.badge || row.flag || row.name) rows.push(row);
    }

    return rows;
  };

  const buildPayload = (): BadgeDropperPayload | null => {
    let assetNames = names();
    let textValues: string[] | undefined;

    if (inputMode === "csv") {
      const rows = parseBadgeCsv(csvText);
      if (!rows.length) {
        setStatus("CSV has no usable data rows.");
        return null;
      }

      assetNames = rows.map(row => mode === "flag" ? (row.flag || row.badge) : (row.badge || row.flag));
      textValues = rows.map(row => row.name);
    }

    return {
      mode,
      clubBadgeStyle,
      flagStyle,
      targetPrefix,
      startIndex,
      names: assetNames,
      textValues,
      keepBaseVisible,
      clipToBase,
      fitMode,
      autoDetectTargetCount,
    };
  };

  const runPayload = async (payload: BadgeDropperPayload, preflight: boolean) => {
    if (preflight) {
      const result = await (api as any).preflightBadgeDropper(payload);
      if (result.detectedCount === 0) {
        setStatus(`Auto-detect found no target layers matching ${payload.targetPrefix}${payload.startIndex}.`);
        setLastPayload(payload);
        setMissingRows([]);
        return;
      }

      if (result.missing.length) {
        const nextOverrides: Record<number, string> = {};
        const nextSkips: Record<number, boolean> = {};
        result.missing.forEach((issue: MissingAsset) => {
          nextOverrides[issue.index] = overrideNames[issue.index] ?? issue.name;
          nextSkips[issue.index] = true;
        });

        setLastPayload(payload);
        setMissingRows(result.missing);
        setOverrideNames(nextOverrides);
        setSkipMissing(nextSkips);
        setStatus(
          `Found ${result.missing.length} missing asset${result.missing.length === 1 ? "" : "s"} before running.`
        );
        return;
      }
    }

    clearMissing();
    const result = await (api as any).runBadgeDropper(payload);
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
      missingRows.forEach(issue => {
        if (skipMissing[issue.index]) nextNames[issue.index] = "";
      });
      await runPayload({ ...lastPayload, names: nextNames }, false);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="tool-panel badge-dropper-tool expanding-tool">
      <div className="field-row">
        <label>Type</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {(["club", "national", "flag"] as Mode[]).map(m => (
            <button
              key={m}
              className={`mode-tab${mode === m ? " active" : ""}`}
              onClick={() => selectMode(m)}
            >
              {m === "club" ? "Club" : m === "national" ? "National" : "Flag"}
            </button>
          ))}
        </div>
      </div>

      {mode === "flag" && (
        <div className="field-row">
          <label>Flag</label>
          <div className="mode-tabs" style={{ flex: 1 }}>
            {(["square", "rect"] as FlagStyle[]).map(m => (
              <button
                key={m}
                className={`mode-tab${flagStyle === m ? " active" : ""}`}
                onClick={() => {
                  setFlagStyle(m);
                  clearMissing();
                }}
              >
                {m === "square" ? "Square" : "Rect"}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "club" && (
        <div className="field-row">
          <label>Badge</label>
          <div className="mode-tabs" style={{ flex: 1 }}>
            {(["regular", "square", "dark", "light"] as ClubBadgeStyle[]).map(style => (
              <button
                key={style}
                className={`mode-tab${clubBadgeStyle === style ? " active" : ""}`}
                onClick={() => selectClubBadgeStyle(style)}
              >
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field-row">
        <label>Target</label>
        <input
          type="text"
          value={targetPrefix}
          onChange={e => {
            setTargetPrefix(e.target.value);
            clearMissing();
          }}
          placeholder="shape_"
        />
        <input
          type="number"
          className="input-narrow"
          min={1}
          value={startIndex}
          onChange={e => {
            setStartIndex(Math.max(1, +e.target.value || 1));
            clearMissing();
          }}
        />
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={autoDetectTargetCount}
          onChange={e => setAutoDetectTargetCount(e.target.checked)}
        />
        Auto-detect targets
      </label>

      <div className="field-row">
        <label>Input</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {(["list", "csv"] as InputMode[]).map(m => (
            <button
              key={m}
              className={`mode-tab${inputMode === m ? " active" : ""}`}
              onClick={() => {
                setInputMode(m);
                clearMissing();
              }}
            >
              {m === "list" ? "List" : "CSV"}
            </button>
          ))}
        </div>
      </div>

      {inputMode === "list" && (
        <textarea
          className="large-textarea"
          value={namesText}
          onChange={e => {
            setNamesText(e.target.value);
            clearMissing();
          }}
          placeholder={"One per line, matching target layers in order:\nLeeds\nManchester United\nArsenal"}
          rows={7}
        />
      )}

      {inputMode === "csv" && (
        <>
          <div className="field-row">
            <label>CSV</label>
            <label className="file-btn">
              Browse...
              <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleCsvFile} />
            </label>
            {csvFileName && <span className="file-name">{csvFileName}</span>}
          </div>
          <textarea
            className="large-textarea"
            value={csvText}
            onChange={e => {
              setCsvText(e.target.value);
              clearMissing();
            }}
            placeholder={
              mode === "flag"
                ? "Columns: FLAG or BADGE/FLAG, optional NAME\n\nFLAG,NAME\nEngland,Player name"
                : "Columns: BADGE or BADGE/FLAG, optional NAME\n\nBADGE,NAME\nLeeds,Player name"
            }
            rows={7}
          />
        </>
      )}

      <div className="field-row">
        <label>Fit</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {(["height", "contain", "cover"] as FitMode[]).map(m => (
            <button
              key={m}
              className={`mode-tab${fitMode === m ? " active" : ""}`}
              onClick={() => setFitMode(m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={keepBaseVisible}
          onChange={e => setKeepBaseVisible(e.target.checked)}
        />
        Keep base layer visible
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={clipToBase}
          onChange={e => setClipToBase(e.target.checked)}
        />
        Clip inserted asset to base
      </label>

      {missingRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid #333", paddingTop: "10px" }}>
          <span className="section-label">Missing assets</span>
          {missingRows.map(issue => (
            <div key={`${issue.index}-${issue.targetLayerName}`} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
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
                {issue.relativePath && (
                  <div style={{ fontSize: "9px", color: "#666", wordBreak: "break-word" }}>{issue.relativePath}</div>
                )}
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
