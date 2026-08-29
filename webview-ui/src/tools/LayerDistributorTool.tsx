import React, { useState, useEffect } from "react";
import { ArrowRight, ArrowLeft, ArrowDown, ArrowUp } from "lucide-react";
import type { API } from "../../../src/api/api";
import type { CachedLayer, LayerMove } from "../../../src/api/tools/layerDistributor";
import { releasePanelFocus } from "../releasePanelFocus";

type Direction = "Down" | "Up" | "Right" | "Left";
type Order     = "Canvas Position" | "Alphabetical";
type Delta     = Record<number, { dX: number; dY: number }>;

function computeDistribution(
  cache: CachedLayer[],
  cumulative: Delta,
  direction: Direction,
  spacing: number,
  order: Order,
  alignPerp: boolean
): Array<{ id: number; dX: number; dY: number; absX: number; absY: number }> {
  if (cache.length === 0) return [];

  const sorted = [...cache];
  if (order === "Alphabetical") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    switch (direction) {
      case "Down":  sorted.sort((a, b) => a.tT - b.tT); break;
      case "Up":    sorted.sort((a, b) => b.tT - a.tT); break;
      case "Right": sorted.sort((a, b) => a.tL - b.tL); break;
      case "Left":  sorted.sort((a, b) => b.tL - a.tL); break;
    }
  }

  const anchor   = sorted[0];
  const anchorR  = anchor.tL + anchor.tW;
  const anchorB  = anchor.tT + anchor.tH;
  let run = 0;

  return sorted.map(c => {
    let ttL: number;
    let ttT: number;

    switch (direction) {
      case "Down":
        ttT = anchor.tT + run;
        ttL = alignPerp ? anchor.cX - c.tW / 2 : c.tL;
        run += c.tH + spacing;
        break;
      case "Up":
        ttT = anchorB - run - c.tH;
        ttL = alignPerp ? anchor.cX - c.tW / 2 : c.tL;
        run += c.tH + spacing;
        break;
      case "Right":
        ttL = anchor.tL + run;
        ttT = alignPerp ? anchor.cY - c.tH / 2 : c.tT;
        run += c.tW + spacing;
        break;
      case "Left":
        ttL = anchorR - run - c.tW;
        ttT = alignPerp ? anchor.cY - c.tH / 2 : c.tT;
        run += c.tW + spacing;
        break;
      default:
        ttL = c.tL; ttT = c.tT;
    }

    const absX = ttL - c.tL;
    const absY = ttT - c.tT;
    const prev = cumulative[c.id] ?? { dX: 0, dY: 0 };
    return { id: c.id, dX: absX - prev.dX, dY: absY - prev.dY, absX, absY };
  });
}

const DIR_BUTTONS: { value: Direction; Icon: React.FC<{ size?: number }> }[] = [
  { value: "Down",  Icon: ArrowDown  },
  { value: "Up",    Icon: ArrowUp    },
  { value: "Right", Icon: ArrowRight },
  { value: "Left",  Icon: ArrowLeft  },
];

