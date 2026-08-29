import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

export const GridlinesTool = ({ api }: { api: API }) => {
  const [columns, setColumns] = useState(2);
  const [rows, setRows] = useState(2);
  const [lineWidth, setLineWidth] = useState(12);
  const [colorHex, setColorHex] = useState("#FFFFFF");
  const [opacity, setOpacity] = useState(100);
  const [includeBorder, setIncludeBorder] = useState(false);
  const [groupName, setGroupName] = useState("Gridlines");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).runGridlines({
        columns,
        rows,
        lineWidth,
        colorHex,
        opacity,
        includeBorder,
        groupName,
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
        <label>Columns</label>
        <input
          className="input-narrow"
          type="number"
          min={1}
          value={columns}
          onChange={e => setColumns(Math.max(1, +e.target.value || 1))}
        />
      </div>

      <div className="field-row">
        <label>Rows</label>
        <input
          className="input-narrow"
          type="number"
          min={1}
          value={rows}
          onChange={e => setRows(Math.max(1, +e.target.value || 1))}
        />
      </div>

      <div className="field-row">
        <label>Line width</label>
        <input
          className="input-narrow"
          type="number"
          min={1}
          value={lineWidth}
          onChange={e => setLineWidth(Math.max(1, +e.target.value || 1))}
        />
        <span style={{ fontSize: "10px", color: "#666" }}>px</span>
      </div>

      <div className="field-row">
        <label>Color</label>
        <input
          type="text"
          value={colorHex}
          onChange={e => setColorHex(e.target.value)}
          onBlur={() => {
            const raw = colorHex.trim();
            const hex = raw.startsWith("#") ? raw : `#${raw}`;
            setColorHex(/^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : "#FFFFFF");
          }}
          placeholder="#FFFFFF"
        />
        <span
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "4px",
            border: "1px solid #444",
            background: /^#[0-9a-fA-F]{6}$/.test(colorHex) ? colorHex : "#FFFFFF",
            flex: "0 0 auto",
          }}
        />
      </div>

      <div className="field-row">
        <label>Opacity</label>
        <input
          className="input-narrow"
          type="number"
          min={0}
          max={100}
          value={opacity}
          onChange={e => setOpacity(Math.min(100, Math.max(0, +e.target.value || 0)))}
        />
        <span style={{ fontSize: "10px", color: "#666" }}>%</span>
      </div>

      <div className="field-row">
        <label>Group</label>
        <input
          type="text"
          value={groupName}
          onChange={e => setGroupName(e.target.value)}
          placeholder="Gridlines"
        />
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={includeBorder}
          onChange={e => setIncludeBorder(e.target.checked)}
        />
        Include outer border
      </label>

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Creating..." : "Create Gridlines"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
