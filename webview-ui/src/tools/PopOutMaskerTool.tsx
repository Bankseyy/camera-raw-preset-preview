import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

export const PopOutMaskerTool = ({ api }: { api: API }) => {
  const [playerPrefix, setPlayerPrefix] = useState("player_");
  const [maskPrefix, setMaskPrefix] = useState("mask_");
  const [cutoutSuffix, setCutoutSuffix] = useState("_cutout");
  const [startIndex, setStartIndex] = useState("1");
  const [count, setCount] = useState("1");
  const [autoDetect, setAutoDetect] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const resetTemplate = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).resetPopOutMaskerTemplate({
        playerPrefix,
        cutoutSuffix,
      }) as string;
      setStatus(result);
      setConfirmReset(false);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const parsedStart = Number(startIndex);
      const parsedCount = Number(count);
      if (!Number.isFinite(parsedStart) || parsedStart < 1) {
        setStatus("Start index must be at least 1.");
        return;
      }
      if (!autoDetect && (!Number.isFinite(parsedCount) || parsedCount < 1)) {
        setStatus("Count must be at least 1, or turn on auto-detect.");
        return;
      }

      const result = await (api as any).runPopOutMasker({
        playerPrefix,
        maskPrefix,
        cutoutSuffix,
        startIndex: Math.floor(parsedStart),
        count: Math.floor(parsedCount),
        autoDetect,
        replaceExisting,
      }) as string;
      setStatus(result);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  return (
    <div className="tool-panel">
      <div className="field-row">
        <label>Player</label>
        <input value={playerPrefix} onChange={e => setPlayerPrefix(e.target.value)} placeholder="player_" />
      </div>

      <div className="field-row">
        <label>Mask</label>
        <input value={maskPrefix} onChange={e => setMaskPrefix(e.target.value)} placeholder="mask_" />
      </div>

      <div className="field-row">
        <label>Suffix</label>
        <input value={cutoutSuffix} onChange={e => setCutoutSuffix(e.target.value)} placeholder="_cutout" />
      </div>

      <div className="field-row">
        <label>Start</label>
        <input
          className="input-narrow"
          type="number"
          min={1}
          value={startIndex}
          onChange={e => setStartIndex(e.target.value)}
        />
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={autoDetect} onChange={e => setAutoDetect(e.target.checked)} />
        Auto-detect consecutive player/mask pairs
      </label>

      {!autoDetect && (
        <div className="field-row">
          <label>Count</label>
          <input
            className="input-narrow"
            type="number"
            min={1}
            value={count}
            onChange={e => setCount(e.target.value)}
          />
        </div>
      )}

      <label className="checkbox-row">
        <input type="checkbox" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} />
        Replace existing cutout layers
      </label>

      {confirmReset && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid #333", paddingTop: "10px" }}>
          <span style={{ fontSize: "11px", color: "#ccc", lineHeight: 1.35 }}>
            Delete all cutout layers matching this prefix and suffix?
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button className="secondary-btn" type="button" onClick={() => setConfirmReset(false)} disabled={running}>
              Cancel
            </button>
            <button className="run-btn" type="button" onClick={resetTemplate} disabled={running}>
              Delete
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <button className="secondary-btn" onClick={() => setConfirmReset(true)} disabled={running || confirmReset}>
          Reset Template
        </button>
        <button className="run-btn" onClick={run} disabled={running}>
          {running ? "Creating..." : "Create Cutouts"}
        </button>
      </div>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
