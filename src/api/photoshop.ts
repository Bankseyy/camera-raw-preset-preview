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

export const releasePhotoshopFocus = async (): Promise<void> => {
  try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch (_) {}
  try { photoshop.app.bringToFront(); } catch (_) {}
};

export const notify = async (message: string): Promise<void> => {
  await photoshop.app.showAlert(message);
};
