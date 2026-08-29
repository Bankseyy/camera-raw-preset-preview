import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import type { ReferenceGroupDistributionMode } from "../../../src/api/tools/referenceGroupDistributor";
import { releasePanelFocus } from "../releasePanelFocus";

const ACTIONS: Array<{ mode: ReferenceGroupDistributionMode; label: string }> = [
  { mode: "align-x", label: "Align horizontal (X)" },
  { mode: "align-y", label: "Align vertical (Y)" },
  { mode: "align-both", label: "Align both" },
  { mode: "distribute-x", label: "Equal horizontal gaps" },
  { mode: "distribute-y", label: "Equal vertical gaps" },
];

export const GroupDistributorTool = ({ api }: { api: API }) => {
  const [running, setRunning] = useState<ReferenceGroupDistributionMode | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (mode: ReferenceGroupDistributionMode) => {
    setRunning(mode);
    setStatus(null);
    try {
      setStatus(await (api as any).runReferenceGroupDistribution(mode));
    } catch (error: any) {
      setStatus("Error: " + (error?.message ?? String(error)));
    } finally {
      setRunning(null);
      releasePanelFocus(api);
    }
  };

  return (
    <div className="tool-panel">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px" }}>
        {ACTIONS.map(action => (
          <button
            key={action.mode}
            className="secondary-btn"
            type="button"
            style={{ minHeight: "42px", whiteSpace: "normal" }}
            onClick={() => run(action.mode)}
            disabled={Boolean(running)}
          >
            {running === action.mode ? "Working..." : action.label}
          </button>
        ))}
      </div>
      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
