import React, { useState } from "react";
import { ArrowRight, ArrowLeft, ArrowDown, ArrowUp } from "lucide-react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type Mode      = "shape" | "group" | "layer";
type Direction = "right" | "left" | "down" | "up";
type Arrangement = "line" | "stack" | "grid";
type GridFill = "across" | "down";

export const ShapeDistributorTool = ({ api }: { api: API }) => {
  const [mode,       setMode]      = useState<Mode>("shape");
  const [count,      setCount]     = useState("4");
  const [arrangement, setArrangement] = useState<Arrangement>("line");
  const [direction,  setDirection] = useState<Direction>("right");
  const [gap,        setGap]       = useState("20");
  const [centerSpacing, setCenterSpacing] = useState(false);
  const [gridColumns, setGridColumns] = useState("2");
  const [gridGapX, setGridGapX] = useState("20");
  const [gridGapY, setGridGapY] = useState("20");
  const [gridFill, setGridFill] = useState<GridFill>("across");
  const [centerGridOnCanvas, setCenterGridOnCanvas] = useState(false);
  const [prefixes,   setPrefixes]  = useState<string[]>(["text_", "number_"]);
  const [newPrefix,  setNewPrefix] = useState("");
  const [running,    setRunning]   = useState(false);
  const [status,     setStatus]    = useState<string | null>(null);

  const addPrefix = () => {
    const p = newPrefix.trim();
    if (!p || prefixes.includes(p)) return;
    setPrefixes([...prefixes, p]);
    setNewPrefix("");
  };

  const scanPrefixes = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).scanShapeDistributorPrefixes();
      const scanned = ((result?.prefixes ?? []) as string[]).map(prefix => prefix.trim()).filter(Boolean);
      if (!scanned.length) {
        setStatus(`No numbered prefixes found in ${result?.groupName ?? "group_1"}.`);
        return;
      }
      setPrefixes(scanned);
      setStatus(`Found ${scanned.length} prefix${scanned.length === 1 ? "" : "es"} in ${result.groupName}.`);
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
      const parsedCount = Number(count);
      if (!Number.isFinite(parsedCount) || parsedCount < 2) {
        setStatus("Count must be at least 2.");
        return;
      }
      const parsedGap = Number(gap);
      if (arrangement === "line" && (!Number.isFinite(parsedGap) || parsedGap < 0)) {
        setStatus("Gap must be 0 or more.");
        return;
      }

      const parsedGridColumns = Number(gridColumns);
      const parsedGridGapX = Number(gridGapX);
      const parsedGridGapY = Number(gridGapY);
      if (arrangement === "grid" && (!Number.isFinite(parsedGridColumns) || parsedGridColumns < 1)) {
        setStatus("Grid columns must be at least 1.");
        return;
      }
      if (arrangement === "grid" && (
        !Number.isFinite(parsedGridGapX) || parsedGridGapX < 0
        || !Number.isFinite(parsedGridGapY) || parsedGridGapY < 0
      )) {
        setStatus("Grid gaps must be 0 or more.");
        return;
      }

      const result = await (api as any).runShapeDistributor({
        mode,
        count: Math.floor(parsedCount),
        arrangement,
        direction,
        gap: Number.isFinite(parsedGap) ? parsedGap : 0,
        centerSpacing,
        gridColumns: Math.floor(parsedGridColumns),
        gridGapX: Number.isFinite(parsedGridGapX) ? parsedGridGapX : 0,
        gridGapY: Number.isFinite(parsedGridGapY) ? parsedGridGapY : 0,
        gridFill,
        centerGridOnCanvas,
        customPrefixes: prefixes,
      }) as string;
      setStatus(result);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const safeCount = Math.max(2, Math.floor(Number(count) || 2));
  const safeGridColumns = Math.max(1, Math.floor(Number(gridColumns) || 1));
  const gridRows = Math.ceil(safeCount / safeGridColumns);

  return (
    <div className="tool-panel">

      {/* Mode */}
      <div className="field-row">
        <label>Mode</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {(["shape", "group", "layer"] as Mode[]).map(m => (
            <button
              key={m}
              className={`mode-tab${mode === m ? " active" : ""}`}
              onClick={() => setMode(m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <div className="field-row">
        <label>Count (incl. original)</label>
        <input type="number" value={count} min={2}
          onChange={e => setCount(e.target.value)}
          className="input-narrow" />
      </div>

      <div className="field-row">
        <label>Arrange</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {(["line", "stack", "grid"] as Arrangement[]).map(value => (
            <button
              key={value}
              className={`mode-tab${arrangement === value ? " active" : ""}`}
              onClick={() => setArrangement(value)}
            >
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {arrangement === "line" && (
        <>
          <div className="field-row">
            <label>Direction</label>
            <div className="mode-tabs" style={{ flex: 1 }}>
              {([
                { value: "right", Icon: ArrowRight },
                { value: "left",  Icon: ArrowLeft  },
                { value: "down",  Icon: ArrowDown  },
                { value: "up",    Icon: ArrowUp    },
              ] as { value: Direction; Icon: React.FC<{ size?: number }> }[]).map(({ value, Icon }) => (
                <button
                  key={value}
                  className={`mode-tab${direction === value ? " active" : ""}`}
                  onClick={() => setDirection(value)}
                  title={value.charAt(0).toUpperCase() + value.slice(1)}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>
          <div className="field-row">
            <label>{centerSpacing ? "Centre spacing (px)" : "Gap (px)"}</label>
            <input type="number" value={gap} min={0}
              onChange={e => setGap(e.target.value)}
              className="input-narrow" />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={centerSpacing}
              onChange={event => setCenterSpacing(event.target.checked)}
            />
            Measure from layer centres
          </label>
        </>
      )}

      {arrangement === "grid" && (
        <>
          <div className="field-row">
            <label>Columns</label>
            <input
              type="number"
              min={1}
              value={gridColumns}
              onChange={event => setGridColumns(event.target.value)}
              className="input-narrow"
            />
          </div>
          <div className="field-row">
            <label>Rows</label>
            <span style={{ fontSize: "12px", opacity: 0.8 }}>{gridRows} automatic</span>
          </div>
          <div className="field-row">
            <label>Gap X (px)</label>
            <input
              type="number"
              min={0}
              value={gridGapX}
              onChange={event => setGridGapX(event.target.value)}
              className="input-narrow"
            />
          </div>
          <div className="field-row">
            <label>Gap Y (px)</label>
            <input
              type="number"
              min={0}
              value={gridGapY}
              onChange={event => setGridGapY(event.target.value)}
              className="input-narrow"
            />
          </div>
          <div className="field-row">
            <label>Fill</label>
            <div className="mode-tabs" style={{ flex: 1 }}>
              <button
                className={`mode-tab${gridFill === "across" ? " active" : ""}`}
                onClick={() => setGridFill("across")}
              >
                Across
              </button>
              <button
                className={`mode-tab${gridFill === "down" ? " active" : ""}`}
                onClick={() => setGridFill("down")}
              >
                Down
              </button>
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={centerGridOnCanvas}
              onChange={event => setCenterGridOnCanvas(event.target.checked)}
            />
            Centre grid on canvas
          </label>
        </>
      )}

      {/* Custom prefixes — group mode only */}
      {mode === "group" && (
        <div style={{ marginTop: "10px" }}>
          <p style={{ fontSize: "11px", marginBottom: "6px", opacity: 0.7 }}>
            Continuing prefixes (e.g. text_1, text_2, text_3 continue as text_4, text_5, text_6)
          </p>
          <div className="compact-action-row">
            <input
              type="text"
              value={newPrefix}
              onChange={e => setNewPrefix(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addPrefix()}
              placeholder="e.g. country_"
            />
            <button className="secondary-btn" onClick={addPrefix}>Add</button>
            <button className="secondary-btn" onClick={scanPrefixes} disabled={running}>Scan</button>
          </div>
          <div style={{ border: "1px solid #444", borderRadius: "4px", minHeight: "72px", padding: "4px" }}>
            {prefixes.length === 0
              ? <p style={{ fontSize: "11px", opacity: 0.5, margin: "6px" }}>No prefixes</p>
              : prefixes.map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 6px", fontSize: "12px" }}>
                  <span>{p}</span>
                  <button
                    onClick={() => setPrefixes(prefixes.filter((_, idx) => idx !== i))}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", lineHeight: 1, opacity: 0.6, color: "inherit" }}
                  >×</button>
                </div>
              ))
            }
          </div>
        </div>
      )}

      <button className="run-btn" onClick={run} disabled={running} style={{ marginTop: "14px" }}>
        {running ? "Running…" : "Run"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
