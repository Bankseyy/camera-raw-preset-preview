import React, { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Upload } from "lucide-react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type ShapeType = "rectangle" | "circle";
type TextPosition = "below" | "above";
type AntiAlias = "none" | "sharp" | "crisp" | "strong" | "smooth";
type ArrowDirection = "right" | "left";
type ArrowPreset = "small-arrow" | "chevron-arrow";
type ArrowSource = "builtIn" | "custom";

export const ShapeInserterTool = ({ api }: { api: API }) => {
  const [shapeType, setShapeType] = useState<ShapeType>("rectangle");
  const [totalShapes, setTotalShapes] = useState(12);
  const [rows, setRows] = useState(3);
  const [matchHorizontalGap, setMatchHorizontalGap] = useState(true);
  const [rowGap, setRowGap] = useState("40");
  const [ensureTextRoom, setEnsureTextRoom] = useState(true);
  const [addText, setAddText] = useState(false);
  const [textPosition, setTextPosition] = useState<TextPosition>("below");
  const [textOffset, setTextOffset] = useState(12);
  const [textSize, setTextSize] = useState(24);
  const [textSizeInPixels, setTextSizeInPixels] = useState(true);
  const [antiAlias, setAntiAlias] = useState<AntiAlias>("crisp");
  const [initialText, setInitialText] = useState("");
  const [addHorizontalArrows, setAddHorizontalArrows] = useState(false);
  const [addVerticalArrows, setAddVerticalArrows] = useState(false);
  const [oddRowDirection, setOddRowDirection] = useState<ArrowDirection>("right");
  const [evenRowDirection, setEvenRowDirection] = useState<ArrowDirection>("left");
  const [arrowSource, setArrowSource] = useState<ArrowSource>("builtIn");
  const [arrowPreset, setArrowPreset] = useState<ArrowPreset>("small-arrow");
  const [customArrowToken, setCustomArrowToken] = useState<string | undefined>();
  const [customArrowName, setCustomArrowName] = useState<string | null>(null);
  const [arrowPadding, setArrowPadding] = useState("0");
  const [arrowScalePercent, setArrowScalePercent] = useState(100);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const perRow = Math.max(1, Math.ceil(totalShapes / Math.max(1, rows)));

  const chooseCustomArrow = async () => {
    try {
      const picked = await (api as any).selectShapeArrowFile();
      if (!picked) return;
      setCustomArrowToken(picked.token);
      setCustomArrowName(picked.name);
      setArrowSource("custom");
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    }
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).runShapeInserter({
        shapeType,
        totalShapes,
        rows,
        matchHorizontalGap,
        rowGap: Number(rowGap) || 0,
        ensureTextRoom,
        addText,
        textPosition,
        textOffset,
        textSize,
        textSizeInPixels,
        antiAlias,
        initialText,
        addHorizontalArrows,
        addVerticalArrows,
        oddRowDirection,
        evenRowDirection,
        arrowSource,
        arrowPreset,
        customArrowToken,
        arrowPadding: Number(arrowPadding) || 0,
        arrowScalePercent,
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
        <label>Shape</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {(["rectangle", "circle"] as ShapeType[]).map(value => (
            <button
              key={value}
              className={`mode-tab${shapeType === value ? " active" : ""}`}
              onClick={() => setShapeType(value)}
            >
              {value === "rectangle" ? "Rectangle" : "Circle"}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label>Total</label>
        <input type="number" min={1} value={totalShapes} onChange={e => setTotalShapes(Math.max(1, +e.target.value || 1))} />
      </div>

      <div className="field-row">
        <label>Rows</label>
        <input className="input-narrow" type="number" min={1} value={rows} onChange={e => setRows(Math.max(1, +e.target.value || 1))} />
        <span style={{ fontSize: "10px", color: "#666", flex: 1 }}>
          {perRow} per row
        </span>
      </div>

      <div className="field-row">
        <label>Custom gap</label>
        <input
          className="input-narrow"
          type="number"
          min={0}
          value={rowGap}
          disabled={matchHorizontalGap}
          onChange={e => setRowGap(e.target.value)}
          onBlur={() => setRowGap(String(Math.max(0, Number(rowGap) || 0)))}
        />
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={matchHorizontalGap} onChange={e => setMatchHorizontalGap(e.target.checked)} />
        Match horizontal gap
      </label>

      <label className="checkbox-row">
        <input type="checkbox" checked={ensureTextRoom} onChange={e => setEnsureTextRoom(e.target.checked)} />
        Ensure room for below text
      </label>

      <span className="section-label">Text</span>

      <label className="checkbox-row">
        <input type="checkbox" checked={addText} onChange={e => setAddText(e.target.checked)} />
        Add text layer
      </label>

      {addText && (
        <>
          <div className="field-row">
            <label>Position</label>
            <div className="mode-tabs" style={{ flex: 1 }}>
              {(["below", "above"] as TextPosition[]).map(value => (
                <button
                  key={value}
                  className={`mode-tab${textPosition === value ? " active" : ""}`}
                  onClick={() => setTextPosition(value)}
                >
                  {value === "below" ? "Below" : "Above"}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label>Offset</label>
            <input className="input-narrow" type="number" min={0} value={textOffset} onChange={e => setTextOffset(Math.max(0, +e.target.value || 0))} />
            <label style={{ width: "38px" }}>Size</label>
            <input className="input-narrow" type="number" min={1} value={textSize} onChange={e => setTextSize(Math.max(1, +e.target.value || 1))} />
          </div>

          <label className="checkbox-row">
            <input type="checkbox" checked={textSizeInPixels} onChange={e => setTextSizeInPixels(e.target.checked)} />
            Size in pixels
          </label>

          <div className="field-row">
            <label>AA</label>
            <div className="mode-tabs" style={{ flex: 1 }}>
              {(["none", "sharp", "crisp", "strong", "smooth"] as AntiAlias[]).map(value => (
                <button
                  key={value}
                  className={`mode-tab${antiAlias === value ? " active" : ""}`}
                  onClick={() => setAntiAlias(value)}
                >
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label>Initial</label>
            <input
              type="text"
              value={initialText}
              onChange={e => setInitialText(e.target.value)}
              placeholder="Leave blank for text_N"
            />
          </div>
        </>
      )}

      <span className="section-label">Arrows</span>

      <label className="checkbox-row">
        <input type="checkbox" checked={addHorizontalArrows} onChange={e => setAddHorizontalArrows(e.target.checked)} />
        Insert horizontal arrows
      </label>

      <label className="checkbox-row">
        <input type="checkbox" checked={addVerticalArrows} onChange={e => setAddVerticalArrows(e.target.checked)} />
        Insert vertical arrows
      </label>

      {(addHorizontalArrows || addVerticalArrows) && (
        <>
          <div className="field-row">
            <label>Odd row</label>
            <div className="mode-tabs" style={{ flex: 1 }}>
              {(["right", "left"] as ArrowDirection[]).map(value => (
                <button
                  key={value}
                  className={`mode-tab${oddRowDirection === value ? " active" : ""}`}
                  onClick={() => setOddRowDirection(value)}
                  title={value === "right" ? "Right" : "Left"}
                >
                  {value === "right" ? <ArrowRight size={13} /> : <ArrowLeft size={13} />}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label>Even row</label>
            <div className="mode-tabs" style={{ flex: 1 }}>
              {(["right", "left"] as ArrowDirection[]).map(value => (
                <button
                  key={value}
                  className={`mode-tab${evenRowDirection === value ? " active" : ""}`}
                  onClick={() => setEvenRowDirection(value)}
                  title={value === "right" ? "Right" : "Left"}
                >
                  {value === "right" ? <ArrowRight size={13} /> : <ArrowLeft size={13} />}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label>Source</label>
            <div className="mode-tabs" style={{ flex: 1 }}>
              <button
                className={`mode-tab${arrowSource === "builtIn" ? " active" : ""}`}
                onClick={() => setArrowSource("builtIn")}
              >
                Built-in
              </button>
              <button
                className={`mode-tab${arrowSource === "custom" ? " active" : ""}`}
                onClick={() => setArrowSource("custom")}
              >
                Custom
              </button>
            </div>
          </div>

          {arrowSource === "builtIn" && (
            <div className="field-row">
              <label>Arrow</label>
              <div className="mode-tabs" style={{ flex: 1 }}>
                {([
                  ["small-arrow", "Small"],
                  ["chevron-arrow", "Chevron"],
                ] as [ArrowPreset, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    className={`mode-tab${arrowPreset === value ? " active" : ""}`}
                    onClick={() => setArrowPreset(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {arrowSource === "custom" && (
            <div className="field-row">
              <label>File</label>
              <button className="secondary-btn" style={{ flex: "0 0 auto" }} onClick={chooseCustomArrow}>
                <Upload size={12} /> Browse
              </button>
              {customArrowName && <span className="file-name">{customArrowName}</span>}
            </div>
          )}

          <div className="field-row">
            <label>Padding</label>
            <input
              className="input-narrow"
              type="number"
              min={0}
              value={arrowPadding}
              onChange={e => setArrowPadding(e.target.value)}
              onBlur={() => setArrowPadding(String(Math.max(0, Number(arrowPadding) || 0)))}
            />
            <label style={{ width: "38px" }}>Scale</label>
            <input className="input-narrow" type="number" min={1} max={100} value={arrowScalePercent} onChange={e => setArrowScalePercent(Math.min(100, Math.max(1, +e.target.value || 1)))} />
            <ArrowDown size={13} style={{ color: "#666", flex: "0 0 auto" }} />
          </div>
        </>
      )}

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Creating..." : "Create"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
