import { photoshop } from "../../globals";

const SETTINGS_PATH = "plugin-data:/camera-raw-preset-preview-settings.json";
const PREVIEW_SIZE = 360;

export type CameraRawPresetFolder = {
  token: string;
  name: string;
  path: string;
  persistent: boolean;
};

export type CameraRawPanelPreferences = {
  hoverPreview: boolean;
  controlsCollapsed: boolean;
};

export type CameraRawPreset = {
  relativePath: string;
  name: string;
  group: string;
  version: string;
  processVersion: string;
};

type LivePreviewState = {
  documentId: number;
  sourceLayerId: number;
  previewLayerId: number;
  presetPath: string;
};

let livePreview: LivePreviewState | null = null;

const normaliseFolder = (value: any): CameraRawPresetFolder | null => {
  if (!value?.token) return null;
  return {
    token: String(value.token),
    name: String(value.name || "Preset folder"),
    path: String(value.path || value.name || "Preset folder"),
    persistent: Boolean(value.persistent),
  };
};

const localFileSystem = () => (require("uxp") as any).storage.localFileSystem;

const createFolderToken = async (folder: any): Promise<{ token: string; persistent: boolean }> => {
  const fs = localFileSystem();
  if (typeof fs.createPersistentToken === "function") {
    try { return { token: await fs.createPersistentToken(folder), persistent: true }; } catch (_) {}
  }
  return { token: await fs.createSessionToken(folder), persistent: false };
};

const getFolderForToken = async (token: string): Promise<any> => {
  const fs = localFileSystem();
  try { return await fs.getEntryForSessionToken(token); } catch (_) {}
  if (typeof fs.getEntryForPersistentToken === "function") return fs.getEntryForPersistentToken(token);
  throw new Error("Preset folder access has expired. Choose the folder again.");
};

type CameraRawSettings = {
  presetFolder?: CameraRawPresetFolder | null;
  hoverPreview?: boolean;
  controlsCollapsed?: boolean;
};

const readSettings = async (): Promise<CameraRawSettings> => {
  try {
    const fs = require("fs") as any;
    return JSON.parse(String(await fs.readFile(SETTINGS_PATH, { encoding: "utf-8" })) || "{}");
  } catch (_) {
    return {};
  }
};

const writeSettings = async (settings: CameraRawSettings): Promise<void> => {
  const fs = require("fs") as any;
  const presetFolder = normaliseFolder(settings.presetFolder);
  const payload = JSON.stringify({
    presetFolder,
    hoverPreview: Boolean(settings.hoverPreview),
    controlsCollapsed: Boolean(settings.controlsCollapsed),
  }, null, 2);
  await fs.writeFile(SETTINGS_PATH, payload, { encoding: "utf-8" });
  const verified = JSON.parse(String(await fs.readFile(SETTINGS_PATH, { encoding: "utf-8" })) || "{}");
  if ((verified?.presetFolder?.token || "") !== (presetFolder?.token || "")) {
    throw new Error("Preset folder settings could not be verified after saving.");
  }
};

const readFileText = async (file: any): Promise<string> => {
  const { storage } = require("uxp") as any;
  return String(await file.read({ format: storage.formats.utf8 }));
};

const xmpAttribute = (xmp: string, attribute: string): string => {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:crs:)?${escaped}="([^"]*)"`, "i").exec(xmp);
  return match?.[1] ?? "";
};

const withoutExtension = (name: string): string => name.replace(/\.xmp$/i, "");

const findFile = async (folder: any, relativePath: string): Promise<any> => {
  const parts = relativePath.split("/").filter(Boolean);
  let current = folder;
  for (const part of parts) {
    const entries = await current.getEntries();
    current = entries.find((entry: any) => String(entry.name) === part);
    if (!current) throw new Error(`Preset no longer exists: ${relativePath}`);
  }
  if (!current.isFile) throw new Error(`Preset is not a file: ${relativePath}`);
  return current;
};

const collectPresets = async (folder: any, prefix = "", depth = 0): Promise<CameraRawPreset[]> => {
  if (depth > 8) return [];
  const entries = await folder.getEntries();
  const results: CameraRawPreset[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : String(entry.name);
    if (entry.isFolder) {
      results.push(...await collectPresets(entry, relativePath, depth + 1));
      continue;
    }
    if (!entry.isFile || !/\.xmp$/i.test(String(entry.name))) continue;
    let xmp = "";
    try { xmp = await readFileText(entry); } catch (_) {}
    results.push({
      relativePath,
      // A settings XMP can contain names for profiles/look tables (for example
      // "Artistic 04"). The file name is the user's actual preset name.
      name: withoutExtension(String(entry.name)),
      group: prefix || "Ungrouped",
      version: xmpAttribute(xmp, "Version"),
      processVersion: xmpAttribute(xmp, "ProcessVersion"),
    });
  }
  return results;
};

