import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";
import {
  replaceBadgeSmartObjectContents,
  resetClubBadgeAssetResolver,
  resolveClubBadgeAsset,
  type BadgeDropperClubBadgeStyle,
} from "./badgeDropper";

export interface PlTableUpdaterOptions {
  csvText: string;
  tableGroupName?: string;
  badgeStyle?: BadgeDropperClubBadgeStyle;
  metrics?: PlTableMetric[];
}

export type PlTableMetric = "played" | "won" | "drawn" | "lost" | "gd" | "pts";

const PL_TABLE_METRICS: PlTableMetric[] = ["played", "won", "drawn", "lost", "gd", "pts"];

interface PlTableRow {
  position: string;
  club: string;
  played: string;
  won: string;
  drawn: string;
  lost: string;
  gd: string;
  pts: string;
  badge: string;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function cleanNum(value: string): string {
  return String(value ?? "").trim().replace(/^\+/, "").replace(/\.0+$/, "");
}

function mapClubDisplayName(name: string): string {
  const clean = String(name ?? "").trim();
  const key = clean.toLowerCase();
  if (key === "tottenham hotspur") return "Tottenham";
  if (key === "brighton & hove albion") return "Brighton";
  if (key === "wolverhampton wanderers") return "Wolves";
  return clean;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  cells.push(current.trim());
  return cells;
}

function parseRows(csvText: string): PlTableRow[] {
  const lines = String(csvText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(header => header.trim().toLowerCase());
  const indexOf = (name: string) => headers.indexOf(name);
  const required = ["position", "club", "played", "won", "drawn", "lost", "gd", "pts"];
  for (const header of required) {
    if (indexOf(header) < 0) throw new Error(`CSV is missing "${header}" column.`);
  }

  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const cell = (name: string) => String(cells[indexOf(name)] ?? "").trim();
    return {
      position: cell("position"),
      club: cell("club"),
      played: cell("played"),
      won: cell("won"),
      drawn: cell("drawn"),
      lost: cell("lost"),
      gd: cell("gd"),
      pts: cell("pts"),
      badge: indexOf("badge") >= 0 ? cell("badge") : "",
    };
  }).filter(row => row.club);
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

function findGroupByName(parent: any, name: string): any | null {
  for (const layer of getAllLayers(parent)) {
    if (layer.kind === "group" && String(layer.name ?? "") === name) return layer;
  }
  return null;
}

function findLayerByName(parent: any, name: string): any | null {
  return getAllLayers(parent).find(layer => String(layer.name ?? "") === name) ?? null;
}

function findFirstSmartObjectLayer(parent: any): any | null {
  return getAllLayers(parent).find(layer => layer.kind === "smartObject") ?? null;
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

async function getActiveLayerDescriptor(): Promise<any> {
  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  return result[0] ?? {};
}

async function makeSmartObjectIndependent(layer: any): Promise<number> {
  const originalId = layer.id as number;
  const originalName = String(layer.name ?? "");

  await selectLayerById(originalId);
  await batchPlay([{ _obj: "placedLayerMakeCopy", _options: { dialogOptions: "dontDisplay" } }], {});

  const descriptor = await getActiveLayerDescriptor();
  const newId = descriptor.layerID as number;
  if (!newId || newId === originalId) throw new Error(`Could not make "${originalName}" independent.`);

  if (originalName) await renameActiveLayer(originalName);
  await deleteLayerById(originalId);
  return newId;
}

const cloneDescriptor = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function resizeRangesToText(ranges: any[] | undefined, key: string, newText: string): any[] {
  const source = Array.isArray(ranges) && ranges.length ? ranges : [];
  const end = Math.max(1, newText.length + 1);
  const first = source[0]?.[key];
  if (!first) return [];
  return [{ from: 0, to: end, [key]: cloneDescriptor(first) }];
}

async function setTextLayerContents(layer: any, value: string): Promise<void> {
  await selectLayerById(layer.id as number);
  const getResult = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const textKey = getResult[0]?.textKey;
  if (!textKey) {
    layer.textItem.contents = value;
    return;
  }

  const textStyleRange = resizeRangesToText(textKey.textStyleRange, "textStyle", value);
  const paragraphStyleRange = resizeRangesToText(textKey.paragraphStyleRange, "paragraphStyle", value);
  const to: any = { _obj: "textLayer", textKey: value };
  if (textStyleRange.length) to.textStyleRange = textStyleRange;
  if (paragraphStyleRange.length) to.paragraphStyleRange = paragraphStyleRange;

  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
    to,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function replaceBadgeSmartObject(hostDoc: any, badgeLayer: any, badgeEntry: any): Promise<void> {
  const independentId = await makeSmartObjectIndependent(badgeLayer);

  try {
    await replaceBadgeSmartObjectContents(hostDoc, independentId, badgeEntry, {
      keepBaseVisible: false,
      clipToBase: false,
      fitMode: "height",
    });
    photoshop.app.activeDocument = hostDoc;
    await selectLayerById(independentId);
    await renameActiveLayer("badge");
  } catch (e) {
    try { photoshop.app.activeDocument = hostDoc; } catch (_) {}
    throw e;
  }
}

async function updateTextIfExists(rowGroup: any, layerName: string, value: string, notes: string[]): Promise<boolean> {
  const layer = findLayerByName(rowGroup, layerName);
  if (!layer) {
    notes.push(`In "${rowGroup.name}": missing text layer "${layerName}".`);
    return false;
  }
  if (layer.kind !== "text") {
    notes.push(`In "${rowGroup.name}": layer "${layerName}" is not a text layer.`);
    return false;
  }
  await setTextLayerContents(layer, value);
  return true;
}

export const runPlTableUpdater = async (options: PlTableUpdaterOptions): Promise<string> => {
  const rows = parseRows(options.csvText).slice(0, 20);
  if (!rows.length) return "CSV had no data rows.";

  resetClubBadgeAssetResolver();
  const tableName = String(options.tableGroupName ?? "TABLE").trim() || "TABLE";

  const notes: string[] = [];
  let textUpdates = 0;
  let badgeUpdates = 0;
  const doc = photoshop.app.activeDocument as any;
  const selectedMetrics = new Set<PlTableMetric>(options.metrics ?? PL_TABLE_METRICS);

  await withHistory(doc, "PL Table Updater", async () => {
    const tableGroup = findGroupByName(doc, tableName);
    if (!tableGroup) throw new Error(`Could not find a group named "${tableName}".`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowGroup = findGroupByName(tableGroup, `row_${i + 1}`);
      if (!rowGroup) {
        notes.push(`Missing group: row_${i + 1}.`);
        continue;
      }

      const values: Record<string, string> = {
        pos: cleanNum(row.position),
        club: mapClubDisplayName(row.club),
      };

      const metricValues: Record<PlTableMetric, string> = {
        played: cleanNum(row.played),
        won: cleanNum(row.won),
        drawn: cleanNum(row.drawn),
        lost: cleanNum(row.lost),
        gd: cleanNum(row.gd),
        pts: cleanNum(row.pts),
      };

      for (const metric of PL_TABLE_METRICS) {
        const metricLayer = findLayerByName(rowGroup, metric);
        if (metricLayer) {
          try { metricLayer.visible = selectedMetrics.has(metric); } catch (_) {}
        }
        if (selectedMetrics.has(metric)) values[metric] = metricValues[metric];
      }

      for (const [layerName, value] of Object.entries(values)) {
        try {
          if (await updateTextIfExists(rowGroup, layerName, value, notes)) textUpdates++;
        } catch (e: any) {
          notes.push(`In "${rowGroup.name}": failed to set "${layerName}" (${e?.message ?? String(e)}).`);
        }
      }

      let badgeAsset = null;
      try {
        badgeAsset = await resolveClubBadgeAsset(row.club, options.badgeStyle ?? "regular");
        if (!badgeAsset && row.badge) {
          badgeAsset = await resolveClubBadgeAsset(
            row.badge.replace(/\.[^.]+$/, ""),
            options.badgeStyle ?? "regular"
          );
        }
      } catch (e: any) {
        notes.push(`Row "${rowGroup.name}": badge lookup failed for "${row.club}" (${e?.message ?? String(e)}).`);
        continue;
      }

      if (!badgeAsset) {
        const label = options.badgeStyle === "square" ? "square badge" : "badge";
        notes.push(`Row "${rowGroup.name}": no ${label} cache match for "${row.club}".`);
        continue;
      }

      const badgeLayer = findLayerByName(rowGroup, "badge") ?? findFirstSmartObjectLayer(rowGroup);
      if (!badgeLayer || badgeLayer.kind !== "smartObject") {
        notes.push(`Row "${rowGroup.name}": no badge Smart Object found.`);
        continue;
      }

      try {
        photoshop.app.activeDocument = doc;
        await replaceBadgeSmartObject(doc, badgeLayer, badgeAsset.entry);
        badgeUpdates++;
      } catch (e: any) {
        notes.push(`Row "${rowGroup.name}": badge update failed (${e?.message ?? String(e)}).`);
      }
    }
  });

  const lines = [
    `Done. Updated ${rows.length} row${rows.length === 1 ? "" : "s"}.`,
    `${textUpdates} text update${textUpdates === 1 ? "" : "s"}, ${badgeUpdates} badge${badgeUpdates === 1 ? "" : "s"}.`,
  ];
  if (notes.length) lines.push(`Notes:\n - ${notes.join("\n - ")}`);
  return lines.join("\n");
};
