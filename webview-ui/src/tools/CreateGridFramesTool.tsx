import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

const parseNumber = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const CreateGridFramesTool = ({ api }: { api: API }) => {
  const [rows, setRows] = useState("2");
  const [cols, setCols] = useState("2");
  const [margin, setMargin] = useState("0");
  const [gutterY, setGutterY] = useState("0");
  const [gutterX, setGutterX] = useState("0");
  const [attemptFrames, setAttemptFrames] = useState(false);
  const [smartObjects, setSmartObjects] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).runCreateGridFrames({
        rows: parseNumber(rows, 2),
        cols: parseNumber(cols, 2),
        margin: parseNumber(margin, 0),
        gutterY: parseNumber(gutterY, 0),
        gutterX: parseNumber(gutterX, 0),
        attemptFrames,
        smartObjects,
      });
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
        <label>Rows</label>
        <input type="number" min={1} value={rows} onChange={e => setRows(e.target.value)} />
      </div>

      <div className="field-row">
        <label>Columns</label>
        <input type="number" min={1} value={cols} onChange={e => setCols(e.target.value)} />
      </div>

      <div className="field-row">
        <label>Margin</label>
        <input type="number" min={0} value={margin} onChange={e => setMargin(e.target.value)} />
      </div>

      <div className="field-row">
        <label>Gutter Y</label>
        <input type="number" min={0} value={gutterY} onChange={e => setGutterY(e.target.value)} />
      </div>

      <div className="field-row">
        <label>Gutter X</label>
        <input type="number" min={0} value={gutterX} onChange={e => setGutterX(e.target.value)} />
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={smartObjects}
          onChange={e => {
            setSmartObjects(e.target.checked);
            if (e.target.checked) setAttemptFrames(false);
          }}
        />
        Create frames as Smart Objects
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={attemptFrames}
          disabled={smartObjects}
          onChange={e => setAttemptFrames(e.target.checked)}
        />
        Attempt native Frames
      </label>

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Creating..." : "Create Grid Frames"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
