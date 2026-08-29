import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export type ReferenceGroupDistributionMode = "align-x" | "align-y" | "align-both" | "distribute-x" | "distribute-y";

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface SelectedReference extends Bounds {
  id: number;
  parentId: number;
}

interface ReferenceGroup extends Bounds {
  id: number;
  name: string;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function isGroupDescriptor(descriptor: any): boolean {
  const section = descriptor?.layerSection?._value as string | undefined;
  return section === "layerSectionStart" || descriptor?.layerKind === 7;
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

function descriptorToReference(descriptor: any, parentId: number): SelectedReference | null {
  if (!descriptor || isGroupDescriptor(descriptor)) return null;

  const bounds = descriptor.boundsNoEffects ?? descriptor.bounds;
  const id = descriptor.layerID as number | undefined;
  if (!bounds || !id || !parentId) return null;

  return {
    id,
    parentId,
    left: toNumber(bounds.left),
    top: toNumber(bounds.top),
    right: toNumber(bounds.right),
    bottom: toNumber(bounds.bottom),
  };
}

async function getSelectedReferences(): Promise<SelectedReference[]> {
  const doc = photoshop.app.activeDocument as any;
  const selectedLayers = Array.from<any>(doc?.activeLayers ?? []);
  if (!selectedLayers.length) {
    throw new Error("Select one or more reference layers inside a parent group.");
  }

  const referencesById = new Map<number, SelectedReference>();

  for (const layer of selectedLayers) {
    const id = Number(layer?.id);
    const parent = layer?.parent;
    const parentId = Number(parent?.id);
    if (!id || !parentId || parent?.kind !== "group") {
      throw new Error("Every selected reference layer must sit directly inside a parent group.");
    }

    const reference = descriptorToReference(await getLayerDescriptorById(id), parentId);
    if (!reference) {
      throw new Error(`Could not read bounds for "${String(layer?.name ?? "selected layer")}".`);
    }
    referencesById.set(reference.id, reference);
  }

  const references = Array.from(referencesById.values());

  if (!references.length) {
    throw new Error("Select reference layers inside two or more parent groups.");
  }

  return Array.from(new Map(references.map(reference => [reference.id, reference])).values());
}

function findLayerById(parent: any, id: number): any | null {
  try {
    for (const layer of Array.from<any>(parent?.layers ?? [])) {
      if (layer.id === id) return layer;
      if (layer.kind === "group") {
        const found = findLayerById(layer, id);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

function buildReferenceGroups(doc: any, references: SelectedReference[]): ReferenceGroup[] {
  const grouped = new Map<number, SelectedReference[]>();
  for (const reference of references) {
    const values = grouped.get(reference.parentId) ?? [];
    values.push(reference);
    grouped.set(reference.parentId, values);
  }

  const groups: ReferenceGroup[] = [];
  for (const [id, values] of grouped) {
    const group = findLayerById(doc, id);
    if (!group || group.kind !== "group") {
      throw new Error("Each selected reference layer must sit directly inside a parent group.");
    }

    groups.push({
      id,
      name: String(group.name ?? `Group ${id}`),
      left: Math.min(...values.map(value => value.left)),
      top: Math.min(...values.map(value => value.top)),
      right: Math.max(...values.map(value => value.right)),
      bottom: Math.max(...values.map(value => value.bottom)),
    });
  }

  return groups;
}

function centerX(bounds: Bounds): number {
  return (bounds.left + bounds.right) / 2;
}

function centerY(bounds: Bounds): number {
  return (bounds.top + bounds.bottom) / 2;
}

function movesFor(
  groups: ReferenceGroup[],
  mode: ReferenceGroupDistributionMode,
  canvas: { width: number; height: number }
): Array<{ id: number; dx: number; dy: number }> {
  const outerLeft = Math.min(...groups.map(group => group.left));
  const outerTop = Math.min(...groups.map(group => group.top));
  const outerRight = Math.max(...groups.map(group => group.right));
  const outerBottom = Math.max(...groups.map(group => group.bottom));

  if (mode === "align-x" || mode === "align-y" || mode === "align-both") {
    if (groups.length !== 1) {
      throw new Error("For alignment, select one or more reference layers inside one parent group.");
    }

    const group = groups[0];
    return [{
      id: group.id,
      dx: mode === "align-y" ? 0 : (canvas.width / 2) - centerX(group),
      dy: mode === "align-x" ? 0 : (canvas.height / 2) - centerY(group),
    }];
  }

  if (groups.length < 2) {
    throw new Error("For distribution, select reference layers from at least two parent groups.");
  }

  if (mode === "distribute-x") {
    const sorted = [...groups].sort((a, b) => a.left - b.left);
    const totalWidth = sorted.reduce((total, group) => total + group.right - group.left, 0);
    const gap = (outerRight - outerLeft - totalWidth) / (sorted.length - 1);
    let nextLeft = outerLeft;
    return sorted.map(group => {
      const dx = nextLeft - group.left;
      nextLeft += (group.right - group.left) + gap;
      return { id: group.id, dx, dy: 0 };
    });
  }

  const sorted = [...groups].sort((a, b) => a.top - b.top);
  const totalHeight = sorted.reduce((total, group) => total + group.bottom - group.top, 0);
  const gap = (outerBottom - outerTop - totalHeight) / (sorted.length - 1);
  let nextTop = outerTop;
  return sorted.map(group => {
    const dy = nextTop - group.top;
    nextTop += (group.bottom - group.top) + gap;
    return { id: group.id, dx: 0, dy };
  });
}

async function selectLayerById(id: number, add = false): Promise<void> {
  const descriptor: any = {
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  };
  if (add) descriptor.selectionModifier = { _enum: "selectionModifierType", _value: "addToSelection" };
  await batchPlay([descriptor], {});
}

async function restoreSelection(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await selectLayerById(ids[0]);
  for (let index = 1; index < ids.length; index++) {
    await selectLayerById(ids[index], true);
  }
}

async function translateGroup(doc: any, id: number, dx: number, dy: number): Promise<void> {
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

  const group = findLayerById(doc, id);
  if (!group || group.kind !== "group") {
    throw new Error("Could not find a selected parent group.");
  }

  await selectLayerById(id);
  await batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: Math.round(dx) },
      vertical: { _unit: "pixelsUnit", _value: Math.round(dy) },
    },
    linked: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

export const runReferenceGroupDistribution = async (mode: ReferenceGroupDistributionMode): Promise<string> => {
  const doc = photoshop.app.activeDocument as any;
  if (!doc) throw new Error("Open a document first.");

  let movedGroups = 0;
  let referenceCount = 0;

  await withHistory(doc, "Distribute Parent Groups", async () => {
    const references = await getSelectedReferences();
    const groups = buildReferenceGroups(photoshop.app.activeDocument as any, references);
    const moves = movesFor(groups, mode, {
      width: toNumber(doc.width),
      height: toNumber(doc.height),
    });

    for (const move of moves) {
      if (Math.abs(move.dx) >= 0.5 || Math.abs(move.dy) >= 0.5) movedGroups++;
      await translateGroup(photoshop.app.activeDocument as any, move.id, move.dx, move.dy);
    }

    referenceCount = references.length;
    await restoreSelection(references.map(reference => reference.id));
  });

  const action = mode === "align-x"
    ? "Aligned parent group horizontally on X"
    : mode === "align-y"
      ? "Aligned parent group vertically on Y"
      : mode === "align-both"
        ? "Aligned parent group on X and Y"
      : mode === "distribute-x"
        ? "Distributed horizontal gaps"
        : "Distributed vertical gaps";
  return action + " for " + movedGroups + " parent group" + (movedGroups === 1 ? "" : "s")
    + " using " + referenceCount + " selected reference layer" + (referenceCount === 1 ? "" : "s") + ".";
};
