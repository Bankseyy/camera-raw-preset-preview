import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import type { StyleLayerOptions } from "../../../src/api/tools/fontWeightStyler";
import { releasePanelFocus } from "../releasePanelFocus";

interface Progress {
  current: number;
  total: number;
  label: string;
}

export const FontWeightStylerTool = ({ api }: { api: API }) => {
  const [autoDetect,          setAutoDetect]          = useState(true);
  const [manualCount,         setManualCount]          = useState("1");
  const [perLine,             setPerLine]              = useState(false);
  const [singleWordAsSecond,  setSingleWordAsSecond]   = useState(true);
  const [exSir,               setExSir]               = useState(true);
  const [threeWord,           setThreeWord]            = useState(true);
  const [firstFont,           setFirstFont]            = useState("Montserrat");
  const [firstStyle,          setFirstStyle]           = useState("Medium");
  const [secondFont,          setSecondFont]           = useState("Montserrat");
  const [secondStyle,         setSecondStyle]          = useState("Bold");
  const [leadingOverride,     setLeadingOverride]      = useState("");
  const [running,             setRunning]              = useState(false);
  const [progress,            setProgress]             = useState<Progress | null>(null);
  const [status,              setStatus]               = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setStatus(null);
    setProgress(null);
    try {
      // Parse leading override
      const ldText = leadingOverride.trim();
      let leadingOverridePt: number | null = null;
      if (ldText) {
        const v = parseFloat(ldText);
        if (isNaN(v) || v <= 0) {
          setStatus("Leading must be a positive number or blank.");
          return;
        }
        leadingOverridePt = v;
      }

      // Detect max layer index
      const init = await (api as any).initFontWeightStyler() as { maxIndex: number };

      let layerCount: number;
      if (autoDetect) {
        layerCount = init.maxIndex;
        if (!layerCount || layerCount < 1) {
          setStatus("No text_N layers found in document.");
          return;
        }
      } else {
        layerCount = parseInt(manualCount, 10);
        if (isNaN(layerCount) || layerCount < 1) {
          setStatus("Layer count must be ≥ 1.");
          return;
        }
      }

      const opts: StyleLayerOptions = {
        firstFont, firstStyle,
        secondFont, secondStyle,
        perLine, singleWordAsSecond, exSir, threeWord,
        leadingOverridePt,
      };

      const layerNames = Array.from({ length: layerCount }, (_, index) => `text_${index + 1}`);
      setProgress({ current: 1, total: layerCount, label: `Processing ${layerCount} text layer${layerCount === 1 ? "" : "s"}` });
      const processed = await (api as any).styleFontWeightLayers(layerNames, opts) as number;

      setProgress(null);
      setStatus(`Done — ${processed} of ${layerCount} layer${layerCount === 1 ? "" : "s"} styled.`);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const pct = progress ? Math.round(((progress.current - 1) / progress.total) * 100) : 0;

  return (
    <div className="tool-panel">

      {/* Layer count */}
      <div className="field-row">
        <label>Layers</label>
        <label className="checkbox-row" style={{ flex: "0 0 auto" }}>
          <input type="checkbox" checked={autoDetect} onChange={e => setAutoDetect(e.target.checked)} />
          Auto-detect
        </label>
        <input
          type="number"
          value={manualCount}
          min={1}
          disabled={autoDetect}
          onChange={e => setManualCount(e.target.value)}
          className="input-narrow"
        />
      </div>

      {/* Per-line */}
      <label className="checkbox-row">
        <input type="checkbox" checked={perLine} onChange={e => setPerLine(e.target.checked)} />
        Per-line mode (style first words of each line separately)
      </label>

      {/* Word rules */}
      <div style={{ border: "1px solid #333", borderRadius: "4px", padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
        <span className="section-label">Word rules</span>
        <label className="checkbox-row">
          <input type="checkbox" checked={singleWordAsSecond} onChange={e => setSingleWordAsSecond(e.target.checked)} />
          Single word → apply second style
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={exSir} onChange={e => setExSir(e.target.checked)} />
          Exclude 'Sir' from word count (keep first style)
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={threeWord} onChange={e => setThreeWord(e.target.checked)} />
          Apply second style to all words after the first
        </label>
      </div>

      {/* First word font */}
      <div style={{ border: "1px solid #333", borderRadius: "4px", padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
        <span className="section-label">First word</span>
        <div className="field-row">
          <label>Font</label>
          <input type="text" value={firstFont} onChange={e => setFirstFont(e.target.value)} />
        </div>
        <div className="field-row">
          <label>Style</label>
          <input type="text" value={firstStyle} onChange={e => setFirstStyle(e.target.value)} />
        </div>
      </div>

      {/* Second word font */}
      <div style={{ border: "1px solid #333", borderRadius: "4px", padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
        <span className="section-label">Second word</span>
        <div className="field-row">
          <label>Font</label>
          <input type="text" value={secondFont} onChange={e => setSecondFont(e.target.value)} />
        </div>
        <div className="field-row">
          <label>Style</label>
          <input type="text" value={secondStyle} onChange={e => setSecondStyle(e.target.value)} />
        </div>
      </div>

      {/* Leading override */}
      <div className="field-row">
        <label>Leading</label>
        <input
          type="text"
          value={leadingOverride}
          onChange={e => setLeadingOverride(e.target.value)}
          placeholder="blank = keep each layer's"
        />
        <span style={{ fontSize: "10px", color: "#666", flexShrink: 0 }}>pt</span>
      </div>

      {/* Progress */}
      {progress && (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <pre className="status-text" style={{ marginBottom: 0 }}>{progress.label}</pre>
          <div style={{ background: "#2a2a2a", borderRadius: "3px", height: "5px", overflow: "hidden" }}>
            <div style={{ background: "#e53935", height: "100%", width: `${pct}%`, transition: "width 0.1s" }} />
          </div>
        </div>
      )}

      {/* Status */}
      {status && <pre className="status-text">{status}</pre>}

      <button className="run-btn" onClick={handleRun} disabled={running}>
        {running ? "Styling…" : "Run"}
      </button>

    </div>
  );
};
