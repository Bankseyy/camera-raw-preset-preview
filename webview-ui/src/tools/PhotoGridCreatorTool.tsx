import React, { useMemo, useState } from "react";
import type { API } from "../../../src/api/api";
import {
  PHOTO_GRID_FRAME_COUNTS,
  PHOTO_GRID_LAYOUTS,
  type PhotoGridLayout,
} from "../../../src/api/tools/photoGridLayouts";
import { releasePanelFocus } from "../releasePanelFocus";

const FAVOURITES_KEY = "banksey.photoGrid.favourites";

function readFavourites(): number[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVOURITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(value => Number.isInteger(value)) : [];
  } catch (_) {
    return [];
  }
}

function writeFavourites(values: number[]): void {
  try { window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(values)); } catch (_) {}
}

const previewColours = ["#e53935", "#f4514a", "#c62828", "#ff7043", "#ad2f2f", "#ef5350"];

const parseNumber = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const PhotoGridCreatorTool = ({ api }: { api: API }) => {
  const [frameFilter, setFrameFilter] = useState<number | "all" | "favourites">("all");
  const [favourites, setFavourites] = useState<number[]>(readFavourites);
  const [selectedLayoutId, setSelectedLayoutId] = useState(0);
  const [gutter, setGutter] = useState("0");
  const [useCurrentDocument, setUseCurrentDocument] = useState(true);
  const [canvasPreset, setCanvasPreset] = useState<"square" | "portrait" | "landscape">("square");
  const [attemptFrames, setAttemptFrames] = useState(true);
  const [smartObjects, setSmartObjects] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const visibleLayouts = useMemo(() => PHOTO_GRID_LAYOUTS.filter(layout => {
    if (frameFilter === "all") return true;
    if (frameFilter === "favourites") return favourites.includes(layout.id);
    return layout.cells.length === frameFilter;
  }), [favourites, frameFilter]);

  const selectedLayout = PHOTO_GRID_LAYOUTS.find(layout => layout.id === selectedLayoutId) ?? PHOTO_GRID_LAYOUTS[0];

  const toggleFavourite = (layout: PhotoGridLayout) => {
    const next = favourites.includes(layout.id)
      ? favourites.filter(id => id !== layout.id)
      : [...favourites, layout.id];
    setFavourites(next);
    writeFavourites(next);
  };

  const selectLayout = (layout: PhotoGridLayout) => setSelectedLayoutId(layout.id);

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const result = await (api as any).runPhotoGridCreator({
        layoutId: selectedLayout.id,
        gutter: parseNumber(gutter, 0),
        createNew: !useCurrentDocument,
        canvasPreset,
        attemptFrames,
        smartObjects,
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
    <div className="tool-panel photo-grid-tool">
      <div className="photo-grid-filter-row" role="tablist" aria-label="Filter layouts by frame count">
        <button
          className={`photo-grid-filter${frameFilter === "all" ? " active" : ""}`}
          onClick={() => setFrameFilter("all")}
        >
          All
        </button>
        <button
          className={`photo-grid-filter${frameFilter === "favourites" ? " active" : ""}`}
          onClick={() => setFrameFilter("favourites")}
        >
          * Favs
        </button>
        {PHOTO_GRID_FRAME_COUNTS.map(count => (
          <button
            key={count}
            className={`photo-grid-filter${frameFilter === count ? " active" : ""}`}
            onClick={() => setFrameFilter(count)}
          >
            {count}
          </button>
        ))}
      </div>

      <div className="photo-grid-gallery" aria-label="Photo Grid layouts">
        {visibleLayouts.map(layout => (
          <div
            key={layout.id}
            className={`photo-grid-layout-card${selectedLayoutId === layout.id ? " selected" : ""}`}
            role="button"
            tabIndex={0}
            title={`${layout.name} - ${layout.cells.length} frames`}
            onClick={() => selectLayout(layout)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectLayout(layout);
              }
            }}
          >
            <div className="photo-grid-preview">
              {layout.cells.map((cell, index) => (
                <span
                  key={`${layout.id}-${index}`}
                  className="photo-grid-preview-cell"
                  style={{
                    left: `${cell.x * 100}%`,
                    top: `${cell.y * 100}%`,
                    width: `${cell.w * 100}%`,
                    height: `${cell.h * 100}%`,
                    backgroundColor: previewColours[index % previewColours.length],
                  }}
                />
              ))}
            </div>
            <div className="photo-grid-layout-footer">
              <span className="photo-grid-layout-name">{layout.name}</span>
              <button
                type="button"
                className={`photo-grid-favourite${favourites.includes(layout.id) ? " active" : ""}`}
                aria-label={favourites.includes(layout.id) ? "Remove favourite" : "Add favourite"}
                onClick={event => {
                  event.stopPropagation();
                  toggleFavourite(layout);
                }}
              >
                {favourites.includes(layout.id) ? "*" : "+"}
              </button>
            </div>
          </div>
        ))}
        {!visibleLayouts.length && <div className="photo-grid-empty">No favourites yet.</div>}
      </div>

      <div className="photo-grid-settings">
        <div className="field-row">
          <label>Gutter</label>
          <input
            className="input-narrow"
            type="number"
            min={0}
            value={gutter}
            onChange={event => setGutter(event.target.value)}
            onBlur={() => setGutter(String(Math.max(0, parseNumber(gutter, 0))))}
          />
          <span className="photo-grid-unit">px</span>
          <span className="photo-grid-selected">{selectedLayout.cells.length} frames</span>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={useCurrentDocument}
            onChange={event => setUseCurrentDocument(event.target.checked)}
          />
          Use current document
        </label>

        {!useCurrentDocument && (
          <div className="field-row">
            <label>Canvas</label>
            <select value={canvasPreset} onChange={event => setCanvasPreset(event.target.value as typeof canvasPreset)}>
              <option value="square">1080 x 1080</option>
              <option value="portrait">1080 x 1350</option>
              <option value="landscape">1600 x 900</option>
            </select>
          </div>
        )}

        <div className="field-row">
          <label>Layers</label>
          <div className="mode-tabs" style={{ flex: 1 }}>
            <button
              className={`mode-tab${attemptFrames && !smartObjects ? " active" : ""}`}
              onClick={() => {
                setAttemptFrames(true);
                setSmartObjects(false);
              }}
            >
              Frames
            </button>
            <button
              className={`mode-tab${!attemptFrames && !smartObjects ? " active" : ""}`}
              onClick={() => {
                setAttemptFrames(false);
                setSmartObjects(false);
              }}
            >
              Shapes
            </button>
            <button
              className={`mode-tab${smartObjects ? " active" : ""}`}
              onClick={() => {
                setSmartObjects(true);
                setAttemptFrames(false);
              }}
            >
              Smart
            </button>
          </div>
        </div>
      </div>

      <button className="run-btn" onClick={run} disabled={running || !selectedLayout}>
        {running ? "Creating..." : "Create Photo Grid"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
