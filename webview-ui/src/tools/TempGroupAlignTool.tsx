import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type AlignMode = "x" | "y" | "both";

export const TempGroupAlignTool = ({ api }: { api: API }) => {
  const [running, setRunning] = useState<AlignMode | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (mode: AlignMode) => {
    setRunning(mode);
    setStatus(null);
    try {
      const result = await (api as any).runTempGroupAlign(mode);
      setStatus(result);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(null);
      releasePanelFocus(api);
    }
  };

  return (
    <div className="tool-panel">
      <button className="run-btn" type="button" onClick={() => run("y")} disabled={Boolean(running)}>
        {running === "y" ? "Centering..." : "Center on horizontal axis"}
      </button>
      <button className="run-btn" type="button" onClick={() => run("x")} disabled={Boolean(running)}>
        {running === "x" ? "Centering..." : "Center on vertical axis"}
      </button>
      <button className="run-btn" type="button" onClick={() => run("both")} disabled={Boolean(running)}>
        {running === "both" ? "Centering..." : "Center both"}
      </button>
      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};

