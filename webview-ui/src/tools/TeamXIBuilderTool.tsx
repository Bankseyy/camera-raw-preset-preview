import React, { useMemo, useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type InputMode = "fields" | "list" | "build" | "rename";

const FORMATIONS: Record<string, string[]> = {
  "4-3-3": ["GK", "RB", "RCB", "LCB", "LB", "CM1", "CM2", "CM3", "RW", "ST", "LW"],
  "4-2-3-1": ["GK", "RB", "RCB", "LCB", "LB", "CDM1", "CDM2", "CAM", "RW", "ST", "LW"],
  "4-4-2": ["GK", "RB", "RCB", "LCB", "LB", "RM", "CM1", "CM2", "LM", "ST1", "ST2"],
  "3-5-2": ["GK", "CB1", "CB2", "CB3", "RWB", "LWB", "CM1", "CM2", "CAM", "ST1", "ST2"],
  "3-4-3": ["GK", "CB1", "CB2", "CB3", "RWB", "CM1", "CM2", "LWB", "RW", "ST", "LW"],
};

interface RowState {
  name: string;
  fileToken?: string;
  fileName?: string;
}

interface TeamXIPayload {
  formation: string;
  entries: Array<{ pos: string; name: string; fileToken?: string }>;
  folderToken?: string;
  advancedMode: boolean;
  recurse: boolean;
  excludeTransfers: boolean;
  limitImagesToGroup: boolean;
  limitNamesToGroup: boolean;
  makeUnique: boolean;
  removeBackground?: boolean;
}

interface TeamXIFormationPayload {
  formation: string;
  gkAtTop: boolean;
  topMargin: number;
  sideMargin: number;
  useCustomGaps: boolean;
  horizontalGap: number;
  verticalGap: number;
}

interface TeamXICandidateChoice {
  token: string;
  fileName: string;
  folderLabel?: string;
  band: number;
}

interface TeamXIAmbiguousMatch {
  index: number;
  pos: string;
  name: string;
  candidates: TeamXICandidateChoice[];
}

interface TeamXIMissingMatch {
  index: number;
  pos: string;
  name: string;
  reason: string;
}

const emptyRows = () => Array.from({ length: 11 }, () => ({ name: "" }));

const stripExtension = (value: string) => value.replace(/\.[a-z0-9]+$/i, "");

export const TeamXIBuilderTool = ({ api }: { api: API }) => {
  const [formation, setFormation] = useState("4-3-3");
  const [inputMode, setInputMode] = useState<InputMode>("fields");
  const [rows, setRows] = useState<RowState[]>(emptyRows);
  const [listText, setListText] = useState("");
  const [folderToken, setFolderToken] = useState("");
  const [folderLabel, setFolderLabel] = useState<string | null>(null);
  const [advancedMode, setAdvancedMode] = useState(true);
  const [recurse, setRecurse] = useState(true);
  const [excludeTransfers, setExcludeTransfers] = useState(true);
  const [limitImagesToGroup, setLimitImagesToGroup] = useState(true);
  const [limitNamesToGroup, setLimitNamesToGroup] = useState(true);
  const [makeUnique, setMakeUnique] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [gkAtTop, setGkAtTop] = useState(false);
  const [topMargin, setTopMargin] = useState("80");
  const [sideMargin, setSideMargin] = useState("60");
  const [useCustomGaps, setUseCustomGaps] = useState(false);
  const [horizontalGap, setHorizontalGap] = useState("20");
  const [verticalGap, setVerticalGap] = useState("40");
  const [buildFormations, setBuildFormations] = useState<string[]>(["4-3-3"]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [ambiguousRows, setAmbiguousRows] = useState<TeamXIAmbiguousMatch[]>([]);
  const [missingRows, setMissingRows] = useState<TeamXIMissingMatch[]>([]);
  const [selectedCandidateTokens, setSelectedCandidateTokens] = useState<Record<number, string>>({});
  const [overrideNames, setOverrideNames] = useState<Record<number, string>>({});
  const [skipMissing, setSkipMissing] = useState<Record<number, boolean>>({});
  const [lastPayload, setLastPayload] = useState<TeamXIPayload | null>(null);

  const positions = FORMATIONS[formation];

  const clearPreflight = () => {
    setAmbiguousRows([]);
    setMissingRows([]);
    setSelectedCandidateTokens({});
    setOverrideNames({});
    setSkipMissing({});
    setLastPayload(null);
  };

  const listNames = useMemo(
    () =>
      listText
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split(/\n+/)
        .map(name => name.trim()),
    [listText]
  );

  const chooseFolder = async () => {
    try {
      const picked = await (api as any).selectTeamXIFolder();
      if (!picked) return;
      setFolderToken(picked.token);
      setFolderLabel(picked.path || picked.name);
      clearPreflight();
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    }
  };

  const chooseFile = async (index: number) => {
    try {
      const picked = await (api as any).selectTeamXIFile();
      if (!picked) return;
      setRows(prev => {
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
      clearPreflight();
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    }
  };

  const rowName = (index: number) =>
    inputMode === "list" ? (listNames[index] ?? "") : (rows[index]?.name ?? "");

  const buildPayload = (): TeamXIPayload | null => {
    if (advancedMode && !folderToken) {
      setStatus("Choose an image folder first.");
      return null;
    }

    const entries = positions.map((pos, index) => ({
      pos,
      name: rowName(index).trim(),
      fileToken: rows[index]?.fileToken,
    }));

    const hasAnyInput = entries.some(entry => entry.name || entry.fileToken);
    if (!hasAnyInput) {
      setStatus("Enter at least one player name or choose an image.");
      return null;
    }

    return {
      formation,
      entries,
      folderToken,
      advancedMode,
      recurse,
      excludeTransfers,
      limitImagesToGroup,
      limitNamesToGroup,
      makeUnique,
      removeBackground,
    };
  };

  const runPayload = async (payload: TeamXIPayload, preflight: boolean) => {
    if (preflight) {
      const result = await (api as any).preflightTeamXIBuilder(payload);
      if (result.ambiguous.length || result.missing.length) {
        const defaultTokens: Record<number, string> = {};
        const nextOverrides: Record<number, string> = {};
        const nextSkips: Record<number, boolean> = {};
        (result.ambiguous ?? []).forEach((match: TeamXIAmbiguousMatch) => {
          defaultTokens[match.index] = selectedCandidateTokens[match.index] ?? match.candidates[0]?.token ?? "";
        });
        (result.missing ?? []).forEach((match: TeamXIMissingMatch) => {
          nextOverrides[match.index] = overrideNames[match.index] ?? match.name;
          nextSkips[match.index] = true;
        });

        setLastPayload(payload);
        setAmbiguousRows(result.ambiguous ?? []);
        setMissingRows(result.missing ?? []);
        setSelectedCandidateTokens(defaultTokens);
        setOverrideNames(nextOverrides);
        setSkipMissing(nextSkips);

        const parts: string[] = [];
        if (result.missing?.length) parts.push(`${result.missing.length} missing image${result.missing.length === 1 ? "" : "s"}`);
        if (result.ambiguous?.length) parts.push(`${result.ambiguous.length} multiple-match choice${result.ambiguous.length === 1 ? "" : "s"}`);
        setStatus(`Found ${parts.join(" and ")} before running.`);
        return;
      }
    }

    clearPreflight();
    const result = await (api as any).runTeamXIBuilder(payload);
    setStatus(result);
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    clearPreflight();
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

  const runChosenMatches = async () => {
    if (!lastPayload) return;
    setRunning(true);
    setStatus(null);
    try {
      const entries = lastPayload.entries.map((entry, index) => ({
        ...entry,
        fileToken: selectedCandidateTokens[index] || entry.fileToken,
      }));

      setRows(prev => {
        const next = [...prev];
        ambiguousRows.forEach(match => {
          const token = selectedCandidateTokens[match.index];
          const candidate = match.candidates.find(item => item.token === token) ?? match.candidates[0];
          if (!candidate) return;
          next[match.index] = {
            ...(next[match.index] ?? { name: "" }),
            fileToken: candidate.token,
            fileName: candidate.fileName,
          };
        });
        return next;
      });

      await runPayload({ ...lastPayload, entries }, false);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const applySelectedCandidates = (entries: TeamXIPayload["entries"]) =>
    entries.map((entry, index) => ({
      ...entry,
      fileToken: selectedCandidateTokens[index] || entry.fileToken,
    }));

  const retryMissing = async () => {
    if (!lastPayload) return;
    setRunning(true);
    setStatus(null);
    try {
      const entries = applySelectedCandidates(
        lastPayload.entries.map((entry, index) => ({
          ...entry,
          name: missingRows.some(match => match.index === index)
            ? (overrideNames[index] ?? entry.name).trim()
            : entry.name,
        }))
      );
      await runPayload({ ...lastPayload, entries }, true);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const runSkippingMissing = async () => {
    if (!lastPayload) return;
    setRunning(true);
    setStatus(null);
    try {
      const entries = applySelectedCandidates(
        lastPayload.entries.map((entry, index) => {
          if (!skipMissing[index]) return entry;
          return { ...entry, name: "", fileToken: "" };
        })
      );
      await runPayload({ ...lastPayload, entries }, false);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const buildSelectedFormations = async () => {
    if (!buildFormations.length) {
      setStatus("Select at least one formation to build.");
      return;
    }

    const readMargin = (value: string, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    const payload: TeamXIFormationPayload[] = buildFormations.map(formationCode => ({
      formation: formationCode,
      gkAtTop,
      topMargin: readMargin(topMargin, 80),
      sideMargin: readMargin(sideMargin, 60),
      useCustomGaps,
      horizontalGap: readMargin(horizontalGap, 20),
      verticalGap: readMargin(verticalGap, 40),
    }));

    setRunning(true);
    setStatus(null);
    clearPreflight();
    try {
      const result = await (api as any).runTeamXIFormationBuilderBatch(payload);
      setStatus(result);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const renameExistingFormation = async () => {
    setRunning(true);
    setStatus(null);
    clearPreflight();
    try {
      const result = await (api as any).runTeamXIFormationNaming({ formation });
      setStatus(result);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  return (
    <div className="tool-panel team-xi-tool expanding-tool">
      <div className="field-row">
        <label>Formation</label>
        <select
          value={formation}
          onChange={e => {
            const nextFormation = e.target.value;
            setFormation(nextFormation);
            if (inputMode !== "build") setBuildFormations([nextFormation]);
          }}
        >
          {Object.keys(FORMATIONS).map(key => (
            <option key={key} value={key}>{key}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "8px" }}>
        <button
          className={inputMode === "fields" ? "run-btn" : "secondary-btn"}
          type="button"
          onClick={() => setInputMode("fields")}
        >
          Fields
        </button>
        <button
          className={inputMode === "list" ? "run-btn" : "secondary-btn"}
          type="button"
          onClick={() => setInputMode("list")}
        >
          Text list
        </button>
        <button
          className={inputMode === "build" ? "run-btn" : "secondary-btn"}
          type="button"
          onClick={() => setInputMode("build")}
        >
          Build
        </button>
        <button
          className={inputMode === "rename" ? "run-btn" : "secondary-btn"}
          type="button"
          onClick={() => setInputMode("rename")}
        >
          Rename
        </button>
      </div>

      {inputMode === "build" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {Object.keys(FORMATIONS).map(formationCode => (
              <label className="checkbox-row" key={formationCode}>
                <input
                  type="checkbox"
                  checked={buildFormations.includes(formationCode)}
                  onChange={e => setBuildFormations(previous => (
                    e.target.checked
                      ? [...new Set([...previous, formationCode])]
                      : previous.filter(item => item !== formationCode)
                  ))}
                />
                {formationCode}
              </label>
            ))}
          </div>

          <label className="checkbox-row">
            <input type="checkbox" checked={gkAtTop} onChange={e => setGkAtTop(e.target.checked)} />
            Goalkeeper at top
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={useCustomGaps} onChange={e => setUseCustomGaps(e.target.checked)} />
            Use custom position gaps
          </label>

          {useCustomGaps ? (
            <>
              <div className="field-row">
                <label>Horizontal gap (px)</label>
                <input
                  type="number"
                  min="0"
                  value={horizontalGap}
                  onChange={e => setHorizontalGap(e.target.value)}
                />
              </div>

              <div className="field-row">
                <label>Vertical gap (px)</label>
                <input
                  type="number"
                  min="0"
                  value={verticalGap}
                  onChange={e => setVerticalGap(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="field-row">
                <label>Top / bottom margin</label>
                <input
                  type="number"
                  min="0"
                  value={topMargin}
                  onChange={e => setTopMargin(e.target.value)}
                />
              </div>

              <div className="field-row">
                <label>Left / right margin</label>
                <input
                  type="number"
                  min="0"
                  value={sideMargin}
                  onChange={e => setSideMargin(e.target.value)}
                />
              </div>
            </>
          )}

          <button className="run-btn" type="button" onClick={buildSelectedFormations} disabled={running}>
            {running ? "Building..." : "Build formations"}
          </button>
        </>
      )}

      {inputMode === "rename" && (
        <button className="run-btn" type="button" onClick={renameExistingFormation} disabled={running}>
          {running ? "Renaming..." : "Rename formation targets"}
        </button>
      )}

      {inputMode !== "build" && inputMode !== "rename" && (
        <>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={advancedMode}
          onChange={e => setAdvancedMode(e.target.checked)}
        />
        Auto-pick images by filename
      </label>

      {advancedMode && (
        <>
          <div className="field-row">
            <label>Folder</label>
            <button className="secondary-btn" style={{ flex: "0 0 auto" }} onClick={chooseFolder}>
              Browse
            </button>
            {folderLabel && <span className="file-name">{folderLabel}</span>}
          </div>

          <label className="checkbox-row">
            <input type="checkbox" checked={recurse} onChange={e => setRecurse(e.target.checked)} />
            Search subfolders
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={excludeTransfers} onChange={e => setExcludeTransfers(e.target.checked)} />
            Exclude Transfers folder
          </label>
        </>
      )}

      <label className="checkbox-row">
        <input type="checkbox" checked={limitImagesToGroup} onChange={e => setLimitImagesToGroup(e.target.checked)} />
        Only update images in formation group
      </label>

      <label className="checkbox-row">
        <input type="checkbox" checked={limitNamesToGroup} onChange={e => setLimitNamesToGroup(e.target.checked)} />
        Only update names in formation group
      </label>

      <label className="checkbox-row">
        <input type="checkbox" checked={makeUnique} onChange={e => setMakeUnique(e.target.checked)} />
        Make Smart Objects unique first
      </label>

      <label className="checkbox-row">
        <input type="checkbox" checked={removeBackground} onChange={e => setRemoveBackground(e.target.checked)} />
        Remove background from each image before replace
      </label>

      {inputMode === "list" ? (
        <>
          <textarea
            className="large-textarea team-xi-list-input"
            value={listText}
            onChange={e => {
              setListText(e.target.value);
              clearPreflight();
            }}
            placeholder={`Paste one player per line:\n${positions.map(pos => `${pos}:`).join("\n")}`}
            rows={11}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "10px", color: "#888" }}>
            {positions.map((pos, index) => (
              <div key={pos}>{index + 1}. {pos}: {listNames[index] || "-"}</div>
            ))}
          </div>
        </>
      ) : (
        <div className="grow-scroll-list team-xi-fields">
          {positions.map((pos, index) => (
            <div key={pos} className="team-xi-player-row">
              <span className="team-xi-position-label">{pos}</span>
              <input
                type="text"
                value={rows[index]?.name ?? ""}
                onChange={e => {
                  const value = e.target.value;
                  setRows(prev => {
                    const next = [...prev];
                    next[index] = { ...(next[index] ?? {}), name: value };
                    return next;
                  });
                  clearPreflight();
                }}
                placeholder="Player name"
              />
              <button className="secondary-btn team-xi-image-btn" type="button" onClick={() => chooseFile(index)}>
                Image
              </button>
              {rows[index]?.fileName && (
                <span className="file-name team-xi-file-name">
                  {rows[index]?.fileName}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {inputMode === "list" && !advancedMode && (
        <div style={{ fontSize: "10px", color: "#888" }}>
          Text list mode updates names. Turn on filename search to replace photos from the pasted names.
        </div>
      )}

      {ambiguousRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid #333", paddingTop: "10px" }}>
          <span className="section-label">Choose image matches</span>
          {ambiguousRows.map(match => (
            <div key={`${match.index}-${match.pos}-${match.name}`} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ fontSize: "10px", color: "#aaa" }}>
                {match.pos}: {match.name}
              </div>
              <select
                value={selectedCandidateTokens[match.index] ?? match.candidates[0]?.token ?? ""}
                onChange={e => setSelectedCandidateTokens(prev => ({ ...prev, [match.index]: e.target.value }))}
              >
                {match.candidates.map(candidate => (
                  <option key={candidate.token} value={candidate.token}>
                    {candidate.fileName}{candidate.folderLabel ? ` - ${candidate.folderLabel}` : ""} ({candidate.band})
                  </option>
                ))}
              </select>
            </div>
          ))}
          {missingRows.length === 0 && (
            <button className="run-btn" type="button" onClick={runChosenMatches} disabled={running}>
              {running ? "Updating..." : "Run chosen matches"}
            </button>
          )}
        </div>
      )}

      {missingRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid #333", paddingTop: "10px" }}>
          <span className="section-label">Missing images</span>
          {missingRows.map(match => (
            <div key={`${match.index}-${match.pos}-${match.name}`} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <label className="checkbox-row" style={{ flex: "0 0 52px", paddingTop: "5px" }}>
                <input
                  type="checkbox"
                  checked={skipMissing[match.index] ?? true}
                  onChange={e => setSkipMissing(prev => ({ ...prev, [match.index]: e.target.checked }))}
                />
                Skip
              </label>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ fontSize: "10px", color: "#aaa" }}>
                  {match.pos}: {match.reason}
                </div>
                <input
                  type="text"
                  value={overrideNames[match.index] ?? match.name}
                  onChange={e => setOverrideNames(prev => ({ ...prev, [match.index]: e.target.value }))}
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

      {ambiguousRows.length === 0 && missingRows.length === 0 && (
        <button className="run-btn" onClick={run} disabled={running}>
          {running ? "Updating..." : "Update XI"}
        </button>
      )}

        </>
      )}

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
