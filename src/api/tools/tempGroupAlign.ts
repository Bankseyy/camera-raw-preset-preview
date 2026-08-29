import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export type TempGroupAlignMode = "x" | "y" | "both";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

async function selectLayerById(id: number, add = false): Promise<void> {
  const descriptor: any = {
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  };
  if (add) {
    descriptor.selectionModifier = {
      _enum: "selectionModifierType",
      _value: "addToSelection",
    };
  }
  await batchPlay([descriptor], {});
}

async function restoreSelection(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await selectLayerById(ids[0]);
  for (let index = 1; index < ids.length; index++) {
    await selectLayerById(ids[index], true);
  }
}

function parentKey(layer: any): string {
  try {
    const parent = layer.parent;
    return parent && typeof parent.id === "number" ? `layer:${parent.id}` : "document";
  } catch (_) {
    return "document";
  }
}

type AlignmentBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  source: "selection" | "canvas";
};

function getAlignmentBounds(doc: any): AlignmentBounds {
  try {
    const selection = doc.selection?.bounds;
    const left = toNumber(selection?.left);
    const top = toNumber(selection?.top);
    const right = toNumber(selection?.right);
    const bottom = toNumber(selection?.bottom);
    if (right > left && bottom > top) {
      return { left, top, right, bottom, source: "selection" };
    }
  } catch (_) {}

  const right = toNumber(doc.width);
  const bottom = toNumber(doc.height);
  if (!right || !bottom) throw new Error("Could not read the alignment area.");
  return { left: 0, top: 0, right, bottom, source: "canvas" };
}

async function ungroupSelectedLayer(): Promise<void> {
  await batchPlay([{
    _obj: "ungroupLayersEvent",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

export const runTempGroupAlign = async (mode: TempGroupAlignMode): Promise<string> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("No document open.");
  }

  let message = "Temporary group align complete.";

  await withHistory(doc, "Temporary Group Align", async () => {
    doc = photoshop.app.activeDocument as any;
    const selectedLayers = Array.from<any>(doc.activeLayers ?? []);
    if (!selectedLayers.length) throw new Error("No movable layers selected.");

    const parentKeys = new Set(selectedLayers.map(parentKey));
    if (parentKeys.size > 1) {
      throw new Error("Selected layers must be inside the same parent group.");
    }

    const selectedIds = selectedLayers
      .map(layer => layer?.id)
      .filter((id): id is number => typeof id === "number");
    if (!selectedIds.length) throw new Error("Could not read the selected layers.");

    const temporaryGroup = await doc.groupLayers(selectedLayers);
    if (!temporaryGroup) throw new Error("Photoshop could not create the temporary group.");

    try {
      const alignmentBounds = getAlignmentBounds(doc);
      const bounds = temporaryGroup.boundsNoEffects ?? temporaryGroup.bounds;
      const left = toNumber(bounds?.left);
      const top = toNumber(bounds?.top);
      const right = toNumber(bounds?.right);
      const bottom = toNumber(bounds?.bottom);
      if (right <= left || bottom <= top) {
        throw new Error("Could not read the temporary group bounds.");
      }

      const dx = mode === "x" || mode === "both"
        ? ((alignmentBounds.left + alignmentBounds.right) / 2) - ((left + right) / 2)
        : 0;
      const dy = mode === "y" || mode === "both"
        ? ((alignmentBounds.top + alignmentBounds.bottom) / 2) - ((top + bottom) / 2)
        : 0;

      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
        await temporaryGroup.translate(Math.round(dx), Math.round(dy));
      }

      const label = mode === "both"
        ? "on both axes"
        : mode === "x"
          ? "on the vertical axis"
          : "on the horizontal axis";
      const area = alignmentBounds.source === "selection" ? "the selected area" : "the canvas";
      message = `Centered ${selectedIds.length} selected layer${selectedIds.length === 1 ? "" : "s"} ${label} within ${area} as a temporary group.`;
    } finally {
      await selectLayerById(temporaryGroup.id);
      await ungroupSelectedLayer();
    }

    await restoreSelection(selectedIds);
  });

  return message;
};
