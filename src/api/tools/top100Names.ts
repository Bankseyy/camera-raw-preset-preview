import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

const NAME_LAYER_NAMES = ["names_col_1", "names_col_2", "names_col_3"];
const FORCE_SPLIT: number[] = [];

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function splitCounts(count: number, columns: number): number[] {
  if (FORCE_SPLIT.length === columns && sum(FORCE_SPLIT) >= count) {
    return [...FORCE_SPLIT];
  }

  if (count === 100 && columns === 3) return [33, 34, 33];

  const base = Math.floor(count / columns);
  const remainder = count % columns;
  return Array.from({ length: columns }, (_, index) => base + (index < remainder ? 1 : 0));
}

function parseNames(raw: string): string[] {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(name => name.trim())
    .filter(Boolean);
}

function findTextLayerByName(parent: any, name: string): any | null {
  const target = name.toLowerCase();
  try {
    for (const layer of Array.from<any>(parent.layers)) {
      try {
        if (layer.kind === "text" && String(layer.name ?? "").toLowerCase() === target) {
          return layer;
        }
        if (layer.kind === "group" && layer.layers) {
          const found = findTextLayerByName(layer, name);
          if (found) return found;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

export const runTop100Names = async (rawNames: string): Promise<string> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("Open your template document first.");
  }

  const names = parseNames(rawNames);
  if (!names.length) return "No names were pasted.";

  const counts = splitCounts(names.length, NAME_LAYER_NAMES.length);
  let index = 0;

  await withHistory(doc, "Update Top 100 Names", async () => {
    for (let column = 0; column < NAME_LAYER_NAMES.length; column++) {
      const layerName = NAME_LAYER_NAMES[column];
      const layer = findTextLayerByName(doc, layerName);
      if (!layer) throw new Error(`Missing names layer "${layerName}".`);

      const take = counts[column];
      const lines = names.slice(index, index + take);
      layer.textItem.contents = lines.join("\r");
      try {
        layer.textItem.paragraphStyle.justification = photoshop.constants.Justification.LEFT;
      } catch (_) {
        try { layer.textItem.justification = photoshop.constants.Justification.LEFT; } catch (_) {}
      }
      index += take;
    }
  });

  return `Done. Updated ${names.length} names across ${NAME_LAYER_NAMES.length} columns (${counts.join("/")}).`;
};