export const LayerDistributorTool = ({ api }: { api: API }) => {
  const [cache,      setCache]      = useState<CachedLayer[]>([]);
  const [cumulative, setCumulative] = useState<Delta>({});
  const [direction,  setDirection]  = useState<Direction>("Down");
  const [spacing,    setSpacing]    = useState(20);
  const [order,      setOrder]      = useState<Order>("Canvas Position");
  const [alignPerp,  setAlignPerp]  = useState(false);
  const [running,    setRunning]    = useState(false);
  const [status,     setStatus]     = useState<string | null>(null);

  const hasMoves = Object.keys(cumulative).length > 0;

  const handleInit = async () => {
    setRunning(true);
    setStatus("Loading layers…");
    try {
      const layers = (await (api as any).buildLayerCache()) as CachedLayer[];
      setCache(layers);
      setCumulative({});
      setStatus(
        layers.length > 0
          ? `${layers.length} layer${layers.length === 1 ? "" : "s"} loaded`
          : "No layers selected — select layers in Photoshop first"
      );
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  useEffect(() => {
    handleInit();
  }, []); // run once on mount; api is a stable Comlink proxy

  const handlePreview = async () => {
    if (cache.length === 0) { setStatus("Load layers first."); return; }
    setRunning(true);
    try {
      const results = computeDistribution(cache, cumulative, direction, spacing, order, alignPerp);
      const moves: LayerMove[] = results.map(({ id, dX, dY }) => ({ id, dX, dY }));
      await (api as any).moveLayers(moves);
      await (api as any).selectLayers(cache.map(c => c.id));
      const newCumulative: Delta = {};
      for (const r of results) newCumulative[r.id] = { dX: r.absX, dY: r.absY };
      setCumulative(newCumulative);
      setStatus(`Preview: ${direction.toLowerCase()} · ${spacing}px gap`);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const handleReset = async () => {
    if (!hasMoves) { setStatus("Nothing to reset."); return; }
    setRunning(true);
    try {
      const resetMoves: LayerMove[] = Object.entries(cumulative).map(([id, d]) => ({
        id: Number(id),
        dX: -d.dX,
        dY: -d.dY,
      }));
      await (api as any).moveLayers(resetMoves);
      await (api as any).selectLayers(cache.map(c => c.id));
      setCumulative({});
      setStatus("Reset to original positions");
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  const handleApply = async () => {
    if (cache.length === 0) { setStatus("Load layers first."); return; }
    setRunning(true);
    try {
      const results = computeDistribution(cache, cumulative, direction, spacing, order, alignPerp);
      const moves: LayerMove[] = results.map(({ id, dX, dY }) => ({ id, dX, dY }));
      await (api as any).moveLayers(moves);
      await (api as any).selectLayers(cache.map(c => c.id));
      const updatedCache = cache.map(c => {
        const r = results.find(x => x.id === c.id);
        if (!r) return c;
        return {
          ...c,
          tL: c.tL + r.absX, tR: c.tR + r.absX,
          tT: c.tT + r.absY, tB: c.tB + r.absY,
          cX: c.cX + r.absX, cY: c.cY + r.absY,
        };
      });
      setCache(updatedCache);
      setCumulative({});
      setStatus(`Applied: ${direction.toLowerCase()} · ${spacing}px gap`);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
      releasePanelFocus(api);
    }
  };

  return (
    <div className="tool-panel">

      {/* Direction */}
      <div className="field-row">
        <label>Direction</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {DIR_BUTTONS.map(({ value, Icon }) => (
            <button
              key={value}
              className={`mode-tab${direction === value ? " active" : ""}`}
              onClick={() => setDirection(value)}
              title={value}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>

      {/* Spacing */}
      <div className="field-row">
        <label>Spacing</label>
        <button
          className="secondary-btn"
          onClick={() => setSpacing(s => Math.max(0, s - 1))}
          style={{ padding: "5px 8px" }}
        >−</button>
        <input
          type="number"
          value={spacing}
          min={0}
          onChange={e => setSpacing(Math.max(0, +e.target.value))}
          className="input-narrow"
          style={{ textAlign: "center" }}
        />
        <button
          className="secondary-btn"
          onClick={() => setSpacing(s => s + 1)}
          style={{ padding: "5px 8px" }}
        >+</button>
        <span style={{ fontSize: "10px", color: "#666" }}>px</span>
      </div>

      {/* Order */}
      <div className="field-row">
        <label>Order</label>
        <div className="mode-tabs" style={{ flex: 1 }}>
          {(["Canvas Position", "Alphabetical"] as Order[]).map(o => (
            <button
              key={o}
              className={`mode-tab${order === o ? " active" : ""}`}
              onClick={() => setOrder(o)}
            >
              {o === "Canvas Position" ? "Canvas" : "Alpha"}
            </button>
          ))}
        </div>
      </div>

      {/* Align perp */}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={alignPerp}
          onChange={e => setAlignPerp(e.target.checked)}
        />
        Align perpendicular axis
      </label>

      {/* Status */}
      {status && <pre className="status-text">{status}</pre>}

      {/* Preview / Reset */}
      <div style={{ display: "flex", gap: "6px" }}>
        <button
          className="secondary-btn"
          style={{ flex: 1 }}
          onClick={handlePreview}
          disabled={running || cache.length === 0}
        >
          Preview
        </button>
        <button
          className="secondary-btn"
          style={{ flex: 1 }}
          onClick={handleReset}
          disabled={running || !hasMoves}
        >
          Reset
        </button>
      </div>

      {/* Apply */}
      <button
        className="run-btn"
        onClick={handleApply}
        disabled={running || cache.length === 0}
      >
        {running ? "Working…" : "Apply"}
      </button>

      {/* Reload */}
      <button
        className="secondary-btn"
        style={{ fontSize: "10px" }}
        onClick={handleInit}
        disabled={running}
      >
        ↺ Reload Layers
      </button>

    </div>
  );
};
