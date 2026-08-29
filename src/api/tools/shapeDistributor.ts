import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";
import { withHistory } from "../psHistory";

export type ShapeDistributorArrangement = "line" | "stack" | "grid";
export type ShapeDistributorGridFill = "across" | "down";

export interface ShapeDistributorOptions {
  mode: "shape" | "group" | "layer";
  count: number;
  direction: "right" | "left" | "down" | "up";
  gap: number;
  centerSpacing?: boolean;
  arrangement?: ShapeDistributorArrangement;
  stackOnly?: boolean;
  gridColumns?: number;
  gridGapX?: number;
  gridGapY?: number;
  gridFill?: ShapeDistributorGridFill;
  centerGridOnCanvas?: boolean;
  customPrefixes: string[];
}

export interface ShapeDistributorPrefixScanResult {
  groupName: string;
  prefixes: string[];
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLayerByName(parent: any, name: string): any | null {
  try {
    for (const lyr of Array.from<any>(parent.layers)) {
      try {
        if (lyr.name === name) return lyr;
        if (lyr.kind === "group") {
          const found = findLayerByName(lyr, name);
          if (found) return found;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function findLayerById(parent: any, id: number): any | null {
  try {
    for (const lyr of Array.from<any>(parent.layers)) {
      try {
        if (lyr.id === id) return lyr;
        if (lyr.kind === "group") {
          const found = findLayerById(lyr, id);
          if (found) return found;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

interface IndexedContinuationPlan {
  key: string;
  kind: "suffix-index" | "leading-index";
  token: string;
  minIndex: number;
  maxIndex: number;
  stride: number;
}

function buildIndexedContinuationPlans(
  container: any,
  customPrefixes: string[]
): IndexedContinuationPlan[] {
  const definitions = new Map<string, Omit<IndexedContinuationPlan, "minIndex" | "maxIndex" | "stride">>();

  const addPlan = (kind: IndexedContinuationPlan["kind"], token: string): void => {
    const trimmedToken = token.trim();
    if (!trimmedToken) return;
    const key = `${kind}:${trimmedToken.toLowerCase()}`;
    if (!definitions.has(key)) definitions.set(key, { key, kind, token: trimmedToken });
  };

  addPlan("suffix-index", "shape_");
  for (const prefix of customPrefixes) {
    if (prefix.startsWith("(n)")) addPlan("leading-index", prefix.slice(3));
    else addPlan("suffix-index", prefix);
  }

  const plans = Array.from(definitions.values());
  const ranges = new Map<string, { minIndex: number; maxIndex: number }>();

  const recordName = (name: string): void => {
    for (const plan of plans) {
      const match = plan.kind === "suffix-index"
        ? name.match(new RegExp(`^${escapeRegex(plan.token)}(\\d+)(?=$|[^0-9])`, "i"))
        : name.match(new RegExp(`^(\\d+)${escapeRegex(plan.token)}$`, "i"));
      if (!match) continue;

      const index = parseInt(match[1], 10);
      if (!Number.isFinite(index)) continue;
      const current = ranges.get(plan.key);
      ranges.set(plan.key, current
        ? { minIndex: Math.min(current.minIndex, index), maxIndex: Math.max(current.maxIndex, index) }
        : { minIndex: index, maxIndex: index });
    }
  };

  const walk = (node: any): void => {
    try {
      for (const layer of Array.from<any>(node.layers)) {
        try {
          recordName(String(layer.name ?? ""));
          if (layer.kind === "group" && layer.layers) walk(layer);
        } catch (_) {}
      }
    } catch (_) {}
  };
  walk(container);

  return plans.flatMap(plan => {
    const range = ranges.get(plan.key);
    if (!range) return [];
    return [{
      ...plan,
      minIndex: range.minIndex,
      maxIndex: range.maxIndex,
      stride: range.maxIndex - range.minIndex + 1,
    }];
  });
}

function continuedIndexedName(
  sourceName: string,
  copyOffset: number,
  plans: IndexedContinuationPlan[]
): string | null {
  for (const plan of plans) {
    const match = plan.kind === "suffix-index"
      ? sourceName.match(new RegExp(`^(${escapeRegex(plan.token)})(\\d+)(.*)$`, "i"))
      : sourceName.match(new RegExp(`^(\\d+)(${escapeRegex(plan.token)})$`, "i"));
    if (!match) continue;

    const rawIndex = plan.kind === "suffix-index" ? match[2] : match[1];
    const nextIndex = String(parseInt(rawIndex, 10) + copyOffset * plan.stride)
      .padStart(rawIndex.length, "0");

    return plan.kind === "suffix-index"
      ? `${match[1]}${nextIndex}${match[3]}`
      : `${nextIndex}${match[2]}`;
  }

  return null;
}

function getIndexedCopyName(sourceName: string, copyOffset: number): string | null {
  const suffixIndex = sourceName.match(/^(.*_)(\d+)(\D*)$/);
  if (suffixIndex) {
    const [, prefix, rawIndex, suffix] = suffixIndex;
    const nextIndex = String(parseInt(rawIndex, 10) + copyOffset).padStart(rawIndex.length, "0");
    return `${prefix}${nextIndex}${suffix}`;
  }

  const leadingIndex = sourceName.match(/^(\d+)(_.*)$/);
  if (leadingIndex) {
    const [, rawIndex, suffix] = leadingIndex;
    const nextIndex = String(parseInt(rawIndex, 10) + copyOffset).padStart(rawIndex.length, "0");
    return `${nextIndex}${suffix}`;
  }

  return null;
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function clampPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(1000, Math.floor(parsed)));
}

function clampGap(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100000, parsed));
}

function getGridCell(index: number, columns: number, rows: number, fill: ShapeDistributorGridFill): { column: number; row: number } {
  return fill === "down"
    ? { column: Math.floor(index / rows), row: index % rows }
    : { column: index % columns, row: Math.floor(index / columns) };
}

function collectGroupIndexedPrefixes(container: any): string[] {
  const prefixes: string[] = [];

  function walk(node: any): void {
    try {
      for (const layer of Array.from<any>(node.layers)) {
        try {
          const name = String(layer.name ?? "").trim();
          if (name) {
            if (!/^shape_\d+(?=$|[^0-9])/i.test(name)) {
              const prefixNumber = name.match(/^(.+?_)\d+(?=$|[^0-9])/);
              if (prefixNumber?.[1]) prefixes.push(prefixNumber[1]);

              const numberPrefix = name.match(/^\d+(_.+)$/);
              if (numberPrefix?.[1]) prefixes.push(`(n)${numberPrefix[1]}`);
            }
          }
          if (layer.kind === "group" && layer.layers) walk(layer);
        } catch (_) {}
      }
    } catch (_) {}
  }

  walk(container);
  return uniqueStrings(prefixes).sort((a, b) => a.localeCompare(b));
}

function collectLayerIds(root: any): number[] {
  const ids: number[] = [];
  function walk(node: any): void {
    try {
      if (typeof node?.id === "number") ids.push(node.id as number);
      if (node?.kind === "group" && node.layers) {
        for (const child of Array.from<any>(node.layers)) walk(child);
      }
    } catch (_) {}
  }
  walk(root);
  return ids;
}

async function selectLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function getLayerDescriptorById(id: number): Promise<any | null> {
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

function descriptorIsClipped(descriptor: any): boolean {
  return Boolean(descriptor?.group ?? descriptor?.clipping);
}

async function collectClippedLayerIndexes(root: any): Promise<Set<number>> {
  const clipped = new Set<number>();
  const ids = collectLayerIds(root);

  for (let index = 0; index < ids.length; index++) {
    const descriptor = await getLayerDescriptorById(ids[index]);
    if (descriptorIsClipped(descriptor)) clipped.add(index);
  }

  return clipped;
}

async function clipActiveLayer(): Promise<void> {
  await batchPlay([{
    _obj: "groupEvent",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function restoreClippingByIndex(clippedIndexes: Set<number>, layerIds: number[]): Promise<void> {
  for (const index of Array.from(clippedIndexes).sort((a, b) => a - b)) {
    const layerId = layerIds[index];
    if (!layerId) continue;

    const descriptor = await getLayerDescriptorById(layerId);
    if (descriptorIsClipped(descriptor)) continue;

    await selectLayerById(layerId);
    await clipActiveLayer();
  }
}

async function moveGroupChildren(layerIds: number[], dx: number, dy: number): Promise<void> {
  const childIds: number[] = [];

  for (const id of layerIds) {
    const info = await getLayerDescriptorById(id);
    if (info && info.layerKind !== 13 && info.layerKind !== 7) childIds.push(id);
  }

  if (childIds.length === 0) return;
  await selectLayerById(childIds[0]);
  for (let index = 1; index < childIds.length; index++) {
    await batchPlay([{
      _obj: "select",
      _target: [{ _ref: "layer", _id: childIds[index] }],
      selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" },
      makeVisible: false,
      _options: { dialogOptions: "dontDisplay" },
    }], {});
  }

  await batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy },
    },
    linked: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function moveLayerBy(layerId: number, dx: number, dy: number): Promise<void> {
  await selectLayerById(layerId);
  await batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy },
    },
    linked: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

// Re-reads children fresh from DOM after uniquification, renames by pattern via batchPlay ID
async function renameGroupChildren(
  groupNode: any,
  copyOffset: number,
  continuationPlans: IndexedContinuationPlan[]
): Promise<void> {
  try {
    for (const child of Array.from<any>(groupNode.layers)) {
      try {
        const name = child.name as string;
        const newName = continuedIndexedName(name, copyOffset, continuationPlans);
        if (newName !== null) {
          console.log(`[ShapeDist] about to RENAME child id=${child.id} "${name}" → "${newName}"`);
          await batchPlay([{
            _obj: "set",
            _target: [{ _ref: "layer", _id: child.id as number }],
            to: { _obj: "layer", name: newName },
            _options: { dialogOptions: "dontDisplay" },
          }], {});
        }
        if (child.kind === "group" && child.layers) {
          await renameGroupChildren(child, copyOffset, continuationPlans);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

export const scanShapeDistributorPrefixes = async (): Promise<ShapeDistributorPrefixScanResult> => {
  const groupName = "group_1";
  let prefixes: string[] = [];

  await asModal("Scan Shape Duplicator Prefixes", async () => {
    const doc = photoshop.app.activeDocument as any;
    const group = findLayerByName(doc, groupName);
    if (!group || group.kind !== "group") throw new Error(`Could not find "${groupName}".`);
    prefixes = collectGroupIndexedPrefixes(group);
  });

  return { groupName, prefixes };
};

export const runShapeDistributor = async (options: ShapeDistributorOptions): Promise<string> => {
  if (options.count < 2) return "Count must be at least 2.";
  const doc = photoshop.app.activeDocument;
  let created = 0;

  await withHistory(doc as any, "Duplicator", async () => {
    // ── Find reference layer ──────────────────────────────────────────────────
    let refLayerId: number;
    let refLayerDom: any = null;

    if (options.mode === "layer") {
      console.log(`[ShapeDist] about to GET targetEnum (layer mode ref)`);
      const info = await batchPlay([{
        _obj: "get",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        _options: { dialogOptions: "dontDisplay" },
      }], {});
      refLayerId = info[0].layerID as number;
      refLayerDom = findLayerById(doc, refLayerId);
      if (!refLayerDom) throw new Error("Could not read the selected layer.");
    } else {
      const baseName = options.mode === "group" ? "group" : "shape";
      refLayerDom = findLayerByName(doc, `${baseName}_1`);
      if (!refLayerDom) throw new Error(`Could not find '${baseName}_1'.`);
      refLayerId = refLayerDom.id as number;
    }
    console.log(`[ShapeDist] refLayerId=${refLayerId}`);
    const referenceLayerName = String(refLayerDom.name ?? "");

    // ── Get reference bounds ──────────────────────────────────────────────────
    console.log(`[ShapeDist] about to GET bounds id=${refLayerId}`);
    const boundsInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _id: refLayerId }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    const b = boundsInfo[0].boundsNoEffects || boundsInfo[0].bounds;
    const W = (b.right._value  as number) - (b.left._value  as number);
    const H = (b.bottom._value as number) - (b.top._value   as number);
    console.log(`[ShapeDist] W=${W} H=${H}`);

    const arrangement: ShapeDistributorArrangement = options.arrangement
      ?? (options.stackOnly ? "stack" : "line");
    const gridColumns = clampPositiveInt(options.gridColumns, 2);
    const gridRows = Math.ceil(options.count / gridColumns);
    const gridGapX = clampGap(options.gridGapX);
    const gridGapY = clampGap(options.gridGapY);
    const gridFill: ShapeDistributorGridFill = options.gridFill === "down" ? "down" : "across";
    let gridCenterOffsetX = 0;
    let gridCenterOffsetY = 0;

    if (arrangement === "grid" && options.centerGridOnCanvas) {
      const cells = Array.from({ length: options.count }, (_, index) =>
        getGridCell(index, gridColumns, gridRows, gridFill)
      );
      const minColumn = Math.min(...cells.map(cell => cell.column));
      const maxColumn = Math.max(...cells.map(cell => cell.column));
      const minRow = Math.min(...cells.map(cell => cell.row));
      const maxRow = Math.max(...cells.map(cell => cell.row));
      const gridLeft = (b.left._value as number) + minColumn * (W + gridGapX);
      const gridTop = (b.top._value as number) + minRow * (H + gridGapY);
      const gridRight = (b.right._value as number) + maxColumn * (W + gridGapX);
      const gridBottom = (b.bottom._value as number) + maxRow * (H + gridGapY);
      const docWidth = toNumber((doc as any).width);
      const docHeight = toNumber((doc as any).height);

      if (!docWidth || !docHeight) throw new Error("Could not read document canvas size.");
      gridCenterOffsetX = (docWidth / 2) - ((gridLeft + gridRight) / 2);
      gridCenterOffsetY = (docHeight / 2) - ((gridTop + gridBottom) / 2);
    }

    // Continue every configured numbered sequence from the range in group_1.
    let continuationPlans: IndexedContinuationPlan[] = [];
    let clippedGroupLayerIndexes = new Set<number>();
    if (options.mode === "group" && refLayerDom) {
      continuationPlans = buildIndexedContinuationPlans(refLayerDom, options.customPrefixes);
      clippedGroupLayerIndexes = await collectClippedLayerIndexes(refLayerDom);
    }

    let insertionAnchorId = refLayerId;
    const horizontalStep = options.centerSpacing ? options.gap : W + options.gap;
    const verticalStep = options.centerSpacing ? options.gap : H + options.gap;

    // ── Duplicate loop ────────────────────────────────────────────────────────
    for (let i = 2; i <= options.count; i++) {
      console.log(`[ShapeDist] ── iteration i=${i} ──`);
      const idx = i - 1;
      const gridCell = getGridCell(idx, gridColumns, gridRows, gridFill);
      const dx = arrangement === "stack" ? 0
        : arrangement === "grid" ? gridCenterOffsetX + gridCell.column * (W + gridGapX)
        : options.direction === "right" ? horizontalStep * idx
        : options.direction === "left" ? -horizontalStep * idx
        : 0;
      const dy = arrangement === "stack" ? 0
        : arrangement === "grid" ? gridCenterOffsetY + gridCell.row * (H + gridGapY)
        : options.direction === "down" ? verticalStep * idx
        : options.direction === "up" ? -verticalStep * idx
        : 0;

      // 1. Duplicate from original directly under the original/previous copy
      const anchorNode = findLayerById(doc, insertionAnchorId);
      if (!anchorNode) throw new Error("Could not find insertion anchor layer.");
      console.log(`[ShapeDist] about to DUPLICATE id=${refLayerId} after anchor id=${insertionAnchorId}`);
      const duplicatedNode = await refLayerDom.duplicate(
        anchorNode,
        photoshop.constants.ElementPlacement.PLACEAFTER
      );
      const createdIds: number[] = collectLayerIds(duplicatedNode);
      let createdTopLayerId = duplicatedNode?.id as number | null;
      console.log(`[ShapeDist] DUPLICATE returned createdIds=${JSON.stringify(createdIds)}`);

      // 2. Apply offset
      if (arrangement !== "stack" && (dx !== 0 || dy !== 0)) {
        if (options.mode === "group") {
          // Group container can't be transformed directly — offset its children
          const childIds: number[] = [];
          for (const id of createdIds) {
            console.log(`[ShapeDist] about to GET (childIds filter) id=${id}`);
            const info = await batchPlay([{
              _obj: "get",
              _target: [{ _ref: "layer", _id: id }],
              _options: { dialogOptions: "dontDisplay" },
            }], {});
            console.log(`[ShapeDist] GET id=${id} layerKind=${info[0].layerKind}`);
            if (info[0].layerKind !== 13 && info[0].layerKind !== 7) childIds.push(id);
          }
          console.log(`[ShapeDist] childIds=${JSON.stringify(childIds)}`);
          if (childIds.length > 0) {
            console.log(`[ShapeDist] about to SELECT child id=${childIds[0]}`);
            await batchPlay([{
              _obj: "select",
              _target: [{ _ref: "layer", _id: childIds[0] }],
              makeVisible: false,
              _options: { dialogOptions: "dontDisplay" },
            }], {});
            for (let k = 1; k < childIds.length; k++) {
              console.log(`[ShapeDist] about to addToSelection child id=${childIds[k]}`);
              await batchPlay([{
                _obj: "select",
                _target: [{ _ref: "layer", _id: childIds[k] }],
                selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" },
                makeVisible: false,
                _options: { dialogOptions: "dontDisplay" },
              }], {});
            }
            console.log(`[ShapeDist] about to TRANSFORM children dx=${dx} dy=${dy}`);
            await batchPlay([{
              _obj: "transform",
              _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
              freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
              offset: {
                _obj: "offset",
                horizontal: { _unit: "pixelsUnit", _value: dx },
                vertical:   { _unit: "pixelsUnit", _value: dy },
              },
              linked: true,
              interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
              _options: { dialogOptions: "dontDisplay" },
            }], {});
          }
        } else {
          // Shape and layer modes
          if (createdTopLayerId) await selectLayerById(createdTopLayerId);
          console.log(`[ShapeDist] about to TRANSFORM targetEnum dx=${dx} dy=${dy}`);
          await batchPlay([{
            _obj: "transform",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
            freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
            offset: {
              _obj: "offset",
              horizontal: { _unit: "pixelsUnit", _value: dx },
              vertical:   { _unit: "pixelsUnit", _value: dy },
            },
            linked: true,
            interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
            _options: { dialogOptions: "dontDisplay" },
          }], {});
        }
      }

      // 4. Make Smart Objects unique — copy, rename, delete original linked SO
      for (const id of createdIds) {
        try {
          console.log(`[ShapeDist] about to GET (SO check) id=${id}`);
          const info = await batchPlay([{ _obj: "get", _target: [{ _ref: "layer", _id: id }], _options: { dialogOptions: "dontDisplay" } }], {});
          console.log(`[ShapeDist] GET id=${id} smartObject=${info[0].smartObject !== undefined ? "yes" : "no"}`);
          if (info[0].smartObject !== undefined) {
            const origName = info[0].name as string;
            console.log(`[ShapeDist] about to SELECT (SO uniquify) id=${id}`);
            await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }], {});
            console.log(`[ShapeDist] about to placedLayerMakeCopy on id=${id}`);
            await batchPlay([{ _obj: "placedLayerMakeCopy", _options: { dialogOptions: "dontDisplay" } }], {});
            const newSO = await batchPlay([{ _obj: "get", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], _options: { dialogOptions: "dontDisplay" } }], {});
            const newId = newSO[0].layerID as number;
            console.log(`[ShapeDist] about to RENAME new SO copy (id=${newId}) to "${origName}"`);
            await batchPlay([{ _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: origName }, _options: { dialogOptions: "dontDisplay" } }], {});
            console.log(`[ShapeDist] about to DELETE original linked SO id=${id}`);
            await batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _id: id }], _options: { dialogOptions: "dontDisplay" } }], {});
            console.log(`[ShapeDist] DELETE done for id=${id} — replacing in createdIds with newId=${newId}`);
            const pos = createdIds.indexOf(id);
            if (pos !== -1) createdIds[pos] = newId;
            if (createdTopLayerId === id) createdTopLayerId = newId;
          }
        } catch (_) {}
      }

      // 5. Rename last — after uniquify, because placedLayerMakeCopy changes the SO layer
      if (options.mode === "group") {
        // Find group header (kind 7) and rename it
        let groupHeaderId: number | null = null;
        for (const id of createdIds) {
          let info;
          try {
            console.log(`[ShapeDist] about to GET (find group header) id=${id}`);
            info = await batchPlay([{
              _obj: "get",
              _target: [{ _ref: "layer", _id: id }],
              _options: { dialogOptions: "dontDisplay" },
            }], {});
          } catch (_) {
            console.log(`[ShapeDist] GET id=${id} threw — skipping (deleted)`);
            continue; // layer was deleted (original SO replaced by unique copy)
          }
          console.log(`[ShapeDist] GET id=${id} layerKind=${info[0].layerKind}`);
          if (info[0].layerKind === 7) { groupHeaderId = id; break; }
        }
        if (groupHeaderId !== null) {
          console.log(`[ShapeDist] about to RENAME group header id=${groupHeaderId} to "group_${i}"`);
          await batchPlay([{
            _obj: "set",
            _target: [{ _ref: "layer", _id: groupHeaderId }],
            to: { _obj: "layer", name: `group_${i}` },
            _options: { dialogOptions: "dontDisplay" },
          }], {});
          // Re-read group children fresh from DOM — includes any new SO copies from uniquification
          const groupNode = findLayerById(doc, groupHeaderId);
          if (groupNode) {
            await renameGroupChildren(groupNode, i - 1, continuationPlans);
          }
          await restoreClippingByIndex(clippedGroupLayerIndexes, createdIds);
          createdTopLayerId = groupHeaderId;
        }
      } else if (options.mode === "shape") {
        const targetId = createdTopLayerId;
        if (!targetId) throw new Error("Could not find duplicated shape layer.");
        console.log(`[ShapeDist] about to RENAME layer id=${targetId} to "shape_${i}"`);
        await batchPlay([{
          _obj: "set",
          _target: [{ _ref: "layer", _id: targetId }],
          to: { _obj: "layer", name: `shape_${i}` },
          _options: { dialogOptions: "dontDisplay" },
        }], {});
      } else {
        const newName = getIndexedCopyName(referenceLayerName, i - 1);
        if (newName && createdTopLayerId) {
          console.log(`[ShapeDist] about to RENAME layer id=${createdTopLayerId} to "${newName}"`);
          await batchPlay([{
            _obj: "set",
            _target: [{ _ref: "layer", _id: createdTopLayerId }],
            to: { _obj: "layer", name: newName },
            _options: { dialogOptions: "dontDisplay" },
          }], {});
        }
      }

      if (createdTopLayerId) insertionAnchorId = createdTopLayerId;
      console.log(`[ShapeDist] iteration i=${i} complete`);
      created++;
    }

    if (arrangement === "grid" && options.centerGridOnCanvas && (gridCenterOffsetX !== 0 || gridCenterOffsetY !== 0)) {
      if (options.mode === "group") {
        await moveGroupChildren(collectLayerIds(refLayerDom), gridCenterOffsetX, gridCenterOffsetY);
      } else {
        await moveLayerBy(refLayerId, gridCenterOffsetX, gridCenterOffsetY);
      }
    }

    // Final: leave modal with a known-good active layer for PS post-modal sync
    console.log(`[ShapeDist] about to SELECT refLayerId=${refLayerId} (final cleanup)`);
    try {
      await batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: refLayerId }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      }], {});
    } catch (_) {}
    console.log(`[ShapeDist] asModal callback complete`);
  });

  console.log(`[ShapeDist] runShapeDistributor about to return — created=${created}`);
  return `Created ${created} cop${created === 1 ? "y" : "ies"}.`;
};
