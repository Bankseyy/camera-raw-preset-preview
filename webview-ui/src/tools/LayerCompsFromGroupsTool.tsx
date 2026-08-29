import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type Mode = "create" | "fill";

export const LayerCompsFromGroupsTool = ({ api }: { api: API }) => {
  const [mode, setMode] = useState<Mode>("create");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [heading, setHeading] = useState("STARS");

  const handleCsvFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = loadEvent => {
      setCsvText(String(loadEvent.target?.result ?? ""));
      setCsvFileName(file.name);
      setStatus(null);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      if (mode === "create") {
        setStatus(await (api as any).runLayerCompsFromSelectedLayers());
      } else {
        setStatus(await (api as any).runLayerCompsFromCsv({ csvText, heading }));
      }
    } catch (error: any) {
      setStatus("Error: " + (error?.message ?? String(error)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  return (
    <div className="tool-panel">
      <div className="mode-tabs">
        <button className={`mode-tab${mode === "create" ? " active" : ""}`} type="button" onClick={() => setMode("create")}>
          Create
        </button>
        <button className={`mode-tab${mode === "fill" ? " active" : ""}`} type="button" onClick={() => setMode("fill")}>
          Fill from CSV
        </button>
      </div>

      {mode === "fill" && <>
        <div className="field-row">
          <label>CSV</label>
          <label className="file-btn">
            Browse...
            <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleCsvFile} />
          </label>
          {csvFileName && <span className="file-name">{csvFileName}</span>}
        </div>
        <div className="field-row">
          <label>Layer Comp</label>
          <input value={heading} onChange={event => setHeading(event.target.value)} placeholder="STARS" />
        </div>
        <div className="tool-note">NAME, BADGE, and FLAG are optional. The Layer Comp heading targets matching layers, for example STARS to stars_1.</div>
      </>}

      <button className="run-btn" type="button" onClick={run} disabled={running || (mode === "fill" && !csvText.trim())}>
        {running ? "Applying..." : mode === "create" ? "Create Layer Comps" : "Apply Layer Comps"}
      </button>
      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
