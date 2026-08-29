import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function collectAllLayers(parent: any, out: any[]): void {
  try {
    for (const layer of Array.from<any>(parent.layers)) {
      try {
        if (layer.kind === "group") {
          collectAllLayers(layer, out);
        } else if (!layer.isBackgroundLayer) {
          out.push(layer);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

function prefixFromLayerName(layerName: string): string {
  const index = layerName.lastIndexOf("_");
  return index === -1 ? layerName : layerName.substring(0, index + 1);
}

async function getSelectedLayerNames(): Promise<string[]> {
  const docInfo = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const targetLayers: any[] = docInfo[0]?.targetLayers ?? [];
  const names: string[] = [];
  for (const target of targetLayers) {
    const layerInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _index: Number(target._index) + 1 }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    const name = layerInfo[0]?.name;
    if (typeof name === "string" && name) names.push(name);
  }

  if (names.length) return names;

  const activeInfo = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  const activeName = activeInfo[0]?.name;
  return typeof activeName === "string" && activeName ? [activeName] : [];
}

export const runAutoSelectByPrefix = async (): Promise<string> => {
  let result = "Done.";

  await asModal("Auto Select by Prefix", async () => {
    const selectedNames = await getSelectedLayerNames();
    if (!selectedNames.length) {
      result = "No layers selected.";
      return;
    }

    const prefixes = Array.from(new Set(selectedNames.map(prefixFromLayerName)));
    const normalizedPrefixes = prefixes.map(prefix => prefix.toLowerCase());
    const allLayers: any[] = [];
    collectAllLayers(photoshop.app.activeDocument, allLayers);

    const matches = allLayers.filter(layer => {
      try {
        const name = (layer.name as string).toLowerCase();
        return normalizedPrefixes.some(prefix => name.startsWith(prefix));
      } catch (_) {
        return false;
      }
    });

    if (!matches.length) {
      result = `No layers found with prefix ${prefixes.map(prefix => `"${prefix}"`).join(", ")}.`;
      return;
    }

    await batchPlay([{
      _obj: "select",
      _target: [{ _ref: "layer", _id: matches[0].id }],
      makeVisible: false,
      _options: { dialogOptions: "dontDisplay" },
    }], {});

    for (let index = 1; index < matches.length; index++) {
      await batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: matches[index].id }],
        selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" },
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      }], {});
    }

    const label = prefixes.map(prefix => `"${prefix}"`).join(", ");
    result = `Selected ${matches.length} layer${matches.length === 1 ? "" : "s"} with prefix${prefixes.length === 1 ? "" : "es"} ${label}.`;
  });

  return result;
};
