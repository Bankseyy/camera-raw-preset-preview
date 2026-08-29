import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function boundsFromDom(layer: any) {
  const b = layer.bounds;
  if (!b) throw new Error("Active layer has no bounds.");

  if (Array.isArray(b)) {
    return {
      left: toNumber(b[0]),
      top: toNumber(b[1]),
      right: toNumber(b[2]),
      bottom: toNumber(b[3]),
    };
  }

  return {
    left: toNumber(b.left),
    top: toNumber(b.top),
    right: toNumber(b.right),
    bottom: toNumber(b.bottom),
  };
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function boundsFromActionGet(layerId: number) {
  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _id: layerId }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const bounds = result[0]?.bounds;
  if (!bounds) throw new Error("Active layer has no selectable bounds.");

  return {
    left: toNumber(bounds.left),
    top: toNumber(bounds.top),
    right: toNumber(bounds.right),
    bottom: toNumber(bounds.bottom),
  };
}

function isGroupLayer(layer: any): boolean {
  return layer?.kind === "group" || layer?.typename === "LayerSet";
}

function hasArea(bounds: Bounds): boolean {
  return bounds.right > bounds.left && bounds.bottom > bounds.top;
}

function combineBounds(allBounds: Bounds[]): Bounds {
  return allBounds.reduce((combined, bounds) => ({
    left: Math.min(combined.left, bounds.left),
    top: Math.min(combined.top, bounds.top),
    right: Math.max(combined.right, bounds.right),
    bottom: Math.max(combined.bottom, bounds.bottom),
  }));
}

export const runSelectLayerBounds = async (): Promise<string> => {
  let message = "";

  await asModal("Select Layer Bounds", async () => {
    const doc = photoshop.app.activeDocument as any;
    const activeLayers = Array.from<any>(doc.activeLayers ?? []);
    const selectedLayers = activeLayers.length > 0
      ? activeLayers
      : (doc.activeLayer ? [doc.activeLayer] : []);
    if (selectedLayers.length === 0) throw new Error("No active layers. Select one or more layers first.");

    const boundsList: Bounds[] = [];
    let skipped = 0;

    for (const layer of selectedLayers) {
      try {
        const bounds = isGroupLayer(layer)
          ? boundsFromDom(layer)
          : await boundsFromActionGet(layer.id as number);

        if (hasArea(bounds)) boundsList.push(bounds);
        else skipped++;
      } catch (_) {
        skipped++;
      }
    }

    if (boundsList.length === 0) throw new Error("The selected layers have no visible bounds.");

    const bounds = combineBounds(boundsList);

    await doc.selection.selectRectangle(
      bounds,
      photoshop.constants.SelectionType.REPLACE
    );

    const selectedCount = boundsList.length;
    const skippedText = skipped > 0 ? ` ${skipped} empty layer${skipped === 1 ? " was" : "s were"} skipped.` : "";
    message = `Selected combined bounds of ${selectedCount} layer${selectedCount === 1 ? "" : "s"}: ${Math.round(bounds.right - bounds.left)}x${Math.round(bounds.bottom - bounds.top)}px.${skippedText}`;
  });

  return message;
};
