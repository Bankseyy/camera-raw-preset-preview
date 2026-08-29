import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export const FORMATIONS: Record<string, string[]> = {
  "4-3-3": ["GK", "RB", "RCB", "LCB", "LB", "CM1", "CM2", "CM3", "RW", "ST", "LW"],
  "4-2-3-1": ["GK", "RB", "RCB", "LCB", "LB", "CDM1", "CDM2", "CAM", "RW", "ST", "LW"],
  "4-4-2": ["GK", "RB", "RCB", "LCB", "LB", "RM", "CM1", "CM2", "LM", "ST1", "ST2"],
  "3-5-2": ["GK", "CB1", "CB2", "CB3", "RWB", "LWB", "CM1", "CM2", "CAM", "ST1", "ST2"],
  "3-4-3": ["GK", "CB1", "CB2", "CB3", "RWB", "CM1", "CM2", "LWB", "RW", "ST", "LW"],
};

export interface TeamXIEntry {
  pos: string;
  name: string;
  fileToken?: string;
}

export interface TeamXIOptions {
  formation: string;
  entries: TeamXIEntry[];
  folderToken?: string;
  advancedMode: boolean;
  recurse: boolean;
  excludeTransfers: boolean;
  limitImagesToGroup: boolean;
  limitNamesToGroup: boolean;
  makeUnique: boolean;
  removeBackground?: boolean;
}

export interface TeamXICandidateChoice {
  token: string;
  fileName: string;
  folderLabel: string;
  band: number;
}

export interface TeamXIAmbiguousMatch {
  index: number;
  pos: string;
  name: string;
  candidates: TeamXICandidateChoice[];
}

export interface TeamXIMissingMatch {
  index: number;
  pos: string;
  name: string;
  reason: string;
}

export interface TeamXIPreflightResult {
  ambiguous: TeamXIAmbiguousMatch[];
  missing: TeamXIMissingMatch[];
}

const NAME_SUFFIX = "_name";
const PHOTO_SUFFIX = "_photo";
const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "psd", "psb", "gif", "heic", "heif"]);

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function sanitizeFormationCode(value: string): string {
  return String(value ?? "").replace(/[^\d]/g, "");
}

function asciiFold(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o");
}

function normStr(value: string): string {
  return asciiFold(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactStr(value: string): string {
  return asciiFold(value).replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]/g, "");
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function entryFolderLabel(entry: any): string {
  const nativePath = String(entry?.nativePath ?? "");
  if (nativePath) {
    const parts = nativePath.split(/[\\/]+/).filter(Boolean);
    if (parts.length > 1) return parts.slice(0, -1).join("/");
  }
  return String(entry?.parent?.name ?? "");
}

function getAllLayers(parent: any): any[] {
  const layers: any[] = [];
  try {
    for (const layer of Array.from<any>(parent.layers)) {
      layers.push(layer);
      if (layer.kind === "group" && layer.layers) layers.push(...getAllLayers(layer));
    }
  } catch (_) {}
  return layers;
}

function findFormationGroup(doc: any, formation: string): any | null {
  const code = sanitizeFormationCode(formation);
  if (!code) return null;
  for (const layer of getAllLayers(doc)) {
    try {
      if (layer.kind === "group" && sanitizeFormationCode(String(layer.name ?? "")) === code) {
        return layer;
      }
    } catch (_) {}
  }
  return null;
}

function findLayersByExactName(parent: any, name: string): any[] {
  const target = name.toLowerCase();
  return getAllLayers(parent).filter(layer => String(layer.name ?? "").toLowerCase() === target);
}

function isTextLayer(layer: any): boolean {
  return layer?.kind === "text";
}

async function getLayerDescriptor(id: number): Promise<any | null> {
  try {
    const result = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _id: id }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    return result[0] ?? null;
  } catch (_) {
    return null;
  }
}

async function isSmartObject(layer: any): Promise<boolean> {
  if (typeof layer?.id !== "number") return false;
  const descriptor = await getLayerDescriptor(layer.id);
  return Boolean(descriptor?.smartObject);
}

