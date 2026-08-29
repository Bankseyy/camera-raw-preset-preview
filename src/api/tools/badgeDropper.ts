import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";
import { withHistory } from "../psHistory";
import {
  normalizeAlias,
  resolveClubBadge,
  resolveFlag,
  resolveNationalBadge,
  resolveSquareClubBadge,
} from "./badgeFlagAlias";

export type BadgeDropperMode = "club" | "national" | "flag";
export type BadgeDropperClubBadgeStyle = "regular" | "square" | "dark" | "light";
export type BadgeDropperFlagStyle = "square" | "rect";
export type BadgeDropperFitMode = "height" | "contain" | "cover";

export interface BadgeDropperOptions {
  mode: BadgeDropperMode;
  clubBadgeStyle?: BadgeDropperClubBadgeStyle;
  flagStyle: BadgeDropperFlagStyle;
  targetPrefix: string;
  startIndex: number;
  names: string[];
  textValues?: string[];
  keepBaseVisible: boolean;
  clipToBase: boolean;
  fitMode: BadgeDropperFitMode;
  autoDetectTargetCount?: boolean;
}

export interface BadgeDropperPreflightIssue {
  index: number;
  targetLayerName: string;
  name: string;
  reason: string;
  relativePath?: string;
  fullPath?: string;
}

export interface BadgeDropperPreflightResult {
  rowCount: number;
  inputCount: number;
  detectedCount?: number;
  skippedExtraRows: number;
  missing: BadgeDropperPreflightIssue[];
}

