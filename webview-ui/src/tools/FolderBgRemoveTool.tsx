import React, { useState } from "react";
import type { API } from "../../../src/api/api";
import { releasePanelFocus } from "../releasePanelFocus";

type FolderBgRemoveMode = "folder" | "files";

interface PickedFile {
  token: string;
  folderToken?: string;
  name: string;
  path: string;
}

export const FolderBgRemoveTool = ({ api }: { api: API }) => {
  const [mode, setMode] = useState<FolderBgRemoveMode>("folder");
  const [folderToken, setFolderToken] = useState("");
  const [folderLabel, setFolderLabel] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [recursive, setRecursive] = useState(false);
  const [skipTransparent, setSkipTransparent] = useState(true);
  const [deleteOriginalNonPng, setDeleteOriginalNonPng] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const chooseFolder = async () => {
    try {
      const picked = await (api as any).selectFolderBgRemoveFolder();
      if (!picked) return;
      setFolderToken(picked.token);
      setFolderLabel(picked.path || picked.name);
      setStatus(null);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    }
  };

  const chooseFiles = async () => {
    try {
      const picked = await (api as any).selectFolderBgRemoveFiles();
      if (!picked?.length) return;
      setFiles(picked);
      setStatus(null);
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? String(e)));
    }
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    try {
      if (mode === "folder" && !folderToken) {
        setStatus("Choose a folder first.");
        return;
      }
      if (mode === "files" && !files.length) {
        setStatus("Choose one or more files first.");
        return;
      }

      const result = await (api as any).runFolderBgRemove({
        mode,
        folderToken,
        fileTokens: files.map(file => ({ token: file.token, folderToken: file.folderToken })),
        recursive,
        skipTransparent,
        deleteOriginalNonPng,
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
    <div className="tool-panel folder-bg-remove-tool">
      <div className="mode-tabs">
        <button
          className={`mode-tab ${mode === "folder" ? "active" : ""}`}
          type="button"
          onClick={() => setMode("folder")}
        >
          Folder
        </button>
        <button
          className={`mode-tab ${mode === "files" ? "active" : ""}`}
          type="button"
          onClick={() => setMode("files")}
        >
          Files
        </button>
      </div>

      {mode === "folder" && (
        <>
          <div className="field-row batch-picker-row">
            <label>Folder</label>
            <button className="secondary-btn" type="button" onClick={chooseFolder}>
              Browse
            </button>
            {folderLabel && <span className="file-name">{folderLabel}</span>}
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={recursive}
              onChange={e => setRecursive(e.target.checked)}
            />
            Search subfolders
          </label>
        </>
      )}

      {mode === "files" && (
        <>
          <div className="field-row batch-picker-row">
            <label>Files</label>
            <button className="secondary-btn" type="button" onClick={chooseFiles}>
              Choose
            </button>
            <span className="file-name">{files.length ? `${files.length} selected` : "No files selected"}</span>
          </div>

          {files.length > 0 && (
            <div className="batch-file-list">
              {files.map(file => (
                <div key={file.token} className="file-name" title={file.path}>
                  {file.name}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={skipTransparent}
          onChange={e => setSkipTransparent(e.target.checked)}
        />
        Skip images that already contain transparency
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={deleteOriginalNonPng}
          onChange={e => setDeleteOriginalNonPng(e.target.checked)}
        />
        Delete original JPG/TIF/PSD after PNG is written
      </label>

      <button className="run-btn" type="button" onClick={run} disabled={running}>
        {running ? "Running..." : "Run"}
      </button>

      {status && <pre className="status-text">{status}</pre>}
    </div>
  );
};
