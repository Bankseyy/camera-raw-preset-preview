import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type Mode = "single" | "two" | "multi" | "csv";
type Group = { prefix: string; content: string };
type PrefixScanEntry = { prefix: string; count: number; maxIndex: number };

export const TextReplacerTool = ({ api }: { api: API }) => {
  const [mode, setMode] = useState<Mode>("single");
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [scanRunning, setScanRunning] = useState(false);
  const [scannedPrefixes, setScannedPrefixes] = useState<PrefixScanEntry[]>([]);

  // Shared across single + two
  const [prefix, setPrefix] = useState("text_");
  const [content, setContent] = useState("");

  // Two-line extras
  const [splitChar, setSplitChar] = useState(" ");
  const [reversed, setReversed] = useState(false);

  // Multi
  const [groups, setGroups] = useState<Group[]>([{ prefix: "text_", content: "" }]);
  const [activeGroup, setActiveGroup] = useState(0);

  // CSV
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [skipEmpty, setSkipEmpty] = useState(true);

  // Common
  const [autoDetect, setAutoDetect] = useState(true);

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      setCsvText((evt.target?.result as string) ?? "");
      setCsvFileName(file.name);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const splitLines = (text: string) =>
    text.split("\n").map(l => l.trim()).filter(Boolean);

  const updateGroupContent = (val: string) =>
    setGroups(prev => prev.map((g, i) => i === activeGroup ? { ...g, content: val } : g));

  const updateGroupPrefix = (idx: number, val: string) =>
    setGroups(prev => prev.map((g, i) => i === idx ? { ...g, prefix: val } : g));

  const addGroup = () => {
    const next = groups.length;
    setGroups(prev => [...prev, { prefix: `text${next + 1}_`, content: "" }]);
    setActiveGroup(next);
  };

  const removeGroup = () => {
    if (groups.length === 1) return;
    setGroups(prev => prev.filter((_, i) => i !== activeGroup));
    setActiveGroup(Math.max(0, activeGroup - 1));
  };

  const scanPrefixes = async () => {
    setScanRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).scanTextReplacerPrefixes();
      setScannedPrefixes(result);
      if (result.length === 1) setPrefix(result[0].prefix);
      setStatus(result.length
        ? `Found ${result.length} numbered text prefix${result.length === 1 ? "" : "es"}.`
        : "No numbered text prefixes found.");
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setScanRunning(false);
      releasePanelFocus(api);
    }
  };

  const prefixScanChoices = (onChoose: (prefix: string) => void, selected: string) => (
    scannedPrefixes.length > 0 && (
      <div className="scan-prefix-list">
        {scannedPrefixes.map(item => (
          <label className="scan-prefix-choice" key={item.prefix}>
            <input
              type="radio"
              name="text-replacer-prefix-scan"
              checked={selected === item.prefix}
              onChange={() => onChoose(item.prefix)}
            />
            <span>{item.prefix}</span>
            <small>{item.count} found, max {item.maxIndex}</small>
          </label>
        ))}
      </div>
    )
  );

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      let results: { label: string; processed: number; found: number }[];

      if (mode === "single") {
        results = await api.runTextReplacer({
          mode: "single",
          prefix,
          lines: splitLines(content),
          autoDetect,
        });
      } else if (mode === "two") {
        results = await api.runTextReplacer({
          mode: "two",
          prefix,
          lines: splitLines(content),
          splitChar: splitChar || " ",
          reversed,
          autoDetect,
        });
      } else if (mode === "multi") {
        results = await api.runTextReplacer({
          mode: "multi",
          groups: groups.map(g => ({ prefix: g.prefix, lines: splitLines(g.content) })),
          autoDetect,
        });
      } else {
        results = await api.runTextReplacer({
          mode: "csv",
          csvText,
          skipEmpty,
          autoDetect,
        });
      }

      const msg = results.length
        ? results.map(r => `${r.label} → ${r.processed} replaced (${r.found} found)`).join("\n")
        : "No matching layers found.";
      setStatus(msg);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const MODES: { id: Mode; label: string }[] = [
    { id: "single", label: "Single" },
    { id: "two",    label: "Two-Line" },
    { id: "multi",  label: "Multi" },
    { id: "csv",    label: "CSV" },
  ];

  return (
    <div className="tool-panel text-replacer-tool expanding-tool">
      <div className="mode-tabs">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`mode-tab${mode === m.id ? " active" : ""}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {(mode === "single" || mode === "two") && (
        <>
          <div className="field-row">
            <label>Prefix</label>
            <input type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="text_" />
            <button className="secondary-btn" type="button" onClick={scanPrefixes} disabled={scanRunning}>
              {scanRunning ? "Scanning" : "Scan"}
            </button>
          </div>
          {prefixScanChoices(setPrefix, prefix)}

          {mode === "two" && (
            <div className="field-row">
              <label>Split on</label>
              <input
                type="text"
                value={splitChar}
                onChange={e => setSplitChar(e.target.value)}
                className="input-narrow"
              />
              <label className="checkbox-row" style={{ width: "auto" }}>
                <input type="checkbox" checked={reversed} onChange={e => setReversed(e.target.checked)} />
                Reversed
              </label>
            </div>
          )}

          <textarea
            className="large-textarea"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="One item per line"
            rows={7}
          />
        </>
      )}

      {mode === "multi" && (
        <div className="multi-layout">
          <div className="prefix-list">
            <span className="section-label">Prefixes</span>
            {groups.map((g, i) => (
              <div
                key={i}
                className={`prefix-item${i === activeGroup ? " active" : ""}`}
                onClick={() => setActiveGroup(i)}
              >
                {g.prefix || "(empty)"}
              </div>
            ))}
            <div className="prefix-list-btns">
              <button onClick={addGroup}>+ Add</button>
              <button onClick={removeGroup}>− Remove</button>
            </div>
          </div>

          <div className="multi-content">
            <div className="prefix-edit">
              <span>Prefix:</span>
              <input
                type="text"
                value={groups[activeGroup]?.prefix ?? ""}
                onChange={e => updateGroupPrefix(activeGroup, e.target.value)}
              />
              <button className="secondary-btn" type="button" onClick={scanPrefixes} disabled={scanRunning}>
                {scanRunning ? "Scanning" : "Scan"}
              </button>
            </div>
            {prefixScanChoices(value => updateGroupPrefix(activeGroup, value), groups[activeGroup]?.prefix ?? "")}
            <textarea
              className="large-textarea"
              value={groups[activeGroup]?.content ?? ""}
              onChange={e => updateGroupContent(e.target.value)}
              placeholder="One item per line"
              rows={7}
            />
          </div>
        </div>
      )}

      {mode === "csv" && (
        <>
          <div className="field-row">
            <label>File</label>
            <label className="file-btn">
              Browse…
              <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleCsvFile} />
            </label>
            {csvFileName && <span className="file-name">{csvFileName}</span>}
          </div>
          <textarea
            className="large-textarea"
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder={"Or paste CSV here\n(first row = column headings = layer prefixes)\n\ntext_,home_,away_\nPlayer 1,Team A,Team B"}
            rows={7}
          />
          <label className="checkbox-row">
            <input type="checkbox" checked={skipEmpty} onChange={e => setSkipEmpty(e.target.checked)} />
            Skip empty cells
          </label>
        </>
      )}

      <label className="checkbox-row">
        <input type="checkbox" checked={autoDetect} onChange={e => setAutoDetect(e.target.checked)} />
        Auto-detect layer count
      </label>

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Running…" : "Run"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
