/* RAW PREVIEW V7 - use documented Photoshop history for panel undo */
import { photoshop } from "../globals";

export {
  applyCameraRawPreset,
  chooseCameraRawPresetFolder,
  clearAllSmartFilters,
  clearCameraRawPresetPreview,
  commitCameraRawPreset,
  getCameraRawPresetFolder,
  getCameraRawPanelPreferences,
  getCameraRawPreviewDocument,
  listCameraRawPresets,
  previewCameraRawPresetLive,
  renderCameraRawPresetPreview,
  setCameraRawPanelPreferences,
} from "./tools/cameraRawPresetPreview";

let focusReleaseInFlight: Promise<void> | null = null;
let lastFocusReleaseAt = 0;

const isEditableElement = (element: Element | null): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  const tagName = element.tagName.toLowerCase();
  return tagName === "input"
    || tagName === "textarea"
    || tagName === "select"
    || element.isContentEditable
    || !!element.closest("[contenteditable='true']");
};

const blurHostPanelFocus = (): boolean => {
  if (isEditableElement(document.activeElement)) return false;
  try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch (_) {}
  try {
    document
      .querySelectorAll<HTMLElement>("webview, iframe, button, input, textarea, select, [tabindex]")
      .forEach(element => element.blur?.());
  } catch (_) {}
  try { window.blur(); } catch (_) {}
  return true;
};

const selectMoveTool = async (): Promise<void> => {
  try {
    await photoshop.core.executeAsModal(async () => {
      try {
        await (photoshop.action.batchPlay as any)([{
          _obj: "select",
          _target: [{ _ref: "moveTool" }],
          _options: { dialogOptions: "dontDisplay" },
        }], {});
      } catch (_) {}
    }, { commandName: "Settle Photoshop Focus" });
  } catch (_) {}
};

export const releasePhotoshopFocus = async (): Promise<void> => {
  if (!blurHostPanelFocus()) return;
  try { photoshop.app.bringToFront(); } catch (_) {}

  const now = Date.now();
  if (focusReleaseInFlight) return focusReleaseInFlight;
  if (now - lastFocusReleaseAt < 300) return;

  lastFocusReleaseAt = now;
  focusReleaseInFlight = selectMoveTool().finally(() => {
    blurHostPanelFocus();
    try { photoshop.app.bringToFront(); } catch (_) {}
    focusReleaseInFlight = null;
  });
  return focusReleaseInFlight;
};

export const deleteSelectedLayers = async (): Promise<void> => {
  try {
    await photoshop.core.executeAsModal(async () => {
      try {
        await (photoshop.action.batchPlay as any)([{
          _obj: "delete",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          _options: { dialogOptions: "dontDisplay" },
        }], {});
      } catch (error) {
        throw error;
      }
    }, { commandName: "Delete Selected Layer" });
  } catch (error) {
    throw error;
  }
};

export const undoLastPhotoshopAction = async (): Promise<void> => {
  try {
    await photoshop.core.executeAsModal(async () => {
      const document = photoshop.app.activeDocument as any;
      if (!document) throw new Error("Open a document before undoing.");

      const states = Array.from<any>(document.historyStates ?? []);
      const activeStateId = Number(document.activeHistoryState?.id || 0);
      const activeIndex = states.findIndex(state => Number(state.id) === activeStateId);
      if (activeIndex <= 0) throw new Error("There is no earlier history state to undo.");

      document.activeHistoryState = states[activeIndex - 1];
    }, { commandName: "Undo" });
  } catch (error) {
    throw error;
  }
};

export const notify = async (message: string): Promise<void> => {
  await photoshop.app.showAlert(message);
};
