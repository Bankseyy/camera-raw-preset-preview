import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export const runNumbering = async (
  prefix: string,
  amount: number
): Promise<{ updated: number; missing: string[] }> => {
  let doc: ReturnType<typeof photoshop.app.activeDocument>;
  try {
    doc = photoshop.app.activeDocument;
  } catch (e) {
    throw new Error("No active document found.");
  }

  function getAllTextLayers(layers: any[]): any[] {
    const result: any[] = [];
    for (const lyr of layers) {
      try {
        if (lyr.kind === "text") {
          result.push(lyr);
        } else if (lyr.kind === "group" && lyr.layers) {
          result.push(...getAllTextLayers(Array.from(lyr.layers)));
        }
      } catch (_) {}
    }
    return result;
  }

  const allText = getAllTextLayers(Array.from(doc.layers));
  const map: Record<string, any> = {};
  for (const lyr of allText) {
    try { map[lyr.name.toUpperCase()] = lyr; } catch (_) {}
  }

  let updated = 0;
  const missing: string[] = [];

  await withHistory(doc, "Numbering Script", async () => {
    for (let n = 1; n <= amount; n++) {
      const key = (prefix + n).toUpperCase();
      if (map[key]) {
        try {
          map[key].textItem.contents = String(n);
          updated++;
        } catch (e: any) {
          missing.push(`${prefix}${n} (error: ${e.message})`);
        }
      } else {
        missing.push(prefix + n);
      }
    }
  });

  return { updated, missing };
};
