/* RAW PREVIEW V6 - forward Photoshop undo shortcut from the panel */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./raw-preview.scss";
import * as webviewAPI from "./webview-api";
import { initWebview } from "./webview-setup";
import { releasePanelFocus } from "./releasePanelFocus";

type Preset = { relativePath: string; name: string };
type Folder = { name: string; persistent: boolean };

const cleanError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return message.replace(/^Error:\s*/i, "");
};

export const App = () => {
  const { api } = useMemo(() => initWebview(webviewAPI), []);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [clearingFilters, setClearingFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Choose an XMP preset folder to begin.");
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const hoverTimer = useRef<number | null>(null);

  const releaseFocus = useCallback(() => { releasePanelFocus(api as any); }, [api]);

  const refreshDocument = useCallback(async () => {
    try {
      const document = await (api as any).getCameraRawPreviewDocument();
      setDocumentName(document?.title ?? null);
    } catch (_) { setDocumentName(null); }
  }, [api]);

  const refreshAndReleaseFocus = async () => {
    try { await refreshDocument(); }
    finally { releaseFocus(); }
  };

  const loadPresets = useCallback(async (quiet = false) => {
    try {
      const [savedFolder, foundPresets] = await Promise.all([
        (api as any).getCameraRawPresetFolder(),
        (api as any).listCameraRawPresets(),
      ]);
      setFolder(savedFolder);
      setPresets(foundPresets);
      setStatus(quiet ? "" : `Loaded ${foundPresets.length} preset${foundPresets.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setFolder(null);
      setPresets([]);
      if (!quiet) setStatus(cleanError(error));
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    Promise.all([loadPresets(true), refreshDocument(), (api as any).getCameraRawPanelPreferences()])
      .then(([, , preferences]) => {
        if (!active) return;
        setHoverPreviewEnabled(Boolean(preferences?.hoverPreview));
        setControlsCollapsed(Boolean(preferences?.controlsCollapsed));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadPresets, refreshDocument]);

  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
  }, []);

  useEffect(() => {
    const forwardLayerDelete = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        void (api as any).undoLastPhotoshopAction()
          .catch(() => {})
          .finally(releaseFocus);
        return;
      }
      if ((event.key !== "Delete" && event.key !== "Backspace") || event.ctrlKey || event.metaKey || event.altKey) return;

      event.preventDefault();
      event.stopPropagation();
      void (api as any).deleteSelectedLayers()
        .catch(() => {})
        .finally(releaseFocus);
    };

    document.addEventListener("keydown", forwardLayerDelete, true);
    return () => document.removeEventListener("keydown", forwardLayerDelete, true);
  }, [api, releaseFocus]);

  const chooseFolder = async () => {
    try {
      await (api as any).clearCameraRawPresetPreview();
      setActivePreview(null);
      const picked = await (api as any).chooseCameraRawPresetFolder();
      if (!picked) return;
      setFolder(picked);
      await loadPresets();
    } catch (error) { setStatus(cleanError(error)); }
    finally { releaseFocus(); }
  };

  const previewPreset = async (preset: Preset) => {
    if (!documentName) {
      setStatus("Open a Photoshop document and select the layer to preview.");
      return;
    }
    setPreviewing(preset.relativePath);
    setStatus(`Previewing ${preset.name} on the Photoshop canvas...`);
    try {
      const result = await (api as any).previewCameraRawPresetLive(preset.relativePath);
      setActivePreview(preset.relativePath);
      setStatus(`${preset.name} is previewing on ${result.layerName}. Click it again to apply, or hover another card to compare.`);
    } catch (error) { setStatus(`${preset.name}: ${cleanError(error)}`); }
    finally { setPreviewing(null); releaseFocus(); }
  };

  const cancelQueuedPreview = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  const queuePreview = (preset: Preset, delay = 140) => {
    cancelQueuedPreview();
    if (!hoverPreviewEnabled || preset.relativePath === activePreview || previewing || applying) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      void previewPreset(preset);
    }, delay);
  };

  const setHoverMode = async (enabled: boolean) => {
    cancelQueuedPreview();
    setHoverPreviewEnabled(enabled);
    try {
      await (api as any).setCameraRawPanelPreferences({ hoverPreview: enabled });
      setStatus(`Hover preview ${enabled ? "enabled" : "disabled"}.`);
    } catch (error) { setStatus(cleanError(error)); }
    finally { releaseFocus(); }
  };

  const toggleControls = async () => {
    const next = !controlsCollapsed;
    setControlsCollapsed(next);
    try {
      await (api as any).setCameraRawPanelPreferences({ controlsCollapsed: next });
    } catch (error) { setStatus(cleanError(error)); }
    finally { releaseFocus(); }
  };

  const clearPreview = async () => {
    try {
      await (api as any).clearCameraRawPresetPreview();
      setActivePreview(null);
      setStatus("Live preview cleared.");
    } catch (error) { setStatus(cleanError(error)); }
    finally { releaseFocus(); }
  };

  const applyPreset = async (preset: Preset) => {
    setApplying(preset.relativePath);
    setStatus(`Applying ${preset.name}...`);
    try {
      const result = await (api as any).commitCameraRawPreset(preset.relativePath);
      setActivePreview(null);
      setStatus(result);
    } catch (error) { setStatus(`${preset.name}: ${cleanError(error)}`); }
    finally { setApplying(null); releaseFocus(); }
  };

  const clearFilters = async () => {
    setClearingFilters(true);
    setStatus("Clearing Smart Filters from the selected layer...");
    try {
      const result = await (api as any).clearAllSmartFilters();
      setActivePreview(null);
      setStatus(result);
    } catch (error) { setStatus(cleanError(error)); }
    finally { setClearingFilters(false); releaseFocus(); }
  };

  return (
    <main className="raw-preview-app">
      <header className="raw-preview-header">
        <div className="header-actions">
          <button className="icon-btn" type="button" onClick={() => void refreshAndReleaseFocus()}>Refresh</button>
          {activePreview ? <button className="icon-btn clear-preview-header" type="button" disabled={Boolean(previewing)} onClick={clearPreview}>Clear preview</button> : null}
          <button className="icon-btn clear-filters" type="button" disabled={clearingFilters} onClick={clearFilters}>{clearingFilters ? "Clearing..." : "Clear filters"}</button>
          <button className="icon-btn" type="button" onClick={toggleControls}>{controlsCollapsed ? "Options" : "Hide options"}</button>
        </div>
      </header>

      {!controlsCollapsed ? <>
        <section className="source-card">
          <div className="source-row"><span className="source-label">Document</span><strong>{documentName ?? "No document open"}</strong></div>
          <div className="source-row"><span className="source-label">XMP folder</span><strong>{folder?.name ?? "Not selected"}</strong></div>
          <div className="source-actions">
            <button className="secondary-btn" type="button" onClick={chooseFolder}>Choose folder</button>
            <button className="secondary-btn" type="button" disabled={!folder || loading} onClick={() => { void loadPresets().finally(releaseFocus); }}>Reload</button>
            <button className="clear-btn" type="button" disabled={!activePreview || Boolean(previewing)} onClick={clearPreview}>Clear preview</button>
            <label className="hover-toggle"><input type="checkbox" checked={hoverPreviewEnabled} onChange={event => void setHoverMode(event.target.checked)} /> Hover preview</label>
          </div>
        </section>
        <p className="helper-text">{hoverPreviewEnabled ? "Hover a preset to preview it. Click the previewed card again to apply, or use Apply for a direct commit." : "Click a preset to preview it; click it again to apply. Apply commits directly."}</p>
      </> : null}
      {loading ? <p className="empty-state">Loading presets...</p> : null}
      {!loading && !presets.length ? <p className="empty-state">Choose a folder containing Camera Raw .xmp preset files.</p> : null}

      <section className="preset-grid" aria-label="Camera Raw presets">
        {presets.map(preset => {
          const isPreviewing = previewing === preset.relativePath;
          const isApplying = applying === preset.relativePath;
          const isActive = activePreview === preset.relativePath;
          return (
            <article className={`preset-card${isActive ? " is-previewing" : ""}`} key={preset.relativePath} onPointerEnter={() => queuePreview(preset)} onPointerLeave={cancelQueuedPreview}>
              <button className="preset-preview-btn" type="button" disabled={Boolean(previewing) || Boolean(applying) || clearingFilters} onFocus={() => queuePreview(preset, 0)} onClick={() => (isActive ? applyPreset(preset) : previewPreset(preset))} title={isActive ? `Apply ${preset.name}` : `Preview ${preset.name}`}>
                {isApplying ? "Applying..." : isPreviewing ? "Previewing..." : preset.name}
              </button>
              <button className="apply-mini" type="button" disabled={Boolean(previewing) || Boolean(applying) || clearingFilters} onClick={() => applyPreset(preset)}>Apply</button>
            </article>
          );
        })}
      </section>

      {status ? <p className="status-text" role="status">{status}</p> : null}
    </main>
  );
};
