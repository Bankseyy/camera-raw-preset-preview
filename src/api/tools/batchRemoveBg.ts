import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

async function getSelectedLayerIds(): Promise<number[]> {
  const docInfo = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const targetLayers = docInfo[0].targetLayers;
  if (!targetLayers || targetLayers.length === 0) {
    throw new Error("No layers selected. Please select one or more layers first.");
  }

  const layerIDs: number[] = [];
  for (const target of targetLayers) {
    const layerInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _index: target._index + 1 }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    layerIDs.push(layerInfo[0].layerID);
  }
  return layerIDs;
}

async function selectLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function removeBackgroundFromActiveLayer(): Promise<void> {
  await batchPlay([{
    _obj: "removeBackground",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function applyActiveMask(): Promise<void> {
  await batchPlay([{
    _obj: "delete",
    _target: [{ _ref: "channel", _enum: "ordinal", _value: "targetEnum" }],
    apply: true,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

export const runBatchRemoveBg = async (): Promise<string> => {
  const warnings: string[] = [];
  const doc = photoshop.app.activeDocument as any;

  await withHistory(doc, "Batch Remove BG", async () => {
    const layerIDs = await getSelectedLayerIds();
    let successCount = 0;

    for (const id of layerIDs) {
      try {
        await selectLayerById(id);
        await removeBackgroundFromActiveLayer();
        await applyActiveMask();
        successCount++;
      } catch (e: any) {
        warnings.push(`Layer ${id}: ${e?.message ?? String(e)}`);
      }
    }

    warnings.unshift(`Done - ${successCount} of ${layerIDs.length} layer${layerIDs.length === 1 ? "" : "s"} processed.`);
  });

  return warnings.join("\n");
};