const getSelectedFolder = async (): Promise<CameraRawPresetFolder> => {
  const stored = normaliseFolder((await readSettings()).presetFolder);
  if (!stored) throw new Error("Choose a Camera Raw preset folder first.");
  await getFolderForToken(stored.token);
  return stored;
};

const getPresetXmp = async (relativePath: string): Promise<string> => {
  const folder = await getSelectedFolder();
  const entry = await findFile(await getFolderForToken(folder.token), relativePath);
  return readFileText(entry);
};

const selectLayer = async (documentId: number, layerId: number): Promise<void> => {
  await (photoshop.action.batchPlay as any)([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: layerId }, { _ref: "document", _id: documentId }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
};

const deleteLayer = async (documentId: number, layerId: number): Promise<void> => {
  await (photoshop.action.batchPlay as any)([{
    _obj: "delete",
    _target: [{ _ref: "layer", _id: layerId }, { _ref: "document", _id: documentId }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
};

const clearLivePreviewLayer = async (): Promise<void> => {
  const existing = livePreview;
  livePreview = null;
  if (!existing) return;
  try { await deleteLayer(existing.documentId, existing.previewLayerId); } catch (_) {}
};

const activeLayer = (document: any): any => Array.from<any>(document.activeLayers ?? [])[0] ?? document.activeLayer;

const numericAttribute = (xmp: string, attribute: string): number | null => {
  const raw = xmpAttribute(xmp, attribute);
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const curveValues = (xmp: string, name: string): number[] | null => {
  const block = new RegExp(`<crs:${name}>[\\s\\S]*?<rdf:Seq>([\\s\\S]*?)</rdf:Seq>[\\s\\S]*?</crs:${name}>`, "i").exec(xmp)?.[1];
  if (!block) return null;
  const values: number[] = [];
  const items = block.matchAll(/<rdf:li>\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*<\/rdf:li>/gi);
  for (const item of items) values.push(Number(item[1]), Number(item[2]));
  return values.length >= 4 && values.every(Number.isFinite) ? values : null;
};

const presetUuid = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const piece = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `${piece}${piece}${piece}${piece}`;
};

type CameraRawLook = { payload: string; name: string; uuid: string; amount: number };

const lookAttribute = (look: string, attribute: string): string => {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`crs:${escaped}="([^"]*)"`, "i").exec(look)?.[1] ?? "";
};

const extractLook = (xmp: string): CameraRawLook | null => {
  const look = /<crs:Look>[\s\S]*?<\/crs:Look>/i.exec(xmp)?.[0];
  if (!look) return null;
  const amount = Number(lookAttribute(look, "Amount"));
  return {
    payload: `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">\n   ${look}\n  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>`,
    name: lookAttribute(look, "Name"),
    uuid: lookAttribute(look, "UUID"),
    amount: Number.isFinite(amount) ? amount : 0,
  };
};

const makePresetPayload = (xmp: string, presetName: string): string => {
  if (/<crs:Preset\b/i.test(xmp)) return xmp;
  const look = extractLook(xmp);
  const body = /<rdf:RDF\b[^>]*>([\s\S]*?)<\/rdf:RDF>/i.exec(xmp)?.[1]
    ?.replace(/<crs:Look>[\s\S]*?<\/crs:Look>/i, "")
    .trim();
  if (!body) throw new Error("The selected XMP file does not contain Camera Raw RDF settings.");
  const safeName = presetName.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
  const lookAmount = look ? ` crs:LookAmount="${look.amount}"` : "";
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">\n   <crs:Preset>\n    <rdf:Description crs:Name="${safeName}" crs:Amount="1" crs:UUID="${presetUuid(xmp)}"${lookAmount}>\n     <crs:Parameters>\n${body}\n     </crs:Parameters>\n    </rdf:Description>\n   </crs:Preset>\n  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>`;
};

const copyNumber = (descriptor: Record<string, any>, xmp: string, attribute: string, key: string): void => {
  const value = numericAttribute(xmp, attribute);
  if (value !== null) descriptor[key] = value;
};

const copyCurve = (descriptor: Record<string, any>, xmp: string, attribute: string, key: string): void => {
  const value = curveValues(xmp, attribute);
  if (value) descriptor[key] = value;
};

/*
 * Camera Raw Filter is not represented in Photoshop's public DOM. These IDs
 * are the replayable subset recorded while manually loading BrownSport.xmp.
 * XMP is also wrapped in the Pset envelope that Camera Raw itself creates.
 */
const applyCameraRawXmp = async (xmp: string, presetName: string): Promise<void> => {
  const cameraRawVersion = xmpAttribute(xmp, "Version") || "18.4.1";
  const look = extractLook(xmp);
  const descriptor: Record<string, any> = {
    _obj: "Adobe Camera Raw Filter",
    $CrVe: cameraRawVersion,
    $PrVN: 6,
    $PrVe: 251920384,
    $Pset: makePresetPayload(xmp, presetName),
    _options: { dialogOptions: "dontDisplay" },
  };

  if (look) {
    descriptor.$Look = look.payload;
    descriptor.$LokN = look.name;
    descriptor.$LokU = look.uuid;
    descriptor.$LokA = look.amount;
  }

  [
    ["Exposure2012", "$Ex12"], ["Contrast2012", "$Cr12"], ["Highlights2012", "$Hi12"],
    ["Shadows2012", "$Sh12"], ["Whites2012", "$Wh12"], ["Blacks2012", "$Bk12"],
    ["Texture", "$CrTx"], ["Clarity2012", "$Cl12"], ["Dehaze", "$Dhze"],
    ["Vibrance", "$Vibr"], ["Sharpness", "sharpen"], ["SharpenRadius", "$ShpR"],
    ["SharpenDetail", "$ShpD"], ["SharpenEdgeMasking", "$ShpM"], ["LuminanceSmoothing", "$LNR"],
    ["LuminanceNoiseReductionDetail", "$LNRD"], ["LuminanceNoiseReductionContrast", "$LNRC"],
    ["ColorNoiseReduction", "$CNR"], ["ColorNoiseReductionDetail", "$CNRD"],
    ["ColorNoiseReductionSmoothness", "$CNRS"], ["SplitToningShadowHue", "$STSH"],
    ["SplitToningShadowSaturation", "$STSS"], ["SplitToningHighlightHue", "$STHH"],
    ["SplitToningHighlightSaturation", "$STHS"], ["SplitToningBalance", "$STB"],
    ["ColorGradeMidtoneHue", "$CgMH"], ["ColorGradeMidtoneSat", "$CgMS"],
    ["ColorGradeShadowLum", "$CgSL"], ["ColorGradeMidtoneLum", "$CgML"],
    ["ColorGradeHighlightLum", "$CgHL"], ["ColorGradeBlending", "$CgBl"],
    ["ColorGradeGlobalHue", "$CgGH"], ["ColorGradeGlobalSat", "$CgGS"],
    ["ColorGradeGlobalLum", "$CgGL"], ["Saturation", "saturation"], ["PostCropVignetteAmount", "$PCVA"],
    ["PostCropVignetteMidpoint", "$PCVM"], ["PostCropVignetteFeather", "$PCVF"],
    ["PostCropVignetteRoundness", "$PCVR"], ["PostCropVignetteStyle", "$PCVS"],
    ["PostCropVignetteHighlightContrast", "$PCVH"], ["RedHue", "$RHue"],
    ["RedSaturation", "$RSat"], ["GreenHue", "$GHue"], ["GreenSaturation", "$GSat"],
    ["BlueHue", "$BHue"], ["BlueSaturation", "$BSat"], ["CurveRefineSaturation", "$crfs"],
  ].forEach(([attribute, key]) => copyNumber(descriptor, xmp, attribute, key));

  [
    ["HueAdjustmentRed", "$HA_R"], ["HueAdjustmentOrange", "$HA_O"], ["HueAdjustmentYellow", "$HA_Y"],
    ["HueAdjustmentGreen", "$HA_G"], ["HueAdjustmentAqua", "$HA_A"], ["HueAdjustmentBlue", "$HA_B"],
    ["HueAdjustmentPurple", "$HA_P"], ["HueAdjustmentMagenta", "$HA_M"], ["SaturationAdjustmentRed", "$SA_R"],
    ["SaturationAdjustmentOrange", "$SA_O"], ["SaturationAdjustmentYellow", "$SA_Y"], ["SaturationAdjustmentGreen", "$SA_G"],
    ["SaturationAdjustmentAqua", "$SA_A"], ["SaturationAdjustmentBlue", "$SA_B"], ["SaturationAdjustmentPurple", "$SA_P"],
    ["SaturationAdjustmentMagenta", "$SA_M"], ["LuminanceAdjustmentRed", "$LA_R"],
    ["LuminanceAdjustmentOrange", "$LA_O"], ["LuminanceAdjustmentYellow", "$LA_Y"], ["LuminanceAdjustmentGreen", "$LA_G"],
    ["LuminanceAdjustmentAqua", "$LA_A"], ["LuminanceAdjustmentBlue", "$LA_B"],
    ["LuminanceAdjustmentPurple", "$LA_P"], ["LuminanceAdjustmentMagenta", "$LA_M"],
  ].forEach(([attribute, key]) => copyNumber(descriptor, xmp, attribute, key));

  [["ToneCurvePV2012", "curve"], ["ToneCurvePV2012Red", "$CrvR"], ["ToneCurvePV2012Green", "$CrvG"], ["ToneCurvePV2012Blue", "$CrvB"]]
    .forEach(([attribute, key]) => copyCurve(descriptor, xmp, attribute, key));

  await (photoshop.action.batchPlay as any)([descriptor], { immediateRedraw: true });
};

export const getCameraRawPresetFolder = async (): Promise<CameraRawPresetFolder | null> => {
  const folder = normaliseFolder((await readSettings()).presetFolder);
  if (!folder) return null;
  try {
    await getFolderForToken(folder.token);
    return folder;
  } catch (_) {
    return null;
  }
};

export const chooseCameraRawPresetFolder = async (): Promise<CameraRawPresetFolder | null> => {
  const fs = localFileSystem();
  const folder = typeof fs.getFolder === "function" ? await fs.getFolder() : await fs.getFolderForOpening();
  if (!folder) return null;
  const token = await createFolderToken(folder);
  const result: CameraRawPresetFolder = {
    token: token.token,
    name: String(folder.name),
    path: String(folder.nativePath || folder.name),
    persistent: token.persistent,
  };
  await writeSettings({ ...(await readSettings()), presetFolder: result });
  return result;
};

export const getCameraRawPanelPreferences = async (): Promise<CameraRawPanelPreferences> => {
  const settings = await readSettings();
  return {
    hoverPreview: Boolean(settings.hoverPreview),
    controlsCollapsed: Boolean(settings.controlsCollapsed),
  };
};

export const setCameraRawPanelPreferences = async (preferences: Partial<CameraRawPanelPreferences>): Promise<CameraRawPanelPreferences> => {
  const current = await readSettings();
  const next: CameraRawSettings = {
    ...current,
    hoverPreview: preferences.hoverPreview ?? Boolean(current.hoverPreview),
    controlsCollapsed: preferences.controlsCollapsed ?? Boolean(current.controlsCollapsed),
  };
  await writeSettings(next);
  return {
    hoverPreview: Boolean(next.hoverPreview),
    controlsCollapsed: Boolean(next.controlsCollapsed),
  };
};

export const listCameraRawPresets = async (): Promise<CameraRawPreset[]> => {
  const folder = await getSelectedFolder();
  const presets = await collectPresets(await getFolderForToken(folder.token));
  return presets.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
};

export const getCameraRawPreviewDocument = async (): Promise<{ id: number; title: string } | null> => {
  const doc = photoshop.app.activeDocument as any;
  if (!doc) return null;
  return { id: Number(doc.id), title: String(doc.title || doc.name || "Untitled") };
};

export const previewCameraRawPresetLive = async (relativePath: string): Promise<{ layerName: string }> => {
  const xmp = await getPresetXmp(relativePath);
  return photoshop.core.executeAsModal(async () => {
    const document = photoshop.app.activeDocument as any;
    if (!document) throw new Error("Open a document first.");

    const currentLayer = activeLayer(document);
    if (!currentLayer?.id) throw new Error("Select a layer to preview.");
    const existing = livePreview;
    const sourceLayerId = existing?.documentId === Number(document.id)
      ? existing.sourceLayerId
      : Number(currentLayer.id);

    await clearLivePreviewLayer();
    await selectLayer(Number(document.id), sourceLayerId);
    const sourceLayer = activeLayer(document);
    if (!sourceLayer?.id) throw new Error("The source layer is no longer available.");

    const previewLayer = await sourceLayer.duplicate();
    previewLayer.name = `RAW PREVIEW - ${withoutExtension(relativePath.split("/").pop() || relativePath)}`;
    await selectLayer(Number(document.id), Number(previewLayer.id));
    await applyCameraRawXmp(xmp, withoutExtension(relativePath.split("/").pop() || relativePath));

    livePreview = {
      documentId: Number(document.id),
      sourceLayerId,
      previewLayerId: Number(previewLayer.id),
      presetPath: relativePath,
    };
    return { layerName: String(sourceLayer.name || "selected layer") };
  }, { commandName: "Live Camera Raw Preset Preview" });
};

export const clearCameraRawPresetPreview = async (): Promise<void> => {
  await photoshop.core.executeAsModal(async () => {
    await clearLivePreviewLayer();
  }, { commandName: "Clear Camera Raw Preset Preview" });
};

/** Removes the selected layer's non-destructive Smart Filter stack. */
export const clearAllSmartFilters = async (): Promise<string> => {
  await photoshop.core.executeAsModal(async () => {
    const document = photoshop.app.activeDocument as any;
    if (!document) throw new Error("Open a document before clearing filters.");

    const preview = livePreview?.documentId === Number(document.id) ? livePreview : null;
    const targetLayerId = preview?.sourceLayerId ?? Number(activeLayer(document)?.id || 0);
    if (!targetLayerId) throw new Error("Select a layer before clearing filters.");

    if (preview) await clearLivePreviewLayer();
    await selectLayer(Number(document.id), targetLayerId);
    // Listener records a historyStateChanged notifier before this action.
    // The notifier is not replayable; deleting the layer's filterFX is the
    // actual Photoshop command that removes every Smart Filter.
    await (photoshop.action.batchPlay as any)([
      {
        _obj: "delete",
        _target: [
          { _ref: "filterFX" },
          { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
        ],
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, immediateRedraw: true });
  }, { commandName: "Clear Smart Filters" });
  return "Cleared Smart Filters from the selected layer.";
};

export const commitCameraRawPreset = async (relativePath: string): Promise<string> => {
  const xmp = await getPresetXmp(relativePath);
  await photoshop.core.executeAsModal(async () => {
    const document = photoshop.app.activeDocument as any;
    if (!document) throw new Error("Open a document first.");
    const existing = livePreview;
    // When a hover preview exists, the active layer is its temporary copy.
    // Always return to the original source before committing a preset.
    const sourceLayerId = existing?.documentId === Number(document.id)
      ? existing.sourceLayerId
      : Number(activeLayer(document)?.id || 0);
    if (!sourceLayerId) throw new Error("Select a layer to apply the preset.");

    await clearLivePreviewLayer();
    await selectLayer(Number(document.id), sourceLayerId);
    await applyCameraRawXmp(xmp, withoutExtension(relativePath.split("/").pop() || relativePath));
  }, { commandName: "Apply Camera Raw Preset" });
  return "Preset applied to the original layer.";
};

export const renderCameraRawPresetPreview = async (relativePath: string): Promise<string> => {
  const source = photoshop.app.activeDocument as any;
  if (!source) throw new Error("Open a document first.");
  const xmp = await getPresetXmp(relativePath);

  return photoshop.core.executeAsModal(async () => {
    let previewDocument: any = null;
    try {
      previewDocument = await source.duplicate("Raw Preview", true);
      await applyCameraRawXmp(xmp, withoutExtension(relativePath.split("/").pop() || relativePath));
      const pixels = await (photoshop.imaging as any).getPixels({
        documentID: previewDocument.id,
        targetSize: { width: PREVIEW_SIZE, height: PREVIEW_SIZE },
        componentSize: 8,
        colorSpace: "RGB",
        applyAlpha: true,
      });
      const encoded = await (photoshop.imaging as any).encodeImageData({ imageData: pixels.imageData, base64: true });
      pixels.imageData.dispose?.();
      return `data:image/jpeg;base64,${encoded}`;
    } finally {
      if (previewDocument) {
        await previewDocument.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
      }
    }
  }, { commandName: "Render Camera Raw Preset Preview" });
};

export const applyCameraRawPreset = async (relativePath: string): Promise<string> => {
  const xmp = await getPresetXmp(relativePath);
  await photoshop.core.executeAsModal(async () => {
    if (!photoshop.app.activeDocument) throw new Error("Open a document first.");
    await applyCameraRawXmp(xmp, withoutExtension(relativePath.split("/").pop() || relativePath));
  }, { commandName: "Apply Camera Raw Preset" });
  return "Preset applied to the active layer.";
};
