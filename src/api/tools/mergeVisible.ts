import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

interface VisibilitySnapshot {
  id: number;
  visible: boolean;
}

function allLayers(parent: any): any[] {
  const result: any[] = [];
  let children: any[] = [];
  try { children = Array.from<any>(parent.layers ?? []); } catch (_) {}

  for (const layer of children) {
    result.push(layer);
    result.push(...allLayers(layer));
  }
  return result;
}

function childLayers(layer: any): any[] {
  try { return Array.from<any>(layer.layers ?? []); } catch (_) { return []; }
}

function getLayerId(layer: any): number | null {
  return typeof layer?.id === "number" ? layer.id : null;
}

function getParentId(layer: any): number | null {
  try {
    return getLayerId(layer.parent);
  } catch (_) {
    return null;
  }
}

function findLayerById(parent: any, id: number): any | null {
  for (const layer of childLayers(parent)) {
    if (getLayerId(layer) === id) return layer;
    const descendant = findLayerById(layer, id);
    if (descendant) return descendant;
  }
  return null;
}

function markLayerTree(layer: any, included: Set<number>): void {
  const id = getLayerId(layer);
  if (id !== null) included.add(id);
  for (const child of childLayers(layer)) markLayerTree(child, included);
}

function collectSelectedLayers(doc: any): any[] {
  const selected = Array.from<any>(doc.activeLayers ?? [])
    .filter(layer => getLayerId(layer) !== null);
  if (selected.length) return selected;

  const active = doc.activeLayer;
  return active && getLayerId(active) !== null ? [active] : [];
}

async function getActiveLayerDescriptor(): Promise<any> {
  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  return result[0] ?? {};
}

async function renameActiveLayer(name: string): Promise<void> {
  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "layer", name },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function moveLayerAbove(doc: any, layerId: number, anchor: any): Promise<void> {
  const anchorId = getLayerId(anchor);
  if (!anchorId || layerId === anchorId) return;

  const activeLayer = Array.from<any>(doc.activeLayers ?? [])
    .find(layer => getLayerId(layer) === layerId)
    ?? findLayerById(doc, layerId);
  if (!activeLayer) throw new Error("Photoshop did not expose the merged layer.");

  try {
    await activeLayer.move(anchor, photoshop.constants.ElementPlacement.PLACEBEFORE);
    return;
  } catch (_) {}

  await batchPlay([{
    _obj: "move",
    _target: [{ _ref: "layer", _id: layerId }],
    to: { _ref: "layer", _id: anchorId },
    adjustment: false,
    version: 5,
    layerID: [layerId],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function restoreVisibility(doc: any, snapshots: VisibilitySnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;

  photoshop.app.activeDocument = doc;
  const currentLayers = new Map<number, any>();
  for (const layer of allLayers(doc)) {
    const id = getLayerId(layer);
    if (id !== null) currentLayers.set(id, layer);
  }

  for (const snapshot of snapshots) {
    const layer = currentLayers.get(snapshot.id);
    if (!layer) continue;
    try {
      layer.visible = snapshot.visible;
    } catch (_) {
      // A single stale or locked layer must not stop the remaining restores.
    }
  }
}

async function pastePixels(): Promise<number> {
  await batchPlay([{
    _obj: "paste",
    antiAlias: { _enum: "antiAliasType", _value: "antiAliasNone" },
    as: { _class: "pixel" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const descriptor = await getActiveLayerDescriptor();
  const layerId = descriptor.layerID as number | undefined;
  if (!layerId) throw new Error("Photoshop did not create the merged layer.");
  return layerId;
}

async function copyActivePixels(): Promise<void> {
  await batchPlay([{
    _obj: "copyEvent",
    copyHint: "pixels",
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function stampVisible(): Promise<number> {
  await batchPlay([{
    _obj: "mergeVisible",
    duplicate: true,
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const descriptor = await getActiveLayerDescriptor();
  const layerId = descriptor.layerID as number | undefined;
  if (!layerId) throw new Error("Photoshop did not create the merged visible layer.");
  return layerId;
}

async function convertActiveLayerToSmartObject(): Promise<number> {
  await batchPlay([{
    _obj: "newPlacedLayer",
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const descriptor = await getActiveLayerDescriptor();
  const layerId = descriptor.layerID as number | undefined;
  if (!layerId) throw new Error("Photoshop did not create the Smart Object.");
  return layerId;
}

export const runMergeVisible = async (): Promise<string> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("No document open.");
  }

  let outputId = 0;
  let selectedCount = 0;
  const snapshots: VisibilitySnapshot[] = [];

  await withHistory(doc, "Merge Visible", async () => {
    const layers = allLayers(doc);
    const byId = new Map<number, any>();
    for (const layer of layers) {
      const id = getLayerId(layer);
      if (id !== null) byId.set(id, layer);
      if (id !== null) snapshots.push({ id, visible: layer.visible !== false });
    }

    const selected = collectSelectedLayers(doc);
    const visibleSelected = selected.filter(layer => layer.visible !== false);
    selectedCount = visibleSelected.length;
    if (!selectedCount) throw new Error("Select at least one visible layer first.");

    const selectedIds = new Set(visibleSelected.map(layer => getLayerId(layer)));
    const placementAnchor = layers.find(layer => selectedIds.has(getLayerId(layer))) ?? visibleSelected[0];
    if (!placementAnchor) throw new Error("Could not determine the selected layer position.");

    const included = new Set<number>();
    for (const layer of visibleSelected) markLayerTree(layer, included);

    const ancestorIds = new Set<number>();
    for (const id of included) {
      let current = byId.get(id);
      while (current) {
        const parentId = getParentId(current);
        if (parentId === null || !byId.has(parentId)) break;
        ancestorIds.add(parentId);
        current = byId.get(parentId);
      }
    }

    try {
      // Leave only the selected visible layers and their required parents
      // visible before copying the merged canvas-sized result.
      for (const layer of layers) {
        const id = getLayerId(layer);
        if (id === null) continue;
        if (ancestorIds.has(id) || included.has(id)) {
          if (ancestorIds.has(id) || visibleSelected.some(selectedLayer => getLayerId(selectedLayer) === id)) {
            layer.visible = true;
          }
        } else {
          layer.visible = false;
        }
      }

      await doc.selection.selectAll();
      let mergedLayerId = 0;
      const needsVisibleStamp = visibleSelected.length > 1
        || visibleSelected.some(layer => childLayers(layer).length > 0);
      if (!needsVisibleStamp) {
        await copyActivePixels();
        mergedLayerId = await pastePixels();
      } else {
        mergedLayerId = await stampVisible();
      }
      try { await doc.selection.deselect(); } catch (_) {}
      if (!mergedLayerId) throw new Error("Photoshop did not create the merged layer.");
      outputId = await convertActiveLayerToSmartObject();
      await renameActiveLayer("MERGE VISIBLE");
      await moveLayerAbove(doc, outputId, placementAnchor);
    } finally {
      // Always restore the source document before the history state closes.
      await restoreVisibility(doc, snapshots);
    }
  }).finally(async () => {
    try {
      await restoreVisibility(doc, snapshots);
    } catch (_) {}
  });

  if (!outputId) throw new Error("MERGE VISIBLE did not create an output layer.");
  return "Created a canvas-trimmed Smart Object from " + selectedCount
    + " selected layer" + (selectedCount === 1 ? "" : "s") + ".";
};
