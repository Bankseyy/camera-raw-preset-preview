import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";
import { withHistory } from "../psHistory";

export interface ImageReplacerOptions {
  prefix: string;
  names: string[];
  folderToken?: string;
  fileTokens?: string[];
  recurse: boolean;
  makeUnique: boolean;
  removeBackground?: boolean;
}

export interface ImageReplacerIssue {
  index: number;
  targetLayerName: string;
  name: string;
  reason: string;
  matchedFileName?: string;
}

export interface ImageReplacerPreflightResult {
  rowCount: number;
  detectedCount: number;
  missing: ImageReplacerIssue[];
}

const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "psd", "psb", "gif", "heic", "heif"]);

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNames(rawNames: string[]): string[] {
  return rawNames.map(name => String(name ?? "").trim());
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

function searchableName(value: string): string {
  return asciiFold(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

async function readFolderEntries(folder: any): Promise<any[]> {
  if (typeof folder.getEntries !== "function") return [];
  return Array.from<any>(await folder.getEntries());
}

async function listImageFiles(folder: any, recurse: boolean, out: any[] = []): Promise<any[]> {
  const entries = await readFolderEntries(folder);
  for (const entry of entries) {
    const name = String(entry.name ?? "");
    if (entry.isFile && EXTENSIONS.has(fileExtension(name))) {
      out.push(entry);
    } else if (entry.isFolder && recurse) {
      await listImageFiles(entry, recurse, out);
    }
  }
  return out;
}

function matchBand(file: any, playerName: string): number {
  const fileStem = searchableName(String(file.name ?? ""));
  const query = searchableName(playerName);
  if (!query) return 0;
  if (fileStem === query) return 100;
  if (fileStem.startsWith(query)) return 90;
  if (fileStem.includes(query)) return 80;
  if (asciiFold(String(file.name ?? "")).includes(query)) return 70;
  return 0;
}

async function candidateFiles(folder: any, recurse: boolean, playerName: string): Promise<any[]> {
  const files = await listImageFiles(folder, recurse);
  const candidates = files
    .map(file => ({ file, band: matchBand(file, playerName) }))
    .filter(candidate => candidate.band > 0);

  candidates.sort((a, b) => {
    if (a.band !== b.band) return b.band - a.band;
    return String(a.file.name ?? "").localeCompare(String(b.file.name ?? ""));
  });

  return candidates;
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

function detectTargetIndices(doc: any, prefix: string): number[] {
  const pattern = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`, "i");
  const found = new Set<number>();
  for (const layer of getAllLayers(doc)) {
    const match = String(layer.name ?? "").match(pattern);
    if (match) found.add(parseInt(match[1], 10));
  }
  return Array.from(found).filter(index => index > 0).sort((a, b) => a - b);
}

function maxTargetIndex(indices: number[]): number {
  return indices.length ? Math.max(...indices) : 0;
}

function targetNameForRow(prefix: string, rowIndex: number): string {
  return `${prefix}${rowIndex + 1}`;
}
function findLayersByName(doc: any, name: string): any[] {
  const target = name.toLowerCase();
  return getAllLayers(doc).filter(layer => String(layer.name ?? "").toLowerCase() === target);
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

async function hasFrameLayer(id: number): Promise<boolean> {
  try {
    const result = await batchPlay([{
      _obj: "get",
      _target: [
        { _property: "framedGroup" },
        { _ref: "layer", _id: id },
      ],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    return result[0]?.framedGroup !== undefined;
  } catch (_) {
    return false;
  }
}

async function isReplaceableLayer(layer: any): Promise<boolean> {
  if (typeof layer?.id !== "number") return false;
  const descriptor = await getLayerDescriptor(layer.id);
  return Boolean(descriptor?.smartObject) || await hasFrameLayer(layer.id);
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

async function renameLayerById(id: number, name: string): Promise<void> {
  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _id: id }],
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

async function replaceLayerContents(layer: any, fileEntry: any, makeUnique: boolean): Promise<void> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const originalName = String(layer.name ?? "");
  const targetId = await makeUniqueIfRequested(layer, makeUnique);
  const token = fs.createSessionToken(fileEntry);

  await selectLayerById(targetId);
  await batchPlay([{
    _obj: "placedLayerReplaceContents",
    null: { _path: token, _kind: "local" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  if (originalName) {
    try {
      await renameLayerById(targetId, originalName);
    } catch (_) {
      try { await renameActiveLayer(originalName); } catch (_) {}
    }
  }
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
  const baseName = String(fileEntry.name ?? "image-replacer-image").replace(/\.[^.]+$/i, "");
  const safeName = baseName.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "image-replacer-image";
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

async function getFolderFromToken(folderToken?: string): Promise<any | null> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  if (!folderToken) return null;
  return fs.getEntryForSessionToken(folderToken);
}

async function getFileFromToken(fileToken: string): Promise<any> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const entry = await fs.getEntryForSessionToken(fileToken);
  if (!entry?.isFile) throw new Error("Selected entry is not a file.");
  return entry;
}

function prepare(options: ImageReplacerOptions): { names: string[]; prefix: string } {
  const prefix = String(options.prefix || "").trim();
  if (!prefix) throw new Error("Enter a layer prefix.");
  return { names: parseNames(options.names), prefix };
}

async function resolveImageFile(
  folder: any | null,
  options: ImageReplacerOptions,
  rowName: string,
  index: number
): Promise<any | null> {
  const fileToken = String(options.fileTokens?.[index] ?? "").trim();
  if (fileToken) return getFileFromToken(fileToken);

  if (!rowName.trim()) return null;
  if (!folder) return null;

  const candidates = await candidateFiles(folder, options.recurse, rowName);
  return candidates[0]?.file ?? null;
}

export const preflightImageReplacer = async (
  options: ImageReplacerOptions
): Promise<ImageReplacerPreflightResult> => {
  const { names, prefix } = prepare(options);
  const fileTokens = options.fileTokens ?? [];
  const inputCount = Math.max(names.length, fileTokens.length);
  const folder = await getFolderFromToken(options.folderToken);
  const missing: ImageReplacerIssue[] = [];
  let detectedIndices: number[] = [];

  await asModal("Image Replacer Preflight", async () => {
    detectedIndices = detectTargetIndices(photoshop.app.activeDocument as any, prefix);
  });

  const rowCount = Math.min(inputCount, maxTargetIndex(detectedIndices));
  if (detectedIndices.length === 0) {
    return {
      rowCount: 0,
      detectedCount: 0,
      missing: [{
        index: 0,
        targetLayerName: `${prefix}1`,
        name: "",
        reason: `No layers found matching ${prefix}1, ${prefix}2...`,
      }],
    };
  }

  await asModal("Image Replacer Target Check", async () => {
    const doc = photoshop.app.activeDocument as any;
    for (let i = 0; i < rowCount; i++) {
      const targetLayerName = targetNameForRow(prefix, i);
      const layers = findLayersByName(doc, targetLayerName);
      const hasReplaceable = layers.length > 0 && (await Promise.all(layers.map(isReplaceableLayer))).some(Boolean);
      if (!hasReplaceable) {
        missing.push({
          index: i,
          targetLayerName,
          name: names[i] ?? "",
          reason: "Target layer is missing or is not a Smart Object/frame.",
        });
      }
    }
  });

  for (let i = 0; i < rowCount; i++) {
    const name = names[i] ?? "";
    const targetLayerName = targetNameForRow(prefix, i);
    const fileToken = String(fileTokens[i] ?? "").trim();

    if (!fileToken && !name.trim()) {
      missing.push({
        index: i,
        targetLayerName,
        name,
        reason: "No image selected.",
      });
      continue;
    }

    if (!fileToken && !folder) {
      missing.push({
        index: i,
        targetLayerName,
        name,
        reason: "Choose an image folder first.",
      });
      continue;
    }

    try {
      const file = await resolveImageFile(folder, options, name, i);
      if (!file) {
        missing.push({
          index: i,
          targetLayerName,
          name,
          reason: "No image match found.",
        });
      }
    } catch (e: any) {
      missing.push({
        index: i,
        targetLayerName,
        name,
        reason: e?.message ?? String(e),
      });
    }
  }

  return {
    rowCount,
    detectedCount: detectedIndices.length,
    missing,
  };
};

export const runImageReplacer = async (options: ImageReplacerOptions): Promise<string> => {
  const { names, prefix } = prepare(options);
  const fileTokens = options.fileTokens ?? [];
  const inputCount = Math.max(names.length, fileTokens.length);
  const folder = await getFolderFromToken(options.folderToken);
  const results: string[] = [];
  let detectedIndices: number[] = [];
  let updated = 0;
  let rowCount = 0;
  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("Open your template document first.");
  }

  await withHistory(doc, "Image Replacer", async () => {
    detectedIndices = detectTargetIndices(doc, prefix);
    rowCount = Math.min(inputCount, maxTargetIndex(detectedIndices));

    for (let i = 0; i < rowCount; i++) {
      const name = names[i] ?? "";
      const targetLayerName = targetNameForRow(prefix, i);
      const fileToken = String(fileTokens[i] ?? "").trim();

      if (!fileToken && !name.trim()) {
        results.push(`${targetLayerName}: SKIP no image selected`);
        continue;
      }

      if (!fileToken && !folder) {
        results.push(`${targetLayerName}: NO IMAGE FOLDER for "${name}"`);
        continue;
      }

      const file = await resolveImageFile(folder, options, name, i);
      if (!file) {
        results.push(`${targetLayerName}: NO IMAGE MATCH for "${name}"`);
        continue;
      }

      const displayName = name.trim() || String(file.name ?? "");
      const layers = findLayersByName(doc, targetLayerName);
      const replaceableLayers: any[] = [];

      for (const layer of layers) {
        if (await isReplaceableLayer(layer)) replaceableLayers.push(layer);
      }

      if (!replaceableLayers.length) {
        results.push(`${targetLayerName}: target not found or not replaceable`);
        continue;
      }

      let fileForReplace = file;
      let backgroundRemoved = false;

      if (options.removeBackground) {
        try {
          fileForReplace = await processFileWithBackgroundRemoval(file, doc);
          backgroundRemoved = true;
        } catch (e: any) {
          results.push(`${targetLayerName}: background removal failed for "${file.name}" (using original: ${e?.message ?? String(e)})`);
          fileForReplace = file;
        }
      }

      let replacedForTarget = 0;

      for (const layer of replaceableLayers) {
        try {
          await replaceLayerContents(layer, fileForReplace, options.makeUnique);
          replacedForTarget++;
          updated++;
        } catch (e: any) {
          results.push(`${targetLayerName}: ERROR ${displayName} - ${e?.message ?? String(e)}`);
        }
      }

      if (replacedForTarget > 0) {
        results.push(`${targetLayerName}: OK ${displayName} -> ${file.name}${backgroundRemoved ? " (background removed)" : ""}`);
      } else {
        results.push(`${targetLayerName}: target not found or not replaceable`);
      }
    }
  });

  if (!detectedIndices.length) return `No layers found matching ${prefix}1, ${prefix}2...`;
  const extra = inputCount > rowCount ? ` ${inputCount - rowCount} extra row${inputCount - rowCount === 1 ? "" : "s"} ignored.` : "";
  return [`Done - ${updated} replacement${updated === 1 ? "" : "s"} across ${rowCount} target${rowCount === 1 ? "" : "s"}.${extra}`, ...results].join("\n");
};
