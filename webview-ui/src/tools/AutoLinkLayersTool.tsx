import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type Entry = { pattern: string; matched: number; linked: number; error?: string };

export const AutoLinkLayersTool = ({ api }: { api: API }) => {
  const [patterns,       setPatterns]       = useState("text_, rectangle");
  const [includeHidden,  setIncludeHidden]  = useState(true);
  const [includeGroups,  setIncludeGroups]  = useState(false);
  const [caseSensitive,  setCaseSensitive]  = useState(false);
  const [unlinkFirst,    setUnlinkFirst]    = useState(false);
  const [running,        setRunning]        = useState(false);
  const [results,        setResults]        = useState<Entry[] | null>(null);

  const run = async () => {
    if (!patterns.trim()) { setResults([{ pattern: "", matched: 0, linked: 0, error: "Enter at least one pattern." }]); return; }
    setRunning(true);
    setResults(null);
    try {
      const res = await (api as any).runAutoLinkLayers({ patterns, includeHidden, includeGroups, caseSensitive, unlinkFirst });
      setResults(res as Entry[]);
    } catch (e: any) {
      setResults([{ pattern: "Error", matched: 0, linked: 0, error: e?.message ?? String(e) }]);
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  return (
    <div className="tool-panel">
      <div className="field-row">
        <label>Patterns</label>
        <input
          type="text"
          value={patterns}
          onChange={e => setPatterns(e.target.value)}
          placeholder="text_, rectangle"
        />
      </div>
      <p style={{ fontSize: "11px", margin: "2px 0 10px", opacity: 0.6 }}>
        Comma-separated. Each pattern links all layers whose name contains it.
      </p>

      <label className="checkbox-row">
        <input type="checkbox" checked={includeHidden} onChange={e => setIncludeHidden(e.target.checked)} />
        Include hidden layers
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={includeGroups} onChange={e => setIncludeGroups(e.target.checked)} />
        Include groups
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
        Case-sensitive matching
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={unlinkFirst} onChange={e => setUnlinkFirst(e.target.checked)} />
        Unlink existing links first
      </label>

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Linking…" : "Link Layers"}
      </button>

      {results && (
        <div style={{ marginTop: "10px" }}>
          {results.map((r, i) => (
            <div key={i} style={{ fontSize: "12px", marginBottom: "4px" }}>
              {r.error
                ? <span style={{ color: "var(--color-error, #f88)" }}>'{r.pattern}': {r.error}</span>
                : <span>'{r.pattern}': matched {r.matched}, linked {r.linked}</span>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
