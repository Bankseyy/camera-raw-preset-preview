import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export interface AutoRenameByPrefixOptions {
  reverse: boolean;
  mode?: "layer" | "group";
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

export function parseAutoRenameSeed(name: string): {
  prefix: string;
  start: number;
  width: number;
  hadNumber: boolean;
} {
  const match = name.match(/^(.*?)(\d+)$/);
  if (match) {
    return {
      prefix: match[1],
      start: parseInt(match[2], 10),
      width: match[2].length,
      hadNumber: true,
    };
  }

  return {
    prefix: name,
    start: 1,
    width: 1,
    hadNumber: false,
  };
}

function padNumber(value: number, width: number): string {
  const text = String(value);
  return text.length >= width ? text : "0".repeat(width - text.length) + text;
}

export function buildAutoRenameNames(seedName: string, count: number): string[] {
  const seed = parseAutoRenameSeed(seedName);
  const names = [seedName];

  for (let i = 1; i < count; i++) {
    names.push(
      seed.hadNumber
        ? `${seed.prefix}${padNumber(seed.start + i, seed.width)}`
        : `${seed.prefix}_${i + 1}`
    );
  }

  return names;
}

async function renameLayerOrGroup(layer: any, name: string): Promise<void> {
  const id = Number(layer?.id);
  if (!id) throw new Error(`Could not read the Photoshop ID for "${String(layer?.name ?? "selected item")}".`);

  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _id: id }],
    to: { _obj: "layer", name },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

function isGroupLayer(layer: any): boolean {
  return layer?.kind === "group" || layer?.typename === "LayerSet";
}

function findLayerById(parent: any, id: number): any | null {
  try {
    for (const layer of Array.from<any>(parent?.layers ?? [])) {
      if (Number(layer?.id) === id) return layer;
      if (isGroupLayer(layer)) {
        const found = findLayerById(layer, id);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

function isGroupDescriptor(descriptor: any): boolean {
  return descriptor?.layerSection?._value === "layerSectionStart" || descriptor?.layerKind === 7;
}

async function getExplicitSelectedGroups(doc: any): Promise<any[]> {
  const documentInfo = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  const targets = Array.from<any>(documentInfo[0]?.targetLayers ?? []);
  const groupIds: number[] = [];

  for (const target of targets) {
    try {
      const layerTarget = Number.isFinite(Number(target?._id))
        ? { _ref: "layer", _id: Number(target._id) }
        : { _ref: "layer", _index: Number(target?._index) + 1 };
      const result = await batchPlay([{
        _obj: "get",
        _target: [layerTarget],
        _options: { dialogOptions: "dontDisplay" },
      }], {});
      const descriptor = result[0];
      const id = Number(descriptor?.layerID);
      if (id > 0 && isGroupDescriptor(descriptor) && !groupIds.includes(id)) groupIds.push(id);
    } catch (_) {}
  }

  const groups = groupIds
    .map(id => findLayerById(doc, id))
    .filter((layer): layer is any => Boolean(layer && isGroupLayer(layer)));
  const selectedIds = new Set(groups.map(group => Number(group.id)));

  return groups.filter(group => {
    let parent = group.parent;
    while (isGroupLayer(parent)) {
      if (selectedIds.has(Number(parent.id))) return false;
      parent = parent.parent;
    }
    return true;
  });
}

export const runAutoRenameByPrefix = async (
  options: AutoRenameByPrefixOptions
): Promise<string> => {
  let renamed = 0;
  let seedName = "";
  let selectedCount = 0;
  const doc = photoshop.app.activeDocument as any;
  if (!doc) throw new Error("No document open.");

  await withHistory(doc, "Auto Rename Layers And Groups", async () => {
    let layers = options.mode === "group"
      ? await getExplicitSelectedGroups(doc)
      : Array.from<any>(doc.activeLayers ?? []);
    selectedCount = layers.length;
    if (selectedCount === 0) {
      throw new Error(options.mode === "group" ? "No group headers selected." : "No layers selected.");
    }
    if (selectedCount === 1) {
      throw new Error(options.mode === "group" ? "Select 2 or more group headers." : "Select 2 or more layers.");
    }

    if (options.reverse) layers = layers.slice().reverse();

    seedName = String(layers[0].name ?? "");
    const names = buildAutoRenameNames(seedName, layers.length);

    for (let i = 1; i < layers.length; i++) {
      await renameLayerOrGroup(layers[i], names[i]);
      renamed++;
    }
  });

  const itemLabel = options.mode === "group" ? "group" : "layer";
  return `Renamed ${renamed} of ${selectedCount - 1} ${itemLabel}${selectedCount - 1 === 1 ? "" : "s"} from "${seedName}".`;
};