export interface ResolvedClubBadgeAsset {
  relativePath: string;
  fullPath: string;
  entry: any;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

const DEFAULT_CACHE_ROOT = "C:/Temp";

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

interface BadgeDiskIndex {
  byFileStem: Map<string, string>;
  ambiguousFileStems: Set<string>;
}

type BadgeDiskIndexer = (index: BadgeDiskIndex, relativePath: string) => void;

const badgeDiskIndexPromises = new Map<string, Promise<BadgeDiskIndex>>();

function clearBadgeDiskIndexCache(): void {
  badgeDiskIndexPromises.clear();
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
    .replace(/\bnational\s+(team|badge|crest)\b/gi, " ")
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

function addDiskIndexKey(index: BadgeDiskIndex, key: string, relativePath: string): void {
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

function addBadgeFile(index: BadgeDiskIndex, relativePath: string): void {
  const fileName = relativePath.split("/").pop() ?? "";
  if (!/\.png$/i.test(fileName)) return;

  const stem = fileName.replace(/\.png$/i, "");
  for (const candidate of assetCandidateKeys(stem)) {
    addDiskIndexKey(index, candidate, relativePath);
  }
}

function addSquareBadgeFile(index: BadgeDiskIndex, relativePath: string): void {
  const fileName = relativePath.split("/").pop() ?? "";
  if (!/\.png$/i.test(fileName)) return;

  const stem = fileName.replace(/\.png$/i, "").replace(/-?square$/i, "");
  for (const candidate of assetCandidateKeys(stem)) {
    addDiskIndexKey(index, candidate, relativePath);
  }
}

function addMonoBadgeFile(index: BadgeDiskIndex, relativePath: string): void {
  const fileName = relativePath.split("/").pop() ?? "";
  if (!/\.png$/i.test(fileName)) return;

  const stem = fileName
    .replace(/\.png$/i, "")
    .replace(/-?mono-?(dark|light)$/i, "")
    .replace(/-?(dark|light)$/i, "");
  const candidates = assetCandidateKeys(stem);

  for (const candidate of candidates) {
    addDiskIndexKey(index, candidate, relativePath);
  }
}

function addFlagFile(index: BadgeDiskIndex, relativePath: string): void {
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
  if (typeof folder.getEntries !== "function") return [];
  return Array.from<any>(await folder.getEntries());
}

async function indexBadgeFolder(folder: any, relativeDir: string, index: BadgeDiskIndex, addFile: BadgeDiskIndexer): Promise<void> {
  const entries = await readFolderEntries(folder);

  for (const entry of entries) {
    const name = String(entry.name ?? "");
    if (!name) continue;

    const relativePath = `${relativeDir}/${name}`;
    if (entry.isFolder) {
      await indexBadgeFolder(entry, relativePath, index, addFile);
    } else if (entry.isFile) {
      addFile(index, relativePath);
    }
  }
}

async function findBadgeFileByCandidates(
  folder: any,
  relativeDir: string,
  candidates: string[]
): Promise<string | null> {
  const wanted = new Set(candidates);
  const entries = await readFolderEntries(folder);

  for (const entry of entries) {
    const name = String(entry.name ?? "");
    if (!name) continue;

    const relativePath = `${relativeDir}/${name}`;
    if (entry.isFolder) {
      const nestedMatch = await findBadgeFileByCandidates(entry, relativePath, candidates);
      if (nestedMatch) return nestedMatch;
      continue;
    }

    if (!entry.isFile || !/\.png$/i.test(name)) continue;
    const stem = name.replace(/\.png$/i, "");
    if (assetCandidateKeys(stem).some(candidate => wanted.has(candidate))) {
      return relativePath;
    }
  }

  return null;
}

async function findBadgeFileInRoot(
  cacheRoot: string,
  relativeRoot: string,
  candidates: string[],
  fs: any
): Promise<string | null> {
  for (const root of badgeRelativeRootVariants(cacheRoot, relativeRoot)) {
    try {
      const nativeRoot = joinNativePath(cacheRoot, root);
      const folder = await fs.getEntryWithUrl(nativePathToFileUrl(nativeRoot));
      const match = await findBadgeFileByCandidates(folder, root, candidates);
      if (match) return match;
    } catch (_) {}
  }

  return null;
}

async function getBadgeDiskIndex(cacheRoot: string, relativeRoot: string, fs: any, addFile: BadgeDiskIndexer): Promise<BadgeDiskIndex> {
  const relativeRoots = badgeRelativeRootVariants(cacheRoot, relativeRoot);
  const cacheKey = `${cacheRoot}::${relativeRoots.join("|")}`;
  if (!badgeDiskIndexPromises.has(cacheKey)) {
    badgeDiskIndexPromises.set(cacheKey, (async () => {
      let lastError: unknown;

      for (const root of relativeRoots) {
        try {
          const index: BadgeDiskIndex = {
            byFileStem: new Map<string, string>(),
            ambiguousFileStems: new Set<string>(),
          };
          const nativeRoot = joinNativePath(cacheRoot, root);
          const folder = await fs.getEntryWithUrl(nativePathToFileUrl(nativeRoot));
          await indexBadgeFolder(folder, root, index, addFile);
          return index;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError ?? new Error(`Badge folder not found: ${relativeRoot}`);
    })());
  }

  return badgeDiskIndexPromises.get(cacheKey)!;
}

function badgeRelativeRootVariants(cacheRoot: string, relativeRoot: string): string[] {
  const roots = [relativeRoot];
  const cleanRoot = cacheRoot.trim().replace(/[\\/]+$/, "");
  const rootName = cleanRoot.split(/[\\/]/).pop()?.toLowerCase();

  // Users sometimes choose the badges folder itself as the cache root. In that
  // case the configured relative path must not add a second `badges` segment.
  if (rootName === "badges" && relativeRoot.toLowerCase().startsWith("badges/")) {
    roots.unshift(relativeRoot.slice("badges/".length));
  }

  return unique(roots);
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
  addFile: BadgeDiskIndexer
): Promise<string | null> {
  if (await aliasFileExists(cacheRoot, relativePath, fs)) return relativePath;

  const relativeDir = relativePath.split("/").slice(0, -1).join("/");
  if (!relativeDir) return null;

  try {
    const index = await getBadgeDiskIndex(cacheRoot, relativeDir, fs, addFile);
    for (const candidate of candidates) {
      const siblingPath = index.byFileStem.get(candidate);
      if (siblingPath) return siblingPath;
    }
  } catch (_) {}

  return null;
}

function clubBadgeCandidateKeys(name: string, style: BadgeDropperClubBadgeStyle): string[] {
  const candidates = assetCandidateKeys(name);
  if (style === "regular") return candidates;

  for (const candidate of [...candidates]) {
    const regularPath = resolveClubBadge(candidate);
    if (regularPath) candidates.push(normalizeAlias(fileStem(regularPath)));
  }
  return unique(candidates);
}

async function resolveClubBadgePath(
  name: string,
  style: BadgeDropperClubBadgeStyle,
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

    const diskIndex = await getBadgeDiskIndex(cacheRoot, "badges/club-badges", fs, addBadgeFile);
    for (const candidate of candidates) {
      const diskPath = diskIndex.byFileStem.get(candidate);
      if (diskPath) return diskPath;
    }
    return null;
  }

  let relativeRoot: string;
  if (style === "square") {
    for (const candidate of candidates) {
      const aliasPath = resolveSquareClubBadge(candidate);
      if (aliasPath) {
        const resolvedPath = await resolveAliasPathOrSibling(cacheRoot, aliasPath, candidates, fs, addSquareBadgeFile);
        if (resolvedPath) return resolvedPath;
      }
    }
    relativeRoot = "badges/square-badges";
  } else {
    relativeRoot = style === "dark"
      ? "badges/club-badges-mono-dark"
      : "badges/club-badges-mono-light";
    // Mono badges are intentionally filename-based. Their league folders may
    // be named differently from the regular alias map, or may be reorganized.
    return findBadgeFileInRoot(cacheRoot, relativeRoot, clubBadgeCandidateKeys(name, style), fs);
  }

  let diskIndex: BadgeDiskIndex;
  try {
    diskIndex = await getBadgeDiskIndex(cacheRoot, relativeRoot, fs, addSquareBadgeFile);
  } catch (_) {
    return null;
  }

  for (const candidate of clubBadgeCandidateKeys(name, "square")) {
    const diskPath = diskIndex.byFileStem.get(candidate);
    if (diskPath) return diskPath;
  }

  return null;
}

export function resetClubBadgeAssetResolver(): void {
  clearBadgeDiskIndexCache();
}

export async function resolveClubBadgeAsset(
  name: string,
  style: BadgeDropperClubBadgeStyle = "regular"
): Promise<ResolvedClubBadgeAsset | null> {
  const cacheRoot = getStoredCacheRoot();
  if (!cacheRoot) throw new Error("Set cache root first.");

  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const relativePath = await resolveClubBadgePath(name, style, cacheRoot, fs);
  if (!relativePath) return null;

  const fullPath = joinNativePath(cacheRoot, relativePath);
  const entry = await fs.getEntryWithUrl(nativePathToFileUrl(fullPath));
  if (!entry?.isFile) {
    throw new Error(`Resolved badge is not a file: ${fullPath}`);
  }

  return { relativePath, fullPath, entry };
}

export async function resolveBadgeDropperAsset(
  name: string,
  mode: BadgeDropperMode,
  clubBadgeStyle: BadgeDropperClubBadgeStyle = "regular",
  flagStyle: BadgeDropperFlagStyle = "square"
): Promise<ResolvedClubBadgeAsset | null> {
  const cacheRoot = getStoredCacheRoot();
  if (!cacheRoot) throw new Error("Set cache root first.");

  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const relativePath = await resolveAssetPath(name, mode, clubBadgeStyle, flagStyle, cacheRoot, fs);
  if (!relativePath) return null;

  const fullPath = joinNativePath(cacheRoot, relativePath);
  const entry = await fs.getEntryWithUrl(nativePathToFileUrl(fullPath));
  if (!entry?.isFile) {
    throw new Error(`Resolved ${mode} asset is not a file: ${fullPath}`);
  }

  return { relativePath, fullPath, entry };
}

async function resolveNationalBadgePath(name: string, cacheRoot: string, fs: any): Promise<string | null> {
  const candidates = assetCandidateKeys(name);

  for (const candidate of candidates) {
    const aliasPath = resolveNationalBadge(candidate);
    if (aliasPath) {
      const resolvedPath = await resolveAliasPathOrSibling(cacheRoot, aliasPath, candidates, fs, addBadgeFile);
      if (resolvedPath) return resolvedPath;
    }
  }

  const diskIndex = await getBadgeDiskIndex(cacheRoot, "badges/national-badges", fs, addBadgeFile);
  for (const candidate of candidates) {
    const diskPath = diskIndex.byFileStem.get(candidate);
    if (diskPath) return diskPath;
  }

  return null;
}

async function resolveFlagPath(name: string, flagStyle: BadgeDropperFlagStyle, cacheRoot: string, fs: any): Promise<string | null> {
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
    const diskIndex = await getBadgeDiskIndex(cacheRoot, root, fs, addFlagFile);
    for (const candidate of candidates) {
      const diskPath = diskIndex.byFileStem.get(candidate);
      if (diskPath) return diskPath;
    }
  }

  return null;
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
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

function isLayerLocked(layer: any): boolean {
  try {
    return Boolean(layer?.locked || layer?.allLocked);
  } catch (_) {
    return false;
  }
}

function lockedLayerChain(layer: any): string[] {
  const locked: string[] = [];
  let current = layer;
  while (current && typeof current?.id === "number") {
    if (isLayerLocked(current)) {
      locked.push(String(current.name ?? `Layer ${current.id}`));
    }
    current = current.parent;
  }
  return locked;
}

function assertBadgeTargetsUnlocked(
  doc: any,
  options: BadgeDropperOptions,
  names: string[],
  rowCount: number
): void {
  const layers = getAllLayers(doc);
  const issues: string[] = [];

  for (let index = 0; index < rowCount; index++) {
    if (!String(names[index] ?? "").trim()) continue;

    const targetName = `${options.targetPrefix}${options.startIndex + index}`;
    const matches = layers.filter(layer => String(layer?.name ?? "") === targetName);
    for (const target of matches) {
      const locked = lockedLayerChain(target);
      if (locked.length) {
        issues.push(`${targetName} (locked: ${locked.join(" > ")})`);
      }
    }
  }

  if (issues.length) {
    throw new Error(
      "Badge Dropper stopped before making changes. Unlock these target layers or parent groups first:\n- "
      + Array.from(new Set(issues)).join("\n- ")
    );
  }
}

function updateTextLayer(doc: any, layerName: string, value: string): boolean {
  const text = value.trim();
  if (!text) return false;

  const layer = getAllLayers(doc).find(candidate => String(candidate.name ?? "") === layerName);
  if (!layer) return false;

  try {
    layer.textItem.contents = text;
    return true;
  } catch (_) {
    return false;
  }
}

function detectConsecutiveTargetLayerCount(doc: any, targetPrefix: string, startIndex: number): number {
  const layerNames = new Set(getAllLayers(doc).map(layer => String(layer.name ?? "")));
  let count = 0;
  for (let index = startIndex; layerNames.has(`${targetPrefix}${index}`); index++) {
    count++;
  }
  return count;
}

function prepareRows(options: BadgeDropperOptions): {
  names: string[];
  textValues: string[];
  hasCsvText: boolean;
  inputCount: number;
} {
  const textValues = options.textValues?.map(value => value.trim()) ?? [];
  const hasCsvText = textValues.length > 0;
  const rawNames = options.names.map(name => name.trim());
  const names = Array.from({ length: Math.max(rawNames.length, textValues.length) }, (_, i) => rawNames[i] ?? "");
  const hasAnyAsset = names.some(Boolean);
  const hasAnyText = textValues.some(Boolean);

  return {
    names,
    textValues,
    hasCsvText,
    inputCount: hasAnyAsset || hasAnyText ? names.length : 0,
  };
}

function findBaseLayer(soDoc: any): any | null {
  const layers = Array.from<any>(soDoc.layers);
  for (let i = layers.length - 1; i >= 0; i--) {
    const name = String(layers[i].name ?? "").toLowerCase();
    if (name.startsWith("shape_") || name === "shape" || name.startsWith("shape ")) return layers[i];
  }
  for (const layer of layers) {
    if (String(layer.name ?? "").toLowerCase() === "background") return layer;
  }
  return layers[layers.length - 1] ?? null;
}

async function selectLayerByName(name: string): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _name: name }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function selectLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function deleteActiveLayer(): Promise<void> {
  await batchPlay([{
    _obj: "delete",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
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

async function resolveAssetPath(
  name: string,
  mode: BadgeDropperMode,
  clubBadgeStyle: BadgeDropperClubBadgeStyle,
  flagStyle: BadgeDropperFlagStyle,
  cacheRoot: string,
  fs: any
): Promise<string | null> {
  if (mode === "club") return resolveClubBadgePath(name, clubBadgeStyle, cacheRoot, fs);
  if (mode === "national") return resolveNationalBadgePath(name, cacheRoot, fs);
  return resolveFlagPath(name, flagStyle, cacheRoot, fs);
}

function missingAssetReason(options: BadgeDropperOptions): string {
  if (options.mode === "club" && options.clubBadgeStyle === "square") {
    return "No matching square club badge found.";
  }
  if (options.mode === "club" && options.clubBadgeStyle === "dark") {
    return "No matching dark club badge found.";
  }
  if (options.mode === "club" && options.clubBadgeStyle === "light") {
    return "No matching light club badge found.";
  }
  if (options.mode === "flag" && options.flagStyle === "square") {
    return "No matching square flag found.";
  }
  return "No alias or filename match found.";
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

  let srcLayer = srcDoc.activeLayer ?? Array.from<any>(srcDoc.layers)[0];
  if (!srcLayer) throw new Error(`Could not read layer from ${srcDoc.title ?? "source document"}.`);
  return srcLayer;
}

export async function replaceBadgeSmartObjectContents(
  hostDoc: any,
  targetLayer: string | number,
  assetEntry: any,
  options: Pick<BadgeDropperOptions, "clipToBase" | "fitMode" | "keepBaseVisible">
): Promise<string> {
  let soDoc: any = null;
  let srcDoc: any = null;
  const targetLabel = typeof targetLayer === "number" ? `layer ${targetLayer}` : targetLayer;

  photoshop.app.activeDocument = hostDoc;
  const targetDomLayer = getAllLayers(hostDoc).find(layer => (
    typeof targetLayer === "number"
      ? Number(layer?.id) === targetLayer
      : String(layer?.name ?? "") === targetLayer
  ));
  if (targetDomLayer) {
    const locked = lockedLayerChain(targetDomLayer);
    if (locked.length) {
      throw new Error(`${targetLabel} is locked by: ${locked.join(" > ")}`);
    }
  }

  if (typeof targetLayer === "number") {
    await selectLayerById(targetLayer);
  } else {
    await selectLayerByName(targetLayer);
  }

  try {
    const targetInfo = await getActiveLayerDescriptor();
    if (!targetInfo.smartObject) {
      throw new Error(`${targetLabel} is not a Smart Object.`);
    }

    await batchPlay([{
      _obj: "placedLayerEditContents",
      _options: { dialogOptions: "dontDisplay" },
    }], {});

    const openedSmartObject = photoshop.app.activeDocument as any;
    if (!openedSmartObject || Number(openedSmartObject.id) === Number(hostDoc.id)) {
      throw new Error(`Could not open ${targetLabel} Smart Object contents.`);
    }
    soDoc = openedSmartObject;
    const soW = toNumber(soDoc.width);
    const soH = toNumber(soDoc.height);
    const baseLayer = findBaseLayer(soDoc);
    if (!baseLayer) throw new Error("No base layer found inside Smart Object.");
    const baseId = baseLayer.id as number;

    for (const layer of Array.from<any>(soDoc.layers)) {
      if ((layer.id as number) === baseId) continue;
      await selectLayerById(layer.id as number);
      await deleteActiveLayer();
    }

    const openedSource = await photoshop.app.open(assetEntry);
    if (!openedSource || Number(openedSource.id) === Number(hostDoc.id) || Number(openedSource.id) === Number(soDoc.id)) {
      throw new Error(`Could not safely open source asset ${assetEntry.name}.`);
    }
    srcDoc = openedSource;
    const srcLayer = await prepareSourceLayerForDuplicate(srcDoc);
    if (!srcLayer) throw new Error(`Could not read layer from ${assetEntry.name}.`);
    try {
      await srcLayer.duplicate(soDoc, photoshop.constants.ElementPlacement.PLACEATBEGINNING);
    } catch (duplicateError: any) {
      photoshop.app.activeDocument = srcDoc;
      const retryLayer = srcDoc.activeLayer ?? Array.from<any>(srcDoc.layers)[0];
      try {
        await retryLayer.duplicate(soDoc, photoshop.constants.ElementPlacement.PLACEATBEGINNING);
      } catch (retryError: any) {
        const mode = String(srcDoc.mode ?? "unknown");
        const layerName = String(retryLayer?.name ?? "unknown layer");
        throw new Error(
          `Could not duplicate ${assetEntry.name} into Smart Object (mode=${mode}, layer=${layerName}): ${
            retryError?.message ?? duplicateError?.message ?? String(retryError)
          }`
        );
      }
    }
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

    baseLayer.visible = options.keepBaseVisible;
    if (options.clipToBase) {
      await selectLayerById(assetLayer.id as number);
      await clipActiveLayer();
    }

    await soDoc.close(photoshop.constants.SaveOptions.SAVECHANGES);
    soDoc = null;
    photoshop.app.activeDocument = hostDoc;
    return `${Math.round(soW)}x${Math.round(soH)}`;
  } catch (e) {
    try {
      if (srcDoc && Number(srcDoc.id) !== Number(hostDoc.id)) {
        photoshop.app.activeDocument = srcDoc;
        await srcDoc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
      }
    } catch (_) {}
    try {
      if (soDoc && Number(soDoc.id) !== Number(hostDoc.id)) {
        photoshop.app.activeDocument = soDoc;
        await soDoc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
      }
    } catch (_) {}
    try {
      photoshop.app.activeDocument = hostDoc;
    } catch (_) {}
    throw e;
  }
}

export const runBadgeDropper = async (options: BadgeDropperOptions): Promise<string> => {
  clearBadgeDiskIndexCache();

  const { names, textValues, hasCsvText, inputCount } = prepareRows(options);
  if (!names.length && !textValues.some(Boolean)) return "Enter at least one badge or flag name.";

  const cacheRoot = getStoredCacheRoot();
  if (!cacheRoot) return "Set cache root first.";

  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const results: string[] = [];
  let success = 0;
  let textUpdates = 0;
  let rowCount = names.length;
  const hostDoc = photoshop.app.activeDocument as any;

  if (options.autoDetectTargetCount) {
    const detectedCount = detectConsecutiveTargetLayerCount(hostDoc, options.targetPrefix, options.startIndex);
    if (detectedCount <= 0) {
      return `Auto-detect found no target layers matching ${options.targetPrefix}${options.startIndex}.`;
    }

    rowCount = Math.min(names.length, detectedCount);
    results.push(`Auto-detected ${detectedCount} target layer${detectedCount === 1 ? "" : "s"}.`);
    if (detectedCount < inputCount) {
      results.push(`${inputCount - detectedCount} input row${inputCount - detectedCount === 1 ? "" : "s"} not processed because no matching target layer was found.`);
    }
  }

  // This guard must run before a history state or any Smart Object document is opened.
  assertBadgeTargetsUnlocked(hostDoc, options, names, rowCount);

  await withHistory(hostDoc, "Badge Dropper", async () => {
    for (let i = 0; i < rowCount; i++) {
      const name = names[i];
      const targetLayerName = `${options.targetPrefix}${options.startIndex + i}`;
      const rowNotes: string[] = [];

      try {
        const relativePath = await resolveAssetPath(
          name,
          options.mode,
          options.clubBadgeStyle ?? "regular",
          options.flagStyle,
          cacheRoot,
          fs
        );
        if (relativePath) {
          const fullPath = joinNativePath(cacheRoot, relativePath);
          const entry = await fs.getEntryWithUrl(nativePathToFileUrl(fullPath));
          const canvas = await replaceBadgeSmartObjectContents(hostDoc, targetLayerName, entry, options);
          rowNotes.push(`OK ${name} -> ${entry.name} (${canvas})`);
          success++;
        } else if (name) {
          rowNotes.push(`NO MATCH for "${name}"`);
        } else {
          rowNotes.push("SKIP blank asset");
        }
      } catch (e: any) {
        rowNotes.push(`ERROR ${name || "blank asset"} - ${e?.message ?? String(e)}`);
      }

      const textValue = textValues[i] ?? "";
      if (textValue) {
        if (updateTextLayer(hostDoc, `text_${options.startIndex + i}`, textValue)) {
          rowNotes.push(`text_${options.startIndex + i}: text updated`);
          textUpdates++;
        } else {
          rowNotes.push(`text_${options.startIndex + i}: text layer not found`);
        }
      }

      results.push(`${targetLayerName}: ${rowNotes.join("; ")}`);
    }
  });

  const textSummary = hasCsvText ? `, ${textUpdates} text updates` : "";
  return [`Done - ${success} of ${rowCount} processed${textSummary}.`, ...results].join("\n");
};

export const preflightBadgeDropper = async (options: BadgeDropperOptions): Promise<BadgeDropperPreflightResult> => {
  clearBadgeDiskIndexCache();

  const { names, textValues, inputCount } = prepareRows(options);
  if (!names.length && !textValues.some(Boolean)) {
    return {
      rowCount: 0,
      inputCount: 0,
      skippedExtraRows: 0,
      missing: [],
    };
  }

  const cacheRoot = getStoredCacheRoot();
  if (!cacheRoot) throw new Error("Set cache root first.");

  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const missing: BadgeDropperPreflightIssue[] = [];
  let rowCount = names.length;
  let detectedCount: number | undefined;

  await asModal("Badge Dropper Preflight", async () => {
    const hostDoc = photoshop.app.activeDocument as any;
    if (options.autoDetectTargetCount) {
      detectedCount = detectConsecutiveTargetLayerCount(hostDoc, options.targetPrefix, options.startIndex);
      rowCount = Math.min(rowCount, detectedCount);
    }
    assertBadgeTargetsUnlocked(hostDoc, options, names, rowCount);
  });

  for (let i = 0; i < rowCount; i++) {
    const name = names[i];
    if (!name) continue;

    const targetLayerName = `${options.targetPrefix}${options.startIndex + i}`;
    let relativePath: string | null = null;
    try {
      relativePath = await resolveAssetPath(
        name,
        options.mode,
        options.clubBadgeStyle ?? "regular",
        options.flagStyle,
        cacheRoot,
        fs
      );
    } catch (e: any) {
      missing.push({
        index: i,
        targetLayerName,
        name,
        reason: e?.message ?? String(e),
      });
      continue;
    }

    if (!relativePath) {
      missing.push({
        index: i,
        targetLayerName,
        name,
        reason: missingAssetReason(options),
      });
      continue;
    }

    const fullPath = joinNativePath(cacheRoot, relativePath);
    try {
      const entry = await fs.getEntryWithUrl(nativePathToFileUrl(fullPath));
      if (!entry?.isFile) {
        missing.push({
          index: i,
          targetLayerName,
          name,
          reason: "Resolved path is not a file.",
          relativePath,
          fullPath,
        });
      }
    } catch (e: any) {
      missing.push({
        index: i,
        targetLayerName,
        name,
        reason: e?.message ?? String(e),
        relativePath,
        fullPath,
      });
    }
  }

  return {
    rowCount,
    inputCount,
    detectedCount,
    skippedExtraRows: Math.max(0, inputCount - rowCount),
    missing,
  };
};
