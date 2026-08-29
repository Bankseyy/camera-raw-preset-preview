import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

export const AutoRenameByPrefixTool = ({ api }: { api: API }) => {
  const [mode, setMode] = useState<"layer" | "group">("layer");
  const [reverse, setReverse] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>("Select 2+ layers or groups. The first selected item keeps its name.");

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).runAutoRenameByPrefix({ mode, reverse: !reverse });
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
        <label>Mode</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          <button
            type="button"
            className={`mode-tab${mode === "layer" ? " active" : ""}`}
            onClick={() => setMode("layer")}
          >
            Layers
          </button>
          <button
            type="button"
            className={`mode-tab${mode === "group" ? " active" : ""}`}
            onClick={() => setMode("group")}
          >
            Groups
          </button>
        </div>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={reverse}
          onChange={e => setReverse(e.target.checked)}
        />
        Use alternate order
      </label>

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Renaming..." : `Rename Selected ${mode === "group" ? "Groups" : "Layers"}`}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
