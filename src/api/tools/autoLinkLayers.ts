import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export interface AutoLinkLayersOptions {
  patterns: string;
  includeHidden: boolean;
  includeGroups: boolean;
  caseSensitive: boolean;
  unlinkFirst: boolean;
}

export interface AutoLinkLayersEntry {
  pattern: string;
  matched: number;
  linked: number;
  error?: string;
}

function collectAllLayers(parent: any, includeHidden: boolean, includeGroups: boolean, out: any[]): void {
  try {
    for (const lyr of Array.from<any>(parent.layers)) {
      try {
        if (lyr.kind === "group") {
          collectAllLayers(lyr, includeHidden, includeGroups, out);
          if (includeGroups && (includeHidden || lyr.visible)) out.push(lyr);
        } else {
          if (lyr.isBackgroundLayer) continue;
          if (!includeHidden && !lyr.visible) continue;
          out.push(lyr);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

export const runAutoLinkLayers = async (options: AutoLinkLayersOptions): Promise<AutoLinkLayersEntry[]> => {
  const doc = photoshop.app.activeDocument;

  const allLayers: any[] = [];
  collectAllLayers(doc, options.includeHidden, options.includeGroups, allLayers);

  const patterns = options.patterns
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const results: AutoLinkLayersEntry[] = [];

  await withHistory(doc, "Auto Link Layers", async () => {
    for (const pat of patterns) {
      const patNorm = options.caseSensitive ? pat : pat.toLowerCase();

      const matches = allLayers.filter(lyr => {
        try {
          const nm = options.caseSensitive ? lyr.name as string : (lyr.name as string).toLowerCase();
          return nm.includes(patNorm);
        } catch (_) { return false; }
      });

      if (matches.length < 2) {
        results.push({ pattern: pat, matched: matches.length, linked: 0, error: "Need ≥ 2 matches to link" });
        continue;
      }

      try {
        // layer.unlink() / layer.link() are DOM write methods that work in UXP
        if (options.unlinkFirst) {
          for (const lyr of matches) {
            try { lyr.unlink(); } catch (_) {}
          }
        }

        const anchor = matches[0];
        for (let i = 1; i < matches.length; i++) {
          anchor.link(matches[i]);
        }

        results.push({ pattern: pat, matched: matches.length, linked: matches.length });
      } catch (e: any) {
        results.push({ pattern: pat, matched: matches.length, linked: 0, error: e.message });
      }
    }
  });

  return results;
};