async function selectLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function renameActiveLayer(name: string): Promise<void> {
  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "layer", name },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function deleteLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "delete",
    _target: [{ _ref: "layer", _id: id }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function makeUniqueIfRequested(layer: any, makeUnique: boolean): Promise<number> {
  const id = layer.id as number;
  if (!makeUnique) return id;

  const originalName = String(layer.name ?? "");
  await selectLayerById(id);
  await batchPlay([{ _obj: "placedLayerMakeCopy", _options: { dialogOptions: "dontDisplay" } }], {});
  const newLayer = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  const newId = newLayer[0]?.layerID as number;
  if (originalName) await renameActiveLayer(originalName);
  await deleteLayerById(id);
  return newId || id;
}

async function replaceSmartObject(layer: any, fileEntry: any, makeUnique: boolean): Promise<void> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const targetId = await makeUniqueIfRequested(layer, makeUnique);
  const token = fs.createSessionToken(fileEntry);

  await selectLayerById(targetId);
  await batchPlay([{
    _obj: "placedLayerReplaceContents",
    null: { _path: token, _kind: "local" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

function getDocumentModeName(doc: any): string {
  const mode = doc?.mode;
  return String(mode?._value ?? mode?.value ?? mode ?? "");
}

async function convertDocumentToRgbLayer(doc: any): Promise<void> {
  photoshop.app.activeDocument = doc;

  if (getDocumentModeName(doc) !== "RGBColorMode" && getDocumentModeName(doc) !== "rgbColorMode") {
    try {
      await batchPlay([{
        _obj: "convertMode",
        to: { _class: "RGBColorMode" },
        _options: { dialogOptions: "dontDisplay" },
      }], {});
    } catch (_) {}
  }

  try {
    await batchPlay([{
      _obj: "set",
      _target: [{ _ref: "layer", _property: "background" }],
      to: {
        _obj: "layer",
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" },
      },
      _options: { dialogOptions: "dontDisplay" },
    }], {});
  } catch (_) {}
}

async function removeBackgroundFromActiveLayer(): Promise<void> {
  try {
    await batchPlay([{
      _obj: "removeBackground",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    return;
  } catch (_) {}

  await batchPlay([{
    _obj: "autoCutout",
    sampleAllLayers: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  await batchPlay([{
    _obj: "make",
    new: { _class: "channel" },
    at: { _ref: "channel", _enum: "channel", _value: "mask" },
    using: { _enum: "userMaskEnabled", _value: "revealSelection" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function processFileWithBackgroundRemoval(fileEntry: any, hostDoc: any): Promise<any> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const tempFolder = await fs.getTemporaryFolder();
  const baseName = String(fileEntry.name ?? "team-xi-image").replace(/\.[^.]+$/i, "");
  const safeName = baseName.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "team-xi-image";
  const outFile = await tempFolder.createFile(`${safeName}_${Date.now()}_nobg.png`, { overwrite: true });
  let sourceDoc: any = null;

  try {
    sourceDoc = await photoshop.app.open(fileEntry);
    photoshop.app.activeDocument = sourceDoc;

    await convertDocumentToRgbLayer(sourceDoc);
    try {
      if (sourceDoc.layers && sourceDoc.layers.length > 1 && typeof sourceDoc.flatten === "function") {
        await sourceDoc.flatten();
        await convertDocumentToRgbLayer(sourceDoc);
      }
    } catch (_) {}

    await removeBackgroundFromActiveLayer();
    try { await sourceDoc.trim(photoshop.constants.TrimType.TRANSPARENT); } catch (_) {}
    await sourceDoc.saveAs.png(outFile, { compression: 6, interlaced: false }, true);
    await sourceDoc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
    sourceDoc = null;
    photoshop.app.activeDocument = hostDoc;
    return outFile;
  } finally {
    try {
      if (sourceDoc) {
        photoshop.app.activeDocument = sourceDoc;
        await sourceDoc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
      }
    } catch (_) {}
    try { photoshop.app.activeDocument = hostDoc; } catch (_) {}
  }
}

async function readFolderEntries(folder: any): Promise<any[]> {
  if (typeof folder?.getEntries !== "function") return [];
  return Array.from<any>(await folder.getEntries());
}

async function listImageFiles(folder: any, recurse: boolean, excludeTransfers: boolean, out: any[] = []): Promise<any[]> {
  const entries = await readFolderEntries(folder);
  for (const entry of entries) {
    const name = String(entry.name ?? "");
    if (entry.isFile && EXTENSIONS.has(fileExtension(name))) {
      out.push(entry);
    } else if (entry.isFolder && recurse) {
      if (excludeTransfers && name.toLowerCase() === "transfers") continue;
      await listImageFiles(entry, recurse, excludeTransfers, out);
    }
  }
  return out;
}

function matchBandForFile(file: any, playerName: string): number {
  const base = normStr(String(file.name ?? ""));
  const baseCompact = compactStr(String(file.name ?? ""));
  const name = normStr(playerName);
  const nameCompact = compactStr(playerName);
  if (!name) return 0;
  if (base === name || baseCompact === nameCompact) return 100;
  if (base.startsWith(name) || baseCompact.startsWith(nameCompact)) return 90;
  if (base.includes(name) || baseCompact.includes(nameCompact)) return 80;
  if (normStr(String(file.name ?? "")).includes(name) || compactStr(String(file.name ?? "")).includes(nameCompact)) return 70;
  return 0;
}

async function candidateFiles(folder: any, recurse: boolean, playerName: string, excludeTransfers: boolean): Promise<any[]> {
  const files = await listImageFiles(folder, recurse, excludeTransfers);
  const candidates = files
    .map(file => ({ file, band: matchBandForFile(file, playerName) }))
    .filter(candidate => candidate.band > 0);

  candidates.sort((a, b) => {
    if (a.band !== b.band) return b.band - a.band;
    return String(a.file.name ?? "").localeCompare(String(b.file.name ?? ""));
  });

  return candidates;
}

async function getFolderFromToken(token?: string): Promise<any | null> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  if (!token) return null;
  return fs.getEntryForSessionToken(token);
}

async function getFileFromToken(token?: string): Promise<any | null> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  if (!token) return null;
  const entry = await fs.getEntryForSessionToken(token);
  return entry?.isFile ? entry : null;
}

function orderedEntries(options: TeamXIOptions): TeamXIEntry[] {
  const positions = FORMATIONS[options.formation];
  if (!positions) throw new Error(`Unknown formation "${options.formation}".`);
  return positions.map(pos => {
    const existing = options.entries.find(entry => entry.pos === pos);
    return {
      pos,
      name: String(existing?.name ?? "").trim(),
      fileToken: existing?.fileToken,
    };
  });
}

export const preflightTeamXIBuilder = async (options: TeamXIOptions): Promise<TeamXIPreflightResult> => {
  if (!options.advancedMode) return { ambiguous: [], missing: [] };

  const folder = await getFolderFromToken(options.folderToken);
  if (!folder) return { ambiguous: [], missing: [] };

  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const entries = orderedEntries(options);
  const ambiguous: TeamXIAmbiguousMatch[] = [];
  const missing: TeamXIMissingMatch[] = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const name = entry.name.trim();
    if (!name || entry.fileToken) continue;

    const candidates = await candidateFiles(folder, options.recurse, name, options.excludeTransfers);
    if (!candidates.length) {
      missing.push({
        index,
        pos: entry.pos,
        name,
        reason: `No image match found for "${name}".`,
      });
      continue;
    }

    const goodCandidates = candidates.filter(candidate => candidate.band >= 80);
    if (goodCandidates.length <= 1) continue;

    ambiguous.push({
      index,
      pos: entry.pos,
      name,
      candidates: await Promise.all(
        goodCandidates.slice(0, 20).map(async candidate => ({
          token: await fs.createSessionToken(candidate.file),
          fileName: String(candidate.file.name ?? "Unknown file"),
          folderLabel: entryFolderLabel(candidate.file),
          band: candidate.band,
        }))
      ),
    });
  }

  return { ambiguous, missing };
};

export const runTeamXIBuilder = async (options: TeamXIOptions): Promise<string> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("Open your template document first.");
  }

  const entries = orderedEntries(options);
  const folder = options.advancedMode ? await getFolderFromToken(options.folderToken) : null;
  const notes: string[] = [];
  let updatedNames = 0;
  let updatedPhotos = 0;
  let selectedScopeName = "";

  await withHistory(doc, "Team XI Builder", async () => {
    const selectedScope = findFormationGroup(doc, options.formation);
    selectedScopeName = selectedScope ? String(selectedScope.name ?? "") : "";
    const imageScope = options.limitImagesToGroup && selectedScope ? selectedScope : doc;
    const nameScope = options.limitNamesToGroup && selectedScope ? selectedScope : doc;

    for (const entry of entries) {
      const name = entry.name.trim();
      if (!name && !entry.fileToken) continue;

      if (name) {
        const targetName = `${entry.pos}${NAME_SUFFIX}`;
        const layers = findLayersByExactName(nameScope, targetName);
        const textLayers = layers.filter(isTextLayer);
        if (!textLayers.length) {
          notes.push(`${targetName}${options.limitNamesToGroup ? " (not found in selected group)" : " (not found)"}`);
        } else {
          for (const layer of textLayers) {
            try {
              layer.textItem.contents = name.toUpperCase();
              updatedNames++;
            } catch (e: any) {
              notes.push(`${targetName} (text update failed: ${e?.message ?? String(e)})`);
            }
          }
        }
      }

      let file = await getFileFromToken(entry.fileToken);
      if (!file && options.advancedMode && name) {
        if (!folder) {
          notes.push(`${entry.pos}: no image folder selected`);
        } else {
          const candidates = await candidateFiles(folder, options.recurse, name, options.excludeTransfers);
          file = candidates[0]?.file ?? null;
          if (!file) notes.push(`${entry.pos}: no image match found for "${name}"`);
          if (candidates.length > 1 && candidates.filter(candidate => candidate.band >= 80).length > 1) {
            notes.push(`${entry.pos}: multiple good matches for "${name}", used ${file?.name ?? "none"}`);
          }
        }
      }

      if (!file) continue;
      let fileForReplace = file;

      if (options.removeBackground) {
        try {
          fileForReplace = await processFileWithBackgroundRemoval(file, doc);
        } catch (e: any) {
          notes.push(`${entry.pos}: background removal failed for "${file.name}" (using original: ${e?.message ?? String(e)})`);
          fileForReplace = file;
        }
      }

      const targetPhoto = `${entry.pos}${PHOTO_SUFFIX}`;
      const layers = findLayersByExactName(imageScope, targetPhoto);
      if (!layers.length) {
        notes.push(`${targetPhoto}${options.limitImagesToGroup ? " (not found in selected group)" : " (not found)"}`);
        continue;
      }

      for (const layer of layers) {
        if (!(await isSmartObject(layer))) {
          notes.push(`${targetPhoto} (not a Smart Object)`);
          continue;
        }
        try {
          await replaceSmartObject(layer, fileForReplace, options.makeUnique);
          updatedPhotos++;
        } catch (e: any) {
          notes.push(`${targetPhoto} (replace failed: ${e?.message ?? String(e)})`);
        }
      }
    }
  });

  const lines = [
    `Updated: ${updatedNames} name layer${updatedNames === 1 ? "" : "s"}, ${updatedPhotos} photo layer${updatedPhotos === 1 ? "" : "s"}.`,
    selectedScopeName ? `Target group: "${selectedScopeName}"` : "Note: No formation group matched; using whole document.",
  ];

  if (options.advancedMode) {
    lines.push(`Advanced mode: ${folder ? folder.name : "<no folder>"}${options.recurse ? " (subfolders)" : ""}`);
  }
  if (notes.length) lines.push(`Notes:\n - ${notes.join("\n - ")}`);

  return lines.join("\n");
};
