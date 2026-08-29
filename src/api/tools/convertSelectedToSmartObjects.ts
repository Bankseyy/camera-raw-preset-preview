import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

async function getSelectedLayerIds(doc: any): Promise<number[]> {
  const fromDom = Array.from<any>(doc.activeLayers ?? [])
    .map(layer => layer?.id)
    .filter((id): id is number => typeof id === "number");
  if (fromDom.length > 0) return fromDom;

  try {
    const docInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});

    const targetLayers = docInfo[0]?.targetLayers ?? [];
    const ids: number[] = [];
    for (const target of targetLayers) {
      const layerInfo = await batchPlay([{
        _obj: "get",
        _target: [{ _ref: "layer", _index: target._index + 1 }],
        _options: { dialogOptions: "dontDisplay" },
      }], {});
      const id = layerInfo[0]?.layerID;
      if (typeof id === "number") ids.push(id);
    }
    if (ids.length > 0) return ids;
  } catch (_) {}

  const activeId = doc.activeLayer?.id;
  return typeof activeId === "number" ? [activeId] : [];
}

async function getLayerDescriptorById(id: number): Promise<any> {
  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _id: id }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  return result[0];
}

async function getActiveLayerDescriptor(): Promise<any> {
  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  return result[0];
}

async function selectLayerById(id: number, add = false): Promise<void> {
  const desc: any = {
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  };
  if (add) {
    desc.selectionModifier = { _enum: "selectionModifierType", _value: "addToSelection" };
  }
  await batchPlay([desc], {});
}

async function selectLayersById(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await selectLayerById(ids[0]);
  for (let i = 1; i < ids.length; i++) {
    await selectLayerById(ids[i], true);
  }
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

export const runConvertSelectedToSmartObjects = async (): Promise<string> => {
  const failed: string[] = [];
  const outputIds: number[] = [];
  let selectedCount = 0;

  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("No document open.");
  }

  await withHistory(doc, "Convert Selected Layers to Smart Objects", async () => {
    const selectedIds = await getSelectedLayerIds(doc);
    selectedCount = selectedIds.length;
    if (selectedIds.length === 0) {
      throw new Error("No layers selected. Select one or more layers first.");
    }

    for (const id of selectedIds) {
      let originalName = `Layer ${id}`;
      try {
        const original = await getLayerDescriptorById(id);
        originalName = String(original?.name ?? originalName);

        await selectLayerById(id);

        if (original?.smartObject) {
          await batchPlay([{ _obj: "placedLayerMakeCopy", _options: { dialogOptions: "dontDisplay" } }], {});
          const copy = await getActiveLayerDescriptor();
          const copyId = copy?.layerID as number | undefined;
          await renameActiveLayer(originalName);
          await deleteLayerById(id);
          if (typeof copyId === "number") outputIds.push(copyId);
        } else {
          await batchPlay([{ _obj: "newPlacedLayer", _options: { dialogOptions: "dontDisplay" } }], {});
          const converted = await getActiveLayerDescriptor();
          const convertedId = converted?.layerID as number | undefined;
          await renameActiveLayer(originalName);
          if (typeof convertedId === "number") outputIds.push(convertedId);
        }
      } catch (e: any) {
        failed.push(`${originalName}: ${e?.message ?? String(e)}`);
      }
    }

    await selectLayersById(outputIds);
  });

  const converted = outputIds.length;
  const summary = `Converted ${converted} of ${selectedCount} selected layer${selectedCount === 1 ? "" : "s"} to unique Smart Object${converted === 1 ? "" : "s"}.`;
  return failed.length ? [summary, "Failed:", ...failed].join("\n") : summary;
};
