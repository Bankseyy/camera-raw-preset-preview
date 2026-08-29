import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type FlagStyle = "square" | "rect";
type BadgeStyle = "regular" | "square";
type FitMode = "height" | "contain" | "cover";
type AssetMapping = { column: string; smartObjectName: string };

export const CsvToGroupTool = ({ api }: { api: API }) => {
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState(",");
  const [baseGroupName, setBaseGroupName] = useState("BASE GROUP");
  const [textColumns, setTextColumns] = useState(["PLAYER", "WAGE"]);
  const [enableBadge, setEnableBadge] = useState(false);
  const [badgeMappings, setBadgeMappings] = useState<AssetMapping[]>([{ column: "BADGE", smartObjectName: "BADGE" }]);
  const [multipleBadges, setMultipleBadges] = useState(false);
  const [badgeGapPx, setBadgeGapPx] = useState("12");
  const [badgeStyle, setBadgeStyle] = useState<BadgeStyle>("regular");
  const [enableFlag, setEnableFlag] = useState(false);
  const [flagMappings, setFlagMappings] = useState<AssetMapping[]>([{ column: "FLAG", smartObjectName: "FLAG" }]);
  const [multipleFlags, setMultipleFlags] = useState(false);
  const [flagGapPx, setFlagGapPx] = useState("12");
  const [flagStyle, setFlagStyle] = useState<FlagStyle>("square");
  const [fitMode, setFitMode] = useState<FitMode>("height");
  const [keepBaseVisible, setKeepBaseVisible] = useState(false);
  const [clipToBase, setClipToBase] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      setCsvText((evt.target?.result as string) ?? "");
      setCsvFileName(file.name);
      setStatus(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const updateTextColumn = (index: number, value: string) => {
    setTextColumns(prev => prev.map((column, i) => i === index ? value : column));
  };

  const removeTextColumn = (index: number) => {
    setTextColumns(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index));
  };

  const updateMapping = (
    setter: React.Dispatch<React.SetStateAction<AssetMapping[]>>,
    index: number,
    key: keyof AssetMapping,
    value: string
  ) => {
    setter(prev => prev.map((mapping, i) => i === index ? { ...mapping, [key]: value } : mapping));
  };

  const addMapping = (
    setter: React.Dispatch<React.SetStateAction<AssetMapping[]>>,
    column: string,
    smartObjectName: string
  ) => {
    setter(prev => [...prev, { column, smartObjectName }]);
  };

  const removeMapping = (
    setter: React.Dispatch<React.SetStateAction<AssetMapping[]>>,
    index: number
  ) => {
    setter(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index));
  };

  const cleanMappings = (mappings: AssetMapping[]) => {
    return mappings
      .map(mapping => ({
        column: mapping.column.trim(),
        smartObjectName: mapping.smartObjectName.trim(),
      }))
      .filter(mapping => mapping.column && mapping.smartObjectName);
  };

  const scanFields = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).scanCsvToGroupFields(baseGroupName);
      const scanned = ((result?.textColumns ?? []) as string[]).map(column => column.trim()).filter(Boolean);
      if (!scanned.length) {
        setStatus(`No text layers found in ${result?.baseGroupName || baseGroupName || "BASE GROUP"}.`);
        return;
      }
      setTextColumns(scanned);
      setStatus(`Found ${scanned.length} text field${scanned.length === 1 ? "" : "s"} in ${result.baseGroupName}.`);
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
      const cleanTextColumns = textColumns.map(column => column.trim()).filter(Boolean);
      const cleanBadgeMappings = cleanMappings(badgeMappings);
      const cleanFlagMappings = cleanMappings(flagMappings);

      if (!csvText.trim()) {
        setStatus("Choose or paste a CSV first.");
        return;
      }
      if (!cleanTextColumns.length) {
        setStatus("Add at least one text column.");
        return;
      }
      if (enableBadge && !cleanBadgeMappings.length) {
        setStatus("Add at least one badge column and target Smart Object.");
        return;
      }
      if (enableFlag && !cleanFlagMappings.length) {
        setStatus("Add at least one flag column and target Smart Object.");
        return;
      }

      const result = await (api as any).runCsvToGroup({
        csvText,
        delimiter: delimiter || ",",
        baseGroupName,
        textColumns: cleanTextColumns,
        enableBadge,
        badgeColumn: cleanBadgeMappings[0]?.column ?? "",
        badgeSmartObjectName: cleanBadgeMappings[0]?.smartObjectName ?? "",
        badgeMappings: cleanBadgeMappings,
        multipleBadges,
        badgeGapPx: Number(badgeGapPx),
        badgeStyle,
        enableFlag,
        flagColumn: cleanFlagMappings[0]?.column ?? "",
        flagSmartObjectName: cleanFlagMappings[0]?.smartObjectName ?? "",
        flagMappings: cleanFlagMappings,
        multipleFlags,
        flagGapPx: Number(flagGapPx),
        flagStyle,
        keepBaseVisible,
        clipToBase,
        fitMode,
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
        <label>CSV</label>
        <label className="file-btn">
          Browse...
          <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleCsvFile} />
        </label>
        {csvFileName && <span className="file-name">{csvFileName}</span>}
      </div>

      <textarea
        value={csvText}
        onChange={e => {
          setCsvText(e.target.value);
          setStatus(null);
        }}
        placeholder={"Paste CSV here.\nFirst mapped text column is used to name duplicated groups."}
        rows={7}
      />

      <div className="field-row">
        <label>Base group</label>
        <input value={baseGroupName} onChange={e => setBaseGroupName(e.target.value)} />
        <button className="secondary-btn" type="button" onClick={scanFields} disabled={running}>
          Scan
        </button>
        <input
          className="input-narrow"
          value={delimiter}
          maxLength={1}
          onChange={e => setDelimiter(e.target.value || ",")}
          title="CSV delimiter"
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid #333", paddingTop: "10px" }}>
        <span className="section-label">Text columns</span>
        {textColumns.map((column, index) => (
          <div key={index} className="field-row">
            <label>{index + 1}{index === 0 ? " name" : ""}</label>
            <input value={column} onChange={e => updateTextColumn(index, e.target.value)} />
            <button className="secondary-btn" type="button" onClick={() => removeTextColumn(index)} disabled={textColumns.length <= 1}>
              Remove
            </button>
          </div>
        ))}
        <button className="secondary-btn" type="button" onClick={() => setTextColumns(prev => [...prev, ""])}>
          Add column
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid #333", paddingTop: "10px" }}>
        <span className="section-label">Badge / flag</span>

        <label className="checkbox-row">
          <input type="checkbox" checked={enableBadge} onChange={e => setEnableBadge(e.target.checked)} />
          Enable badge
        </label>

        {enableBadge && (
          <>
            {badgeMappings.map((mapping, index) => (
              <div key={index} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="field-row">
                  <label>{index === 0 ? "Badge col" : `Badge ${index + 1}`}</label>
                  <input value={mapping.column} onChange={e => updateMapping(setBadgeMappings, index, "column", e.target.value)} />
                </div>
                <div className="field-row">
                  <label>Badge seed</label>
                  <input value={mapping.smartObjectName} onChange={e => updateMapping(setBadgeMappings, index, "smartObjectName", e.target.value)} />
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => removeMapping(setBadgeMappings, index)}
                    disabled={badgeMappings.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              className="secondary-btn"
              type="button"
              onClick={() => addMapping(setBadgeMappings, "BADGE", `BADGE_${badgeMappings.length + 1}`)}
            >
              Add badge mapping
            </button>
            <label className="checkbox-row">
              <input type="checkbox" checked={multipleBadges} onChange={e => setMultipleBadges(e.target.checked)} />
              Multiple badges from comma list
            </label>
            {multipleBadges && (
              <div className="field-row">
                <label>Badge gap</label>
                <input className="input-narrow" value={badgeGapPx} onChange={e => setBadgeGapPx(e.target.value)} />
              </div>
            )}
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
          </>
        )}

        <label className="checkbox-row">
          <input type="checkbox" checked={enableFlag} onChange={e => setEnableFlag(e.target.checked)} />
          Enable flag
        </label>

        {enableFlag && (
          <>
            {flagMappings.map((mapping, index) => (
              <div key={index} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="field-row">
                  <label>{index === 0 ? "Flag col" : `Flag ${index + 1}`}</label>
                  <input value={mapping.column} onChange={e => updateMapping(setFlagMappings, index, "column", e.target.value)} />
                </div>
                <div className="field-row">
                  <label>Flag seed</label>
                  <input value={mapping.smartObjectName} onChange={e => updateMapping(setFlagMappings, index, "smartObjectName", e.target.value)} />
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => removeMapping(setFlagMappings, index)}
                    disabled={flagMappings.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              className="secondary-btn"
              type="button"
              onClick={() => addMapping(setFlagMappings, "FLAG", `FLAG_${flagMappings.length + 1}`)}
            >
              Add flag mapping
            </button>
            <label className="checkbox-row">
              <input type="checkbox" checked={multipleFlags} onChange={e => setMultipleFlags(e.target.checked)} />
              Multiple flags from comma list
            </label>
            {multipleFlags && (
              <div className="field-row">
                <label>Flag gap</label>
                <input className="input-narrow" value={flagGapPx} onChange={e => setFlagGapPx(e.target.value)} />
              </div>
            )}
            <div className="field-row">
              <label>Flag</label>
              <div className="mode-tabs" style={{ flex: 1 }}>
                {(["square", "rect"] as FlagStyle[]).map(style => (
                  <button
                    key={style}
                    type="button"
                    className={`mode-tab${flagStyle === style ? " active" : ""}`}
                    onClick={() => setFlagStyle(style)}
                  >
                    {style === "square" ? "Square" : "Rect"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="field-row">
          <label>Fit</label>
          <div className="mode-tabs" style={{ flex: 1 }}>
            {(["height", "contain", "cover"] as FitMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                className={`mode-tab${fitMode === mode ? " active" : ""}`}
                onClick={() => setFitMode(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={keepBaseVisible} onChange={e => setKeepBaseVisible(e.target.checked)} />
          Keep base layer visible
        </label>

        <label className="checkbox-row">
          <input type="checkbox" checked={clipToBase} onChange={e => setClipToBase(e.target.checked)} />
          Clip inserted asset to base
        </label>
      </div>

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Running..." : "Run CSV to Group"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
