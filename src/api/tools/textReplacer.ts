import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export type TextReplacerOptions =
  | { mode: "single"; prefix: string; lines: string[]; autoDetect: boolean }
  | { mode: "two"; prefix: string; lines: string[]; splitChar: string; reversed: boolean; autoDetect: boolean }
  | { mode: "multi"; groups: { prefix: string; lines: string[] }[]; autoDetect: boolean }
  | { mode: "csv"; csvText: string; skipEmpty: boolean; autoDetect: boolean };

export interface TextReplacerEntry {
  label: string;
  processed: number;
  found: number;
}

export interface TextReplacerPrefixScanEntry {
  prefix: string;
  count: number;
  maxIndex: number;
}

function getAllLayers(parent: any): any[] {
  const layers: any[] = [];
  try {
    for (const lyr of Array.from<any>(parent.layers)) {
      try {
        layers.push(lyr);
        if (lyr.kind === "group" && lyr.layers) layers.push(...getAllLayers(lyr));
      } catch (_) {}
    }
  } catch (_) {}
  return layers;
}

export const scanTextReplacerPrefixes = async (): Promise<TextReplacerPrefixScanEntry[]> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument;
  } catch (_) {
    throw new Error("No active document found.");
  }

  const prefixes = new Map<string, { count: number; maxIndex: number }>();
  const numberedTextName = /^(.+?)(\d+)$/;

  for (const layer of getAllLayers(doc)) {
    try {
      if (layer.kind !== "text") continue;
      const name = String(layer.name ?? "");
      const match = name.match(numberedTextName);
      if (!match) continue;

      const prefix = match[1];
      const index = parseInt(match[2], 10);
      if (!prefix || !Number.isFinite(index)) continue;

      const current = prefixes.get(prefix) ?? { count: 0, maxIndex: 0 };
      current.count++;
      current.maxIndex = Math.max(current.maxIndex, index);
      prefixes.set(prefix, current);
    } catch (_) {}
  }

  return Array.from(prefixes.entries())
    .map(([prefix, info]) => ({ prefix, count: info.count, maxIndex: info.maxIndex }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const cloneDescriptor = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

async function selectLayerById(layerId: number): Promise<void> {
  const { batchPlay } = photoshop.action as any;
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: layerId }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

function resizeRangesToText(ranges: any[] | undefined, key: string, newText: string): any[] {
  const source = Array.isArray(ranges) && ranges.length ? ranges : [];
  const end = Math.max(1, newText.length + 1);
  const first = source[0]?.[key];
  if (!first) return [];

  if (source.length === 1) {
    return [{ from: 0, to: end, [key]: cloneDescriptor(first) }];
  }

  const next: any[] = [];
  for (let i = 0; i < source.length; i++) {
    const style = source[i]?.[key];
    if (!style) continue;
    const from = Math.max(0, Math.min(end, Number(source[i].from ?? 0)));
    const originalTo = i === source.length - 1 ? end : Number(source[i].to ?? end);
    const to = Math.max(from, Math.min(end, originalTo));
    if (to > from || (next.length === 0 && end === 1)) {
      next.push({ from, to, [key]: cloneDescriptor(style) });
    }
  }

  if (!next.length) return [{ from: 0, to: end, [key]: cloneDescriptor(first) }];
  next[0].from = 0;
  next[next.length - 1].to = end;
  return next;
}

export async function setTextLayerContents(layer: any, value: string): Promise<void> {
  const { batchPlay } = photoshop.action as any;
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

  const to: any = {
    _obj: "textLayer",
    textKey: value,
  };
  if (textStyleRange.length) to.textStyleRange = textStyleRange;
  if (paragraphStyleRange.length) to.paragraphStyleRange = paragraphStyleRange;

  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
    to,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function replaceTextLayers(
  doc: any,
  prefix: string,
  items: string[],
  autoDetect: boolean,
  skipEmpty: boolean
): Promise<{ processed: number; found: number }> {
  const layers = getAllLayers(doc);
  const layerMap: Record<number, any> = {};
  const pattern = new RegExp("^" + escapeRegex(prefix) + "(\\d+)$");
  let maxIndex = 0;

  for (const lyr of layers) {
    try {
      if (lyr.kind === "text") {
        const m = lyr.name.match(pattern);
        if (m) {
          const n = parseInt(m[1], 10);
          layerMap[n] = lyr;
          if (n > maxIndex) maxIndex = n;
        }
      }
    } catch (_) {}
  }

  const found = Object.keys(layerMap).length;
  const limit = autoDetect ? maxIndex : items.length;
  let processed = 0;

  for (let i = 1; i <= limit; i++) {
    if (layerMap[i] && i - 1 < items.length) {
      const val = items[i - 1];
      if (skipEmpty && val === "") continue;
      try {
        await setTextLayerContents(layerMap[i], val);
        processed++;
      } catch (_) {}
    }
  }

  return { processed, found };
}

function parseCSV(csvText: string): { columns: string[]; data: Record<string, string[]> } {
  const lines = csvText.split(/\r\n|\r|\n/).filter(l => l.trim());
  if (!lines.length) return { columns: [], data: {} };

  function parseLine(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
          else inQuotes = false;
        } else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { cells.push(current.trim()); current = ""; }
        else current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  const columns = parseLine(lines[0]);
  const data: Record<string, string[]> = {};
  for (const col of columns) data[col] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    for (let c = 0; c < columns.length; c++) {
      data[columns[c]].push(c < cells.length ? cells[c] : "");
    }
  }

  return { columns, data };
}

export const runTextReplacer = async (
  options: TextReplacerOptions
): Promise<TextReplacerEntry[]> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument;
  } catch (e) {
    throw new Error("No active document found.");
  }

  const results: TextReplacerEntry[] = [];

  await withHistory(doc, "Text Replacer", async () => {
    if (options.mode === "single") {
      const r = await replaceTextLayers(doc, options.prefix, options.lines, options.autoDetect, false);
      results.push({ label: `${options.prefix}N`, processed: r.processed, found: r.found });

    } else if (options.mode === "two") {
      const merged = options.lines.map(val => {
        const pos = val.indexOf(options.splitChar);
        let p1 = pos === -1 ? val : val.substring(0, pos).trim();
        let p2 = pos === -1 ? "" : val.substring(pos + options.splitChar.length).trim();
        if (options.reversed) [p1, p2] = [p2, p1];
        return p2 ? `${p1}\r${p2}` : p1;
      });
      const r = await replaceTextLayers(doc, options.prefix, merged, options.autoDetect, false);
      results.push({ label: `${options.prefix}N`, processed: r.processed, found: r.found });

    } else if (options.mode === "multi") {
      for (const group of options.groups) {
        if (!group.lines.length) continue;
        const r = await replaceTextLayers(doc, group.prefix, group.lines, options.autoDetect, false);
        results.push({ label: `${group.prefix}N`, processed: r.processed, found: r.found });
      }

    } else {
      const { columns, data } = parseCSV(options.csvText);
      for (const col of columns) {
        const items = data[col];
        if (!items?.length) continue;
        const r = await replaceTextLayers(doc, col, items, options.autoDetect, options.skipEmpty);
        results.push({ label: `${col}N`, processed: r.processed, found: r.found });
      }
    }
  });

  return results;
};
