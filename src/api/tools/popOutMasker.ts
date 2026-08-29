import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export interface PopOutMaskerOptions {
  playerPrefix: string;
  maskPrefix: string;
  cutoutSuffix: string;
  startIndex: number;
  count: number;
  autoDetect: boolean;
  replaceExisting: boolean;
}

export interface PopOutMaskerResetOptions {
  playerPrefix: string;
  cutoutSuffix: string;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAllLayers(parent: any): any[] {
  const layers: any[] = [];
  try {
    for (const layer of Array.from<any>(parent.layers)) {
      layers.push(layer);
      if (layer.kind === "group" && layer.layers) layers.push(...getAllLayers(layer));
    }
  } catch (_) {}
  return layers;
}

function findLayerByName(doc: any, name: string): any | null {
  return getAllLayers(doc).find(layer => String(layer.name ?? "") === name) ?? null;
}

function findCutoutLayers(doc: any, playerPrefix: string, cutoutSuffix: string): any[] {
  const pattern = new RegExp(`^${escapeRegex(playerPrefix)}\\d+${escapeRegex(cutoutSuffix)}$`);
  return getAllLayers(doc).filter(layer => pattern.test(String(layer.name ?? "")));
}

function detectPairCount(doc: any, playerPrefix: string, maskPrefix: string, startIndex: number): number {
  const names = new Set(getAllLayers(doc).map(layer => String(layer.name ?? "")));
  let count = 0;
  for (let index = startIndex; names.has(`${playerPrefix}${index}`) && names.has(`${maskPrefix}${index}`); index++) {
    count++;
  }
  return count;
}

async function selectLayerByName(name: string): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _name: name }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function selectLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
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

async function renameActiveLayer(name: string): Promise<void> {
  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "layer", name },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function selectSubject(): Promise<void> {
  await batchPlay([{
    _obj: "autoCutout",
    sampleAllLayers: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function copySelectionPixels(): Promise<void> {
  await batchPlay([{
    _obj: "copyEvent",
    copyHint: "pixels",
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function pastePixels(): Promise<number> {
  const result = await batchPlay([{
    _obj: "paste",
    antiAlias: { _enum: "antiAliasType", _value: "antiAliasNone" },
    as: { _class: "pixel" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const descriptor = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  return (descriptor[0]?.layerID ?? result[0]?.ID?.[0]) as number;
}

async function duplicateMaskToActiveLayer(maskLayerName: string): Promise<void> {
  await batchPlay([{
    _obj: "make",
    new: { _class: "channel" },
    at: {
      _ref: [
        { _ref: "channel", _enum: "channel", _value: "mask" },
        { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
      ],
    },
    using: {
      _ref: [
        { _ref: "channel", _enum: "channel", _value: "mask" },
        { _ref: "layer", _name: maskLayerName },
      ],
    },
    duplicate: true,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

export const runPopOutMasker = async (options: PopOutMaskerOptions): Promise<string> => {
  const playerPrefix = options.playerPrefix.trim() || "player_";
  const maskPrefix = options.maskPrefix.trim() || "mask_";
  const cutoutSuffix = options.cutoutSuffix.trim() || "_cutout";
  const startIndex = Math.max(1, Math.floor(options.startIndex || 1));
  const requestedCount = Math.max(0, Math.floor(options.count || 0));

  const results: string[] = [];
  let processed = 0;
  let rowCount = requestedCount;
  const doc = photoshop.app.activeDocument as any;

  await withHistory(doc, "Pop Out Masker", async () => {
    if (options.autoDetect) {
      rowCount = detectPairCount(doc, playerPrefix, maskPrefix, startIndex);
      results.push(`Auto-detected ${rowCount} player/mask pair${rowCount === 1 ? "" : "s"}.`);
    }

    if (rowCount <= 0) return;

    for (let offset = 0; offset < rowCount; offset++) {
      const index = startIndex + offset;
      const playerName = `${playerPrefix}${index}`;
      const maskName = `${maskPrefix}${index}`;
      const cutoutName = `${playerName}${cutoutSuffix}`;

      try {
        const playerLayer = findLayerByName(doc, playerName);
        if (!playerLayer) {
          results.push(`${playerName}: missing player layer`);
          continue;
        }
        const maskLayer = findLayerByName(doc, maskName);
        if (!maskLayer) {
          results.push(`${playerName}: missing mask layer ${maskName}`);
          continue;
        }

        if (options.replaceExisting) {
          const existing = findLayerByName(doc, cutoutName);
          if (existing?.id) await deleteLayerById(existing.id as number);
        }

        await selectLayerById(playerLayer.id as number);
        await selectSubject();
        await copySelectionPixels();
        const cutoutId = await pastePixels();
        await renameActiveLayer(cutoutName);
        await selectLayerById(cutoutId);
        await duplicateMaskToActiveLayer(maskName);

        processed++;
        results.push(`${playerName}: OK -> ${cutoutName} using ${maskName}`);
      } catch (e: any) {
        results.push(`${playerName}: ERROR ${e?.message ?? String(e)}`);
      }
    }
  });

  if (rowCount <= 0) return `No player/mask pairs found from ${playerPrefix}${startIndex} + ${maskPrefix}${startIndex}.`;
  return [`Done - ${processed} of ${rowCount} cutout${rowCount === 1 ? "" : "s"} created.`, ...results].join("\n");
};
export const resetPopOutMaskerTemplate = async (options: PopOutMaskerResetOptions): Promise<string> => {
  const playerPrefix = options.playerPrefix.trim() || "player_";
  const cutoutSuffix = options.cutoutSuffix.trim() || "_cutout";
  let deleted = 0;
  const doc = photoshop.app.activeDocument as any;

  await withHistory(doc, "Reset Pop Out Masker", async () => {
    const cutouts = findCutoutLayers(doc, playerPrefix, cutoutSuffix);

    for (const layer of cutouts) {
      if (typeof layer.id !== "number") continue;
      await deleteLayerById(layer.id as number);
      deleted++;
    }
  });

  if (!deleted) return `No cutout layers found matching ${playerPrefix}1${cutoutSuffix}, ${playerPrefix}2${cutoutSuffix}...`;
  return `Reset complete. Deleted ${deleted} cutout layer${deleted === 1 ? "" : "s"}.`;
};
