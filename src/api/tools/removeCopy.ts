import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

// Include groups — the original renames them too
function collectAllLayersAndGroups(parent: any, out: any[]): void {
  try {
    for (const lyr of Array.from<any>(parent.layers)) {
      try {
        out.push(lyr);
        if (lyr.kind === "group") collectAllLayersAndGroups(lyr, out);
      } catch (_) {}
    }
  } catch (_) {}
}

function stripCopy(name: string): string {
  let out = name;
  out = out.replace(/\s+copy(\s*\d+)?\s*$/gi, "");
  out = out.replace(/\s*copy(\s*\d+)?\b/gi, "");
  out = out.replace(/\s{2,}/g, " ").replace(/^\s+|\s+$/g, "");
  return out || "Layer";
}

export const runRemoveCopy = async (): Promise<string> => {
  let changed = 0;
  let failed  = 0;
  const doc = photoshop.app.activeDocument as any;

  await withHistory(doc, "Remove Copy", async () => {
    const allLayers: any[] = [];
    collectAllLayersAndGroups(doc, allLayers);

    for (const lyr of allLayers) {
      try {
        const oldName = lyr.name as string;
        const newName = stripCopy(oldName);
        if (newName === oldName) continue;

        await batchPlay([{
          _obj: "set",
          _target: [{ _ref: "layer", _id: lyr.id as number }],
          to: { _obj: "layer", name: newName },
          _options: { dialogOptions: "dontDisplay" },
        }]);
        changed++;
      } catch (_) {
        failed++;
      }
    }
  });

  return `Updated: ${changed}${failed ? `  Failed: ${failed}` : ""}`;
};
