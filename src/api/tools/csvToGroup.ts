import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";
import { withHistory } from "../psHistory";
import { normalizeAlias, resolveClubBadge, resolveFlag, resolveSquareClubBadge } from "./badgeFlagAlias";

export type CsvToGroupBadgeStyle = "regular" | "square";
export type CsvToGroupFlagStyle = "square" | "rect";
export type CsvToGroupFitMode = "height" | "contain" | "cover";

export interface CsvToGroupAssetMapping {
  column: string;
  smartObjectName: string;
}

export interface CsvToGroupOptions {
  csvText: string;
  delimiter: string;
  baseGroupName: string;
  textColumns: string[];
  enableBadge: boolean;
  badgeColumn: string;
  badgeSmartObjectName: string;
  badgeMappings?: CsvToGroupAssetMapping[];
  multipleBadges?: boolean;
  badgeGapPx?: number;
  badgeStyle?: CsvToGroupBadgeStyle;
  enableFlag: boolean;
  flagColumn: string;
  flagSmartObjectName: string;
  flagMappings?: CsvToGroupAssetMapping[];
  multipleFlags?: boolean;
  flagGapPx?: number;
  flagStyle: CsvToGroupFlagStyle;
  keepBaseVisible: boolean;
  clipToBase: boolean;
  fitMode: CsvToGroupFitMode;
}

export interface CsvToGroupFieldScanResult {
  baseGroupName: string;
  textColumns: string[];
}

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

interface AssetDiskIndex {
  byFileStem: Map<string, string>;
  ambiguousFileStems: Set<string>;
}

type AssetDiskIndexer = (index: AssetDiskIndex, relativePath: string) => void;

const DEFAULT_CACHE_ROOT = "C:/Temp";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

const assetDiskIndexPromises = new Map<string, Promise<AssetDiskIndex>>();

function clearAssetDiskIndexCache(): void {
  assetDiskIndexPromises.clear();
}

function getStoredCacheRoot(): string {
  try {
    const stored = (window.localStorage.getItem("cacheRootPath") ?? "").trim();
    return stored || DEFAULT_CACHE_ROOT;
  } catch (_) {
    return DEFAULT_CACHE_ROOT;
  }
}

function joinNativePath(root: string, relativePath: string): string {
  const cleanRoot = root.trim().replace(/[\\/]+$/, "");
  const cleanRelative = relativePath.replace(/^[\\/]+/, "");
  const separator = cleanRoot.includes("\\") ? "\\" : "/";
  return `${cleanRoot}${separator}${cleanRelative.replace(/[\\/]+/g, separator)}`;
}

function nativePathToFileUrl(nativePath: string): string {
  const slashPath = nativePath.replace(/\\/g, "/");
  return /^[a-zA-Z]:\//.test(slashPath) ? `file:/${slashPath}` : `file:${slashPath}`;
}

