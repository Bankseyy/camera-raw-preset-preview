import React, { useRef, useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type BadgeStyle = "regular" | "square";
type PlTableMetric = "played" | "won" | "drawn" | "lost" | "gd" | "pts";

const METRIC_OPTIONS: Array<{ id: PlTableMetric; label: string }> = [
  { id: "played", label: "Played" },
  { id: "won", label: "Won" },
  { id: "drawn", label: "Drawn" },
  { id: "lost", label: "Lost" },
  { id: "gd", label: "Goal diff" },
  { id: "pts", label: "Points" },
];

export const PlTableUpdaterTool = ({ api }: { api: API }) => {
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [tableGroupName, setTableGroupName] = useState("TABLE");
  const [badgeStyle, setBadgeStyle] = useState<BadgeStyle>("regular");
  const [metrics, setMetrics] = useState<PlTableMetric[]>(METRIC_OPTIONS.map(option => option.id));
  const [fetching, setFetching] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const csvTextarea = useRef<HTMLTextAreaElement | null>(null);

  const showCsvText = (text: string) => {
    setCsvText(text);
    window.requestAnimationFrame(() => {
      if (!csvTextarea.current) return;
      csvTextarea.current.scrollTop = 0;
      try { csvTextarea.current.setSelectionRange(0, 0); } catch (_) {}
    });
  };

  const toggleMetric = (metric: PlTableMetric) => {
    setMetrics(current => current.includes(metric)
      ? current.filter(value => value !== metric)
      : [...current, metric]);
  };

  const rowCount = csvText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(line => line.trim()).length - 1;

  const handleCsvFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      showCsvText((evt.target?.result as string) ?? "");
      setCsvFileName(file.name);
      setStatus(null);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const fetchLatest = async () => {
    setFetching(true);
    setStatus(null);
    try {
      const result = await (api as any).fetchLatestPlTableCsv();
      showCsvText(result.csvText);
      setCsvFileName(result.season || "Latest standings");
      setStatus(`Fetched ${result.rowCount} rows from ${result.source} (${result.season}).`);
    } catch (e: any) {
      setStatus("Fetch error: " + (e?.message ?? String(e)));
    } finally {
      setFetching(false);
      releasePanelFocus(api);
    }
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      if (!csvText.trim()) {
        setStatus("Choose or paste the PL standings CSV first.");
        return;
      }
      const result = await (api as any).runPlTableUpdater({
        csvText,
        tableGroupName,
        badgeStyle,
        metrics,
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
    <div className="tool-panel pl-table-tool">
      <div className="field-row">
        <label>CSV</label>
        <label className="file-btn">
          Browse...
          <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleCsvFile} />
        </label>
        <button className="secondary-btn" type="button" onClick={fetchLatest} disabled={fetching || running}>
          {fetching ? "Fetching..." : "Fetch latest"}
        </button>
      </div>
      {csvFileName && <span className="file-name">{csvFileName}</span>}

      <textarea
        ref={csvTextarea}
        className="pl-table-csv"
        value={csvText}
        onChange={e => {
          setCsvText(e.target.value);
          setStatus(null);
        }}
        placeholder={"Paste premier-league-standings.csv here.\nRequired columns: position, club, played, won, drawn, lost, gd, pts."}
        rows={9}
      />

      <div style={{ fontSize: "10px", color: "#666" }}>
        {Math.max(0, rowCount)} row{rowCount === 1 ? "" : "s"} detected
      </div>

      <span className="section-label">Stats</span>
      <div className="pl-metric-grid">
        {METRIC_OPTIONS.map(metric => (
          <label className="checkbox-row" key={metric.id}>
            <input
              type="checkbox"
              checked={metrics.includes(metric.id)}
              onChange={() => toggleMetric(metric.id)}
            />
            {metric.label}
          </label>
        ))}
      </div>

      <label>TABLE GROUP</label>
      <input value={tableGroupName} onChange={e => setTableGroupName(e.target.value)} placeholder="TABLE" />

      <div className="field-row">
        <label>Badge</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {(["regular", "square"] as BadgeStyle[]).map(style => (
            <button
              key={style}
              type="button"
              className={`mode-tab${badgeStyle === style ? " active" : ""}`}
              onClick={() => setBadgeStyle(style)}
            >
              {style === "regular" ? "Regular" : "Square"}
            </button>
          ))}
        </div>
      </div>

      <button className="run-btn" onClick={run} disabled={running || fetching || !csvText.trim()}>
        {running ? "Updating..." : "Update PL Table"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
