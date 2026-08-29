import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

export const Top100NamesTool = ({ api }: { api: API }) => {
  const [namesText, setNamesText] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const namesCount = namesText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(name => name.trim())
    .filter(Boolean).length;

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).runTop100Names(namesText);
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
      <textarea
        value={namesText}
        onChange={e => setNamesText(e.target.value)}
        placeholder={"Paste one name per line.\nOnly names_col_1, names_col_2 and names_col_3 will be updated."}
        rows={14}
      />

      <div style={{ fontSize: "10px", color: "#666" }}>
        {namesCount} name{namesCount === 1 ? "" : "s"}
      </div>

      <button className="run-btn" onClick={run} disabled={running || namesCount === 0}>
        {running ? "Updating..." : "Update Names"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