function trimCopySuffix(name: string): string {
  return String(name ?? "").trim().replace(/ copy( \d+)?$/i, "").trim();
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function getLayerBounds(layer: any) {
  const b = layer.bounds;
  return {
    left: toNumber(b.left),
    top: toNumber(b.top),
    right: toNumber(b.right),
    bottom: toNumber(b.bottom),
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function fileStem(relativePath: string): string {
  return (relativePath.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
}

function assetCandidateKeys(name: string): string[] {
  const raw = name.trim();
  const withoutCommonTerms = raw
    .replace(/\bnational\s+(team|badge|crest|flag)\b/gi, " ")
    .replace(/\bnational\b/gi, " ")
    .replace(/\bbadge\b/gi, " ")
    .replace(/\bcrest\b/gi, " ")
    .replace(/\bflag\b/gi, " ")
    .replace(/\bfootball\s+team\b/gi, " ")
    .replace(/\bfootball\s+club\b/gi, " ")
    .replace(/\bf\.?\s*c\.?\b/gi, " ")
    .replace(/\b(a\.?\s*f\.?\s*c\.?|c\.?\s*f\.?|s\.?\s*c\.?)\b/gi, " ")
    .replace(/\bclub\b/gi, " ");
  const base = normalizeAlias(raw);
  const stripped = normalizeAlias(withoutCommonTerms);
  const candidates = [base, stripped];

  if (base.endsWith("fc")) candidates.push(base.slice(0, -2));
  if (base.startsWith("fc")) candidates.push(base.slice(2));
  if (base.endsWith("cf")) candidates.push(base.slice(0, -2));
  if (base.startsWith("cf")) candidates.push(base.slice(2));

  return unique(candidates);
}

function addDiskIndexKey(index: AssetDiskIndex, key: string, relativePath: string): void {
  if (!key || index.ambiguousFileStems.has(key)) return;

  const existing = index.byFileStem.get(key);
  if (!existing) {
    index.byFileStem.set(key, relativePath);
    return;
  }

  if (existing !== relativePath) {
    index.byFileStem.delete(key);
    index.ambiguousFileStems.add(key);
  }
}

function addBadgeFile(index: AssetDiskIndex, relativePath: string): void {
  const fileName = relativePath.split("/").pop() ?? "";
  if (!/\.png$/i.test(fileName)) return;

  const stem = fileName.replace(/\.png$/i, "");
  for (const candidate of assetCandidateKeys(stem)) {
    addDiskIndexKey(index, candidate, relativePath);
  }
}

function addSquareBadgeFile(index: AssetDiskIndex, relativePath: string): void {
  const fileName = relativePath.split("/").pop() ?? "";
  if (!/\.png$/i.test(fileName)) return;

  const stem = fileName.replace(/\.png$/i, "").replace(/-?square$/i, "");
  for (const candidate of assetCandidateKeys(stem)) {
    addDiskIndexKey(index, candidate, relativePath);
  }
}

function addFlagFile(index: AssetDiskIndex, relativePath: string): void {
  const fileName = relativePath.split("/").pop() ?? "";
  if (!/\.png$/i.test(fileName)) return;

  const stem = normalizeAlias(fileName.replace(/\.png$/i, ""));
  const candidates = [
    stem,
    stem.replace(/flagsquare$/i, ""),
    stem.replace(/flagrectangle$/i, ""),
    stem.replace(/square$/i, ""),
    stem.replace(/rectangle$/i, ""),
    stem.replace(/flag$/i, ""),
  ];

  for (const candidate of unique(candidates)) {
    addDiskIndexKey(index, candidate, relativePath);
  }
}

async function readFolderEntries(folder: any): Promise<any[]> {
  if (typeof folder?.getEntries !== "function") return [];
  return Array.from<any>(await folder.getEntries());
}

async function indexAssetFolder(folder: any, relativeDir: string, index: AssetDiskIndex, addFile: AssetDiskIndexer): Promise<void> {
  const entries = await readFolderEntries(folder);
  for (const entry of entries) {
    const name = String(entry.name ?? "");
    if (!name) continue;

    const relativePath = `${relativeDir}/${name}`;
    if (entry.isFolder) {
      await indexAssetFolder(entry, relativePath, index, addFile);
    } else if (entry.isFile) {
      addFile(index, relativePath);
    }
  }
}

async function getAssetDiskIndex(cacheRoot: string, relativeRoot: string, fs: any, addFile: AssetDiskIndexer): Promise<AssetDiskIndex> {
  const cacheKey = `${cacheRoot}::${relativeRoot}`;
  if (!assetDiskIndexPromises.has(cacheKey)) {
    assetDiskIndexPromises.set(cacheKey, (async () => {
      const index: AssetDiskIndex = {
        byFileStem: new Map<string, string>(),
        ambiguousFileStems: new Set<string>(),
      };
      const nativeRoot = joinNativePath(cacheRoot, relativeRoot);
      const folder = await fs.getEntryWithUrl(nativePathToFileUrl(nativeRoot));
      await indexAssetFolder(folder, relativeRoot, index, addFile);
      return index;
    })());
  }

  return assetDiskIndexPromises.get(cacheKey)!;
}

async function aliasFileExists(cacheRoot: string, relativePath: string, fs: any): Promise<boolean> {
  try {
    const fullPath = joinNativePath(cacheRoot, relativePath);
    const entry = await fs.getEntryWithUrl(nativePathToFileUrl(fullPath));
    return Boolean(entry?.isFile);
  } catch (_) {
    return false;
  }
}

async function resolveAliasPathOrSibling(
  cacheRoot: string,
  relativePath: string,
  candidates: string[],
  fs: any,
  addFile: AssetDiskIndexer
): Promise<string | null> {
  if (await aliasFileExists(cacheRoot, relativePath, fs)) return relativePath;

  const relativeDir = relativePath.split("/").slice(0, -1).join("/");
  if (!relativeDir) return null;

  try {
    const index = await getAssetDiskIndex(cacheRoot, relativeDir, fs, addFile);
    for (const candidate of candidates) {
      const siblingPath = index.byFileStem.get(candidate);
      if (siblingPath) return siblingPath;
    }
  } catch (_) {}

  return null;
}

function clubBadgeCandidateKeys(name: string, style: CsvToGroupBadgeStyle): string[] {
  const candidates = assetCandidateKeys(name);
  if (style !== "square") return candidates;

  for (const candidate of [...candidates]) {
    const regularPath = resolveClubBadge(candidate);
    if (regularPath) candidates.push(normalizeAlias(fileStem(regularPath)));
  }
  return unique(candidates);
}

async function resolveClubBadgePath(
  name: string,
  style: CsvToGroupBadgeStyle,
  cacheRoot: string,
  fs: any
): Promise<string | null> {
  const candidates = assetCandidateKeys(name);

  if (style === "regular") {
    for (const candidate of candidates) {
      const aliasPath = resolveClubBadge(candidate);
      if (aliasPath) {
        const resolvedPath = await resolveAliasPathOrSibling(cacheRoot, aliasPath, candidates, fs, addBadgeFile);
        if (resolvedPath) return resolvedPath;
      }
    }

    const diskIndex = await getAssetDiskIndex(cacheRoot, "badges/club-badges", fs, addBadgeFile);
    for (const candidate of candidates) {
      const diskPath = diskIndex.byFileStem.get(candidate);
      if (diskPath) return diskPath;
    }
    return null;
  }

  for (const candidate of candidates) {
    const aliasPath = resolveSquareClubBadge(candidate);
    if (aliasPath) {
      const resolvedPath = await resolveAliasPathOrSibling(cacheRoot, aliasPath, candidates, fs, addSquareBadgeFile);
      if (resolvedPath) return resolvedPath;
    }
  }

  let diskIndex: AssetDiskIndex;
  try {
    diskIndex = await getAssetDiskIndex(cacheRoot, "badges/square-badges", fs, addSquareBadgeFile);
  } catch (_) {
    return null;
  }

  for (const candidate of clubBadgeCandidateKeys(name, style)) {
    const diskPath = diskIndex.byFileStem.get(candidate);
    if (diskPath) return diskPath;
  }

  return null;
}

async function resolveFlagPath(name: string, flagStyle: CsvToGroupFlagStyle, cacheRoot: string, fs: any): Promise<string | null> {
  const candidates = assetCandidateKeys(name);

  for (const candidate of candidates) {
    const flag = resolveFlag(candidate);
    if (!flag) continue;
    const aliasPath = flagStyle === "square" ? flag.square : (flag.rect ?? flag.square);
    if (aliasPath) {
      const resolvedPath = await resolveAliasPathOrSibling(cacheRoot, aliasPath, candidates, fs, addFlagFile);
      if (resolvedPath) return resolvedPath;
    }
  }

  const preferredRoot = flagStyle === "square" ? "flags/flags-square" : "flags/flags-rectangle";
  const fallbackRoot = flagStyle === "square" ? "flags/flags-rectangle" : "flags/flags-square";

  for (const root of flagStyle === "square" ? [preferredRoot] : [preferredRoot, fallbackRoot]) {
    const diskIndex = await getAssetDiskIndex(cacheRoot, root, fs, addFlagFile);
    for (const candidate of candidates) {
      const diskPath = diskIndex.byFileStem.get(candidate);
      if (diskPath) return diskPath;
    }
  }

  return null;
}

async function resolveAssetEntry(
  name: string,
  type: "badge" | "flag",
  badgeStyle: CsvToGroupBadgeStyle,
  flagStyle: CsvToGroupFlagStyle,
  cacheRoot: string,
  fs: any
): Promise<any | null> {
  let relativePath: string | null = null;

  if (type === "badge") {
    relativePath = await resolveClubBadgePath(name, badgeStyle, cacheRoot, fs);
  } else {
    relativePath = await resolveFlagPath(name, flagStyle, cacheRoot, fs);
  }

  if (!relativePath) return null;
  return fs.getEntryWithUrl(nativePathToFileUrl(joinNativePath(cacheRoot, relativePath)));
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  cells.push(current.trim());
  return cells;
}

function parseCsv(csvText: string, delimiter: string): ParsedCsv {
  const lines = String(csvText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const firstLine = lines.findIndex(line => line.trim());
  if (firstLine < 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[firstLine], delimiter);
  const rows = lines
    .slice(firstLine + 1)
    .filter(line => line.trim())
    .map(line => parseCsvLine(line, delimiter));

  return { headers, rows };
}

function headerIndex(headers: string[], columnName: string): number {
  const target = columnName.trim();
  return headers.findIndex(header => header.trim() === target);
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

function getTopLevelGroupByName(doc: any, name: string): any | null {
  try {
    return Array.from<any>(doc.layers).find(layer => layer.kind === "group" && String(layer.name ?? "") === name) ?? null;
  } catch (_) {
    return null;
  }
}

function findTextLayerByBaseName(group: any, baseName: string): any | null {
  const target = baseName.trim();
  return getAllLayers(group).find(layer => layer.kind === "text" && trimCopySuffix(String(layer.name ?? "")) === target) ?? null;
}

function listTextLayerBaseNames(group: any): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const layer of getAllLayers(group)) {
    if (layer.kind !== "text") continue;
    const name = trimCopySuffix(String(layer.name ?? ""));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  return names;
}

function findLayerByBaseName(group: any, baseName: string): any | null {
  const target = baseName.trim();
  return getAllLayers(group).find(layer => trimCopySuffix(String(layer.name ?? "")) === target) ?? null;
}

interface CsvToGroupResolvedAssetMapping extends CsvToGroupAssetMapping {
  columnIndex: number;
}

function splitAssetCell(value: string): string[] {
  return String(value ?? "")
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

function layerCenter(layer: any): { x: number; y: number } {
  const bounds = getLayerBounds(layer);
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  };
}

function normalGap(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

async function duplicateAssetSeedLayers(seedLayer: any, count: number, seedName: string): Promise<any[]> {
  const layers: any[] = [];
  seedLayer.name = `${seedName}_1`;
  layers.push(seedLayer);

  let anchor = seedLayer;
  for (let i = 1; i < count; i++) {
    const duplicate = await seedLayer.duplicate(anchor, photoshop.constants.ElementPlacement.PLACEAFTER);
    duplicate.name = `${seedName}_${i + 1}`;
    layers.push(duplicate);
    anchor = duplicate;
  }

  return layers;
}

async function getLayerBoundsById(id: number) {
  await selectLayerById(id);
  const descriptor = await getActiveLayerDescriptor();
  const bounds = descriptor.bounds ?? descriptor.boundsNoEffects;
  if (!bounds) throw new Error(`Could not read bounds for layer ${id}.`);
  return {
    left: toNumber(bounds.left),
    top: toNumber(bounds.top),
    right: toNumber(bounds.right),
    bottom: toNumber(bounds.bottom),
  };
}

async function translateLayerById(id: number, dx: number, dy: number): Promise<void> {
  if (dx === 0 && dy === 0) return;
  await selectLayerById(id);
  await transformActiveLayer(undefined, dx, dy);
}

async function distributeLayerIdsAroundCenter(layerIds: number[], centerX: number, centerY: number, gapPx: number): Promise<void> {
  const usableIds = layerIds.filter(id => Number.isFinite(id) && id > 0);
  if (!usableIds.length) return;

  const boundsList = [];
  for (const id of usableIds) {
    boundsList.push(await getLayerBoundsById(id));
  }

  const widths = boundsList.map(bounds => Math.max(1, bounds.right - bounds.left));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + (Math.max(0, usableIds.length - 1) * gapPx);
  let left = centerX - (totalWidth / 2);

  for (let i = 0; i < usableIds.length; i++) {
    const bounds = boundsList[i];
    const width = widths[i];
    const currentCenterX = (bounds.left + bounds.right) / 2;
    const currentCenterY = (bounds.top + bounds.bottom) / 2;
    const targetCenterX = left + (width / 2);
    await translateLayerById(usableIds[i], Math.round(targetCenterX - currentCenterX), Math.round(centerY - currentCenterY));
    left += width + gapPx;
  }
}

function hideLayerQuietly(layer: any): void {
  try { layer.visible = false; } catch (_) {}
}
async function selectLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
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

async function renameActiveLayer(name: string): Promise<void> {
  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "layer", name },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function getActiveLayerDescriptor(): Promise<any> {
  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  return result[0] ?? {};
}

async function makeSmartObjectIndependent(layer: any): Promise<number> {
  const originalId = layer.id as number;
  const originalName = String(layer.name ?? "");

  await selectLayerById(originalId);
  await batchPlay([{ _obj: "placedLayerMakeCopy", _options: { dialogOptions: "dontDisplay" } }], {});

  const descriptor = await getActiveLayerDescriptor();
  const newId = descriptor.layerID as number;
  if (!newId || newId === originalId) throw new Error(`Could not make "${originalName}" independent.`);

  if (originalName) await renameActiveLayer(originalName);
  await deleteLayerById(originalId);
  return newId;
}

function findBaseLayer(soDoc: any, soName: string): any | null {
  const layers = Array.from<any>(soDoc.layers);
  const cleanName = trimCopySuffix(soName);

  for (let i = layers.length - 1; i >= 0; i--) {
    if (trimCopySuffix(String(layers[i].name ?? "")) === cleanName) return layers[i];
  }
  for (let i = layers.length - 1; i >= 0; i--) {
    const name = String(layers[i].name ?? "").toLowerCase();
    if (name.startsWith("shape_") || name === "shape" || name.startsWith("shape ")) return layers[i];
  }
  for (const layer of layers) {
    if (String(layer.name ?? "").toLowerCase() === "background") return layer;
  }
  return layers[layers.length - 1] ?? null;
}

async function deleteActiveLayer(): Promise<void> {
  await batchPlay([{
    _obj: "delete",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

function getDocumentModeName(doc: any): string {
  const mode = doc?.mode;
  if (typeof mode === "string") return mode;
  if (mode && typeof mode._value === "string") return mode._value;
  return String(mode ?? "");
}

async function convertIndexedDocumentToRgbLayer(srcDoc: any): Promise<void> {
  photoshop.app.activeDocument = srcDoc;

  await batchPlay([{
    _obj: "convertMode",
    to: { _class: "RGBColorMode" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});

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

async function prepareSourceLayerForDuplicate(srcDoc: any): Promise<any> {
  photoshop.app.activeDocument = srcDoc;

  if (getDocumentModeName(srcDoc) === "indexedColorMode") {
    await convertIndexedDocumentToRgbLayer(srcDoc);
  }

  try {
    if (srcDoc.layers && srcDoc.layers.length > 1 && typeof srcDoc.flatten === "function") {
      await srcDoc.flatten();
    }
  } catch (_) {}

  const srcLayer = srcDoc.activeLayer ?? Array.from<any>(srcDoc.layers)[0];
  if (!srcLayer) throw new Error(`Could not read layer from ${srcDoc.title ?? "source document"}.`);
  return srcLayer;
}

async function transformActiveLayer(scalePercent?: number, dx = 0, dy = 0): Promise<void> {
  const desc: any = {
    _obj: "transform",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    linked: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
    _options: { dialogOptions: "dontDisplay" },
  };

  if (scalePercent !== undefined) {
    desc.width = { _unit: "percentUnit", _value: scalePercent };
    desc.height = { _unit: "percentUnit", _value: scalePercent };
  }

  if (dx !== 0 || dy !== 0) {
    desc.offset = {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy },
    };
  }

  await batchPlay([desc], {});
}

async function clipActiveLayer(): Promise<void> {
  await batchPlay([{
    _obj: "groupEvent",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function replaceSmartObjectContents(
  hostDoc: any,
  targetLayer: any,
  assetEntry: any,
  options: Pick<CsvToGroupOptions, "clipToBase" | "fitMode" | "keepBaseVisible">
): Promise<number> {
  let soDoc: any = null;
  let srcDoc: any = null;
  const originalName = String(targetLayer.name ?? "");

  photoshop.app.activeDocument = hostDoc;
  const independentId = await makeSmartObjectIndependent(targetLayer);
  await selectLayerById(independentId);

  try {
    const targetInfo = await getActiveLayerDescriptor();
    if (!targetInfo.smartObject) throw new Error(`${originalName} is not a Smart Object.`);

    await batchPlay([{ _obj: "placedLayerEditContents", _options: { dialogOptions: "dontDisplay" } }], {});

    soDoc = photoshop.app.activeDocument as any;
    const soW = toNumber(soDoc.width);
    const soH = toNumber(soDoc.height);
    const baseLayer = findBaseLayer(soDoc, originalName);
    if (!baseLayer) throw new Error("No base layer found inside Smart Object.");
    const baseId = baseLayer.id as number;

    for (const layer of Array.from<any>(soDoc.layers)) {
      if ((layer.id as number) === baseId) continue;
      await selectLayerById(layer.id as number);
      await deleteActiveLayer();
    }

    srcDoc = await photoshop.app.open(assetEntry);
    const srcLayer = await prepareSourceLayerForDuplicate(srcDoc);
    await srcLayer.duplicate(soDoc, photoshop.constants.ElementPlacement.PLACEATBEGINNING);
    await srcDoc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
    srcDoc = null;
    photoshop.app.activeDocument = soDoc;

    const assetLayer = Array.from<any>(soDoc.layers)[0];
    await selectLayerById(assetLayer.id as number);

    let bounds = getLayerBounds(assetLayer);
    const assetW = Math.max(1, bounds.right - bounds.left);
    const assetH = Math.max(1, bounds.bottom - bounds.top);
    const scale =
      options.fitMode === "cover" ? Math.max(soW / assetW, soH / assetH) * 100 :
      options.fitMode === "contain" ? Math.min(soW / assetW, soH / assetH) * 100 :
      (soH / assetH) * 100;

    await transformActiveLayer(scale);

    bounds = getLayerBounds(assetLayer);
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    await transformActiveLayer(undefined, (soW / 2) - cx, (soH / 2) - cy);

    baseLayer.visible = options.keepBaseVisible || options.clipToBase;
    if (options.clipToBase) {
      await selectLayerById(assetLayer.id as number);
      await clipActiveLayer();
    }

    await soDoc.close(photoshop.constants.SaveOptions.SAVECHANGES);
    soDoc = null;
    photoshop.app.activeDocument = hostDoc;
    return independentId;
  } catch (e) {
    try {
      if (srcDoc) {
        photoshop.app.activeDocument = srcDoc;
        await srcDoc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
      }
    } catch (_) {}
    try {
      if (soDoc) {
        photoshop.app.activeDocument = soDoc;
        await soDoc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
      }
    } catch (_) {}
    try { photoshop.app.activeDocument = hostDoc; } catch (_) {}
    throw e;
  }
}

async function collapseAllGroups(): Promise<void> {
  try {
    await batchPlay([{ _obj: "collapseAllGroupsEvent", _options: { dialogOptions: "dontDisplay" } }], {});
  } catch (_) {}
}

export const scanCsvToGroupFields = async (baseGroupName = "BASE GROUP"): Promise<CsvToGroupFieldScanResult> => {
  let textColumns: string[] = [];
  const cleanBaseGroupName = baseGroupName.trim() || "BASE GROUP";

  await asModal("Scan CSV to Group Fields", async () => {
    const doc = photoshop.app.activeDocument as any;
    const templateGroup = getTopLevelGroupByName(doc, cleanBaseGroupName);
    if (!templateGroup) throw new Error(`Could not find a top-level group called "${cleanBaseGroupName}".`);
    textColumns = listTextLayerBaseNames(templateGroup);
  });

  return {
    baseGroupName: cleanBaseGroupName,
    textColumns,
  };
};

export const runCsvToGroup = async (options: CsvToGroupOptions): Promise<string> => {
  clearAssetDiskIndexCache();

  const csv = parseCsv(options.csvText, options.delimiter || ",");
  if (!csv.headers.length || !csv.rows.length) return "CSV must have a header row and at least one data row.";

  const textColumns = options.textColumns.map(column => column.trim()).filter(Boolean);
  if (!textColumns.length) return "Add at least one text column. The first one names each duplicated group.";

  const textColumnIndices = textColumns.map(column => {
    const index = headerIndex(csv.headers, column);
    if (index < 0) throw new Error(`Could not find text column "${column}" in the CSV header.`);
    return index;
  });

  const cleanAssetMappings = (
    mappings: CsvToGroupAssetMapping[] | undefined,
    fallbackColumn: string,
    fallbackSmartObjectName: string
  ): CsvToGroupAssetMapping[] => {
    const source = mappings?.length ? mappings : [{ column: fallbackColumn, smartObjectName: fallbackSmartObjectName }];
    return source
      .map(mapping => ({
        column: String(mapping.column ?? "").trim(),
        smartObjectName: String(mapping.smartObjectName ?? "").trim(),
      }))
      .filter(mapping => mapping.column && mapping.smartObjectName);
  };

  const resolveAssetMappings = (kind: "badge" | "flag", mappings: CsvToGroupAssetMapping[]): CsvToGroupResolvedAssetMapping[] => {
    return mappings.map(mapping => {
      const columnIndex = headerIndex(csv.headers, mapping.column);
      if (columnIndex < 0) throw new Error(`${kind === "badge" ? "Badge" : "Flag"} column "${mapping.column}" was not found.`);
      return { ...mapping, columnIndex };
    });
  };

  const badgeMappings = options.enableBadge
    ? cleanAssetMappings(options.badgeMappings, options.badgeColumn, options.badgeSmartObjectName)
    : [];
  const flagMappings = options.enableFlag
    ? cleanAssetMappings(options.flagMappings, options.flagColumn, options.flagSmartObjectName)
    : [];

  if (options.enableBadge && !badgeMappings.length) throw new Error("Add at least one badge column and Smart Object mapping.");
  if (options.enableFlag && !flagMappings.length) throw new Error("Add at least one flag column and Smart Object mapping.");

  const badgeTargets = resolveAssetMappings("badge", badgeMappings);
  const flagTargets = resolveAssetMappings("flag", flagMappings);
  const groupNameIndex = textColumnIndices[0];
  const cacheRoot = getStoredCacheRoot();
  const badgeGapPx = normalGap(options.badgeGapPx, 12);
  const flagGapPx = normalGap(options.flagGapPx, 12);
  const { localFileSystem: fs } = (require("uxp") as any).storage;

  const notes: string[] = [];
  let duplicated = 0;
  let textUpdates = 0;
  let badgeUpdates = 0;
  let flagUpdates = 0;
  let skippedRows = 0;
  const doc = photoshop.app.activeDocument as any;

  await withHistory(doc, "CSV to Group", async () => {
    const templateGroup = getTopLevelGroupByName(doc, options.baseGroupName || "BASE GROUP");
    if (!templateGroup) throw new Error(`Could not find a top-level group called "${options.baseGroupName || "BASE GROUP"}".`);

    for (let rowIndex = csv.rows.length - 1; rowIndex >= 0; rowIndex--) {
      const row = csv.rows[rowIndex];
      const groupLabel = String(row[groupNameIndex] ?? "").trim();
      if (!groupLabel) {
        skippedRows++;
        notes.push(`Row ${rowIndex + 2}: skipped because the group-name column is blank.`);
        continue;
      }

      photoshop.app.activeDocument = doc;
      const newGroup = await templateGroup.duplicate(templateGroup, photoshop.constants.ElementPlacement.PLACEAFTER);
      newGroup.name = groupLabel;
      duplicated++;

      for (let i = 0; i < textColumns.length; i++) {
        const value = String(row[textColumnIndices[i]] ?? "").trim();
        if (!value) continue;

        const layer = findTextLayerByBaseName(newGroup, textColumns[i]);
        if (!layer) {
          notes.push(`Row ${rowIndex + 2} "${groupLabel}": text layer "${textColumns[i]}" not found.`);
          continue;
        }
        try {
          layer.textItem.contents = value;
          textUpdates++;
        } catch (e: any) {
          notes.push(`Row ${rowIndex + 2} "${groupLabel}": text layer "${textColumns[i]}" failed (${e?.message ?? String(e)}).`);
        }
      }

      const processAssetMapping = async (
        mapping: CsvToGroupResolvedAssetMapping,
        type: "badge" | "flag",
        useMultiple: boolean,
        gapPx: number
      ) => {
        const rawValue = String(row[mapping.columnIndex] ?? "").trim();
        if (!rawValue) return;

        const values = useMultiple ? splitAssetCell(rawValue) : [rawValue];
        if (!values.length) return;

        const seedLayer = findLayerByBaseName(newGroup, mapping.smartObjectName);
        if (!seedLayer) {
          notes.push(`Row ${rowIndex + 2} "${groupLabel}": Smart Object "${mapping.smartObjectName}" not found.`);
          return;
        }

        const incrementCount = () => {
          if (type === "badge") badgeUpdates++;
          else flagUpdates++;
        };

        const assetLabel = type === "badge" && options.badgeStyle === "square"
          ? "square badge"
          : type === "flag" && options.flagStyle === "square"
            ? "square flag"
            : type;

        if (!useMultiple) {
          const value = values[0];
          try {
            const entry = await resolveAssetEntry(
              value,
              type,
              options.badgeStyle ?? "regular",
              options.flagStyle,
              cacheRoot,
              fs
            );
            if (!entry) {
              notes.push(`Row ${rowIndex + 2} "${groupLabel}": no ${assetLabel} match for "${value}".`);
            } else {
              await replaceSmartObjectContents(doc, seedLayer, entry, options);
              incrementCount();
            }
          } catch (e: any) {
            notes.push(`Row ${rowIndex + 2} "${groupLabel}": ${type} "${value}" failed (${e?.message ?? String(e)}).`);
          }
          return;
        }

        const center = layerCenter(seedLayer);
        const generatedLayers = await duplicateAssetSeedLayers(seedLayer, values.length, mapping.smartObjectName);
        const replacedLayerIds: number[] = [];

        for (let i = 0; i < values.length; i++) {
          const value = values[i];
          const targetLayer = generatedLayers[i];

          try {
            const entry = await resolveAssetEntry(
              value,
              type,
              options.badgeStyle ?? "regular",
              options.flagStyle,
              cacheRoot,
              fs
            );
            if (!entry) {
              hideLayerQuietly(targetLayer);
              notes.push(`Row ${rowIndex + 2} "${groupLabel}": no ${assetLabel} match for "${value}".`);
              continue;
            }

            const finalLayerId = await replaceSmartObjectContents(doc, targetLayer, entry, options);
            replacedLayerIds.push(finalLayerId);
            incrementCount();
          } catch (e: any) {
            hideLayerQuietly(targetLayer);
            notes.push(`Row ${rowIndex + 2} "${groupLabel}": ${type} "${value}" failed (${e?.message ?? String(e)}).`);
          }
        }

        try {
          await distributeLayerIdsAroundCenter(replacedLayerIds, center.x, center.y, gapPx);
        } catch (e: any) {
          notes.push(`Row ${rowIndex + 2} "${groupLabel}": ${type} layout failed (${e?.message ?? String(e)}).`);
        }
      };

      for (const mapping of badgeTargets) {
        await processAssetMapping(mapping, "badge", Boolean(options.multipleBadges), badgeGapPx);
      }

      for (const mapping of flagTargets) {
        await processAssetMapping(mapping, "flag", Boolean(options.multipleFlags), flagGapPx);
      }
    }

    await collapseAllGroups();
  });

  const lines = [
    `Done. Duplicated ${duplicated} group${duplicated === 1 ? "" : "s"}.`,
    `${textUpdates} text update${textUpdates === 1 ? "" : "s"}, ${badgeUpdates} badge${badgeUpdates === 1 ? "" : "s"}, ${flagUpdates} flag${flagUpdates === 1 ? "" : "s"}.`,
  ];
  if (skippedRows) lines.push(`${skippedRows} row${skippedRows === 1 ? "" : "s"} skipped.`);
  if (notes.length) lines.push(`Notes:\n - ${notes.join("\n - ")}`);
  return lines.join("\n");
};
