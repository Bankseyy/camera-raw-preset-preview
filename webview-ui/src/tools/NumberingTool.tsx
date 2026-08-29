import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

export const NumberingTool = ({ api }: { api: API }) => {
  const [prefix, setPrefix] = useState("number_");
  const [amount, setAmount] = useState("10");
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const preview = (() => {
    const a = parseInt(amount, 10);
    if (!prefix || isNaN(a) || a < 1) return "";
    const examples: string[] = [];
    for (let i = 1; i <= Math.min(a, 3); i++) examples.push(prefix + i);
    if (a > 3) examples.push("...");
    return "Looking for: " + examples.join(", ");
  })();

  const run = async () => {
    const a = parseInt(amount, 10);
    if (!prefix) { setStatus("Please enter a prefix."); return; }
    if (isNaN(a) || a < 1) { setStatus("Amount must be at least 1."); return; }
    setRunning(true);
    setStatus(null);
    try {
      const result = await api.runNumbering(prefix, a);
      let msg = `Done. Updated ${result.updated} of ${a} layer(s).`;
      if (result.missing.length > 0)
        msg += `\n\nNot found (${result.missing.length}):\n${result.missing.join("\n")}`;
      setStatus(msg);
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
        <label>Prefix</label>
        <input type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="number_" />
      </div>
      <div className="field-row">
        <label>Amount</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="1" className="input-narrow" />
      </div>
      {preview && <p className="preview-text">{preview}</p>}
      <button className="run-btn" onClick={run} disabled={running}>
        {running ? "Running…" : "Run"}
      </button>
      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
