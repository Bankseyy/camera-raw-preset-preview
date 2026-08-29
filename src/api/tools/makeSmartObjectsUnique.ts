import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function collectLayerIds(parent: any): number[] {
  const ids: number[] = [];

  function walk(node: any): void {
    try {
      for (const layer of Array.from<any>(node.layers)) {
        try {
          if (typeof layer.id === "number") ids.push(layer.id);
          if (layer.kind === "group" && layer.layers) walk(layer);
        } catch (_) {}
      }
    } catch (_) {}
  }

  walk(parent);
  return ids;
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

async function deleteLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "delete",
    _target: [{ _ref: "layer", _id: id }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

export const runMakeSmartObjectsUnique = async (): Promise<string> => {
  let smartObjects = 0;
  let unique = 0;
  const failed: string[] = [];

  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("No document open.");
  }

  await withHistory(doc, "Make Smart Objects Unique", async () => {
    const layerIds = collectLayerIds(doc);

    for (const id of layerIds) {
      const descriptor = await getLayerDescriptor(id);
      if (!descriptor?.smartObject) continue;

      smartObjects++;
      const name = String(descriptor.name ?? `Layer ${id}`);

      try {
        await selectLayerById(id);
        await batchPlay([{
          _obj: "placedLayerMakeCopy",
          _options: { dialogOptions: "dontDisplay" },
        }], {});
        await renameActiveLayer(name);
        await deleteLayerById(id);
        unique++;
      } catch (e: any) {
        failed.push(`${name}: ${e?.message ?? String(e)}`);
      }
    }
  });

  if (smartObjects === 0) return "No Smart Objects found in the document.";

  const summary = `Made ${unique} of ${smartObjects} Smart Object${smartObjects === 1 ? "" : "s"} unique.`;
  return failed.length ? [summary, "Failed:", ...failed].join("\n") : summary;
};
