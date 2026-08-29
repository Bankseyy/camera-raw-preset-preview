import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

// ── Max text_N index detection (DOM, no asModal needed) ───────────────────────

function detectMaxTextIndex(parent: any): number {
  let maxIdx = 0;
  try {
    for (const lyr of Array.from<any>(parent.layers)) {
      try {
        if (lyr.kind === "group" && lyr.layers) {
          const sub = detectMaxTextIndex(lyr);
          if (sub > maxIdx) maxIdx = sub;
        } else {
          const m = /^text_(\d+)$/.exec(lyr.name || "");
          if (m) {
            const idx = parseInt(m[1], 10);
            if (idx > maxIdx) maxIdx = idx;
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return maxIdx;
}

// ── Word-range computation (pure logic, ported from JSX) ─────────────────────

interface WordSeg { from: number; to: number; excl: boolean; }
interface WordRange { from: number; to: number; isFirst: boolean; }

function applySegs(
  segs: WordSeg[],
  totalNonExcl: number,
  singleWordAsSecond: boolean,
  out: WordRange[]
): void {
  let seen = 0;
  const entries: WordRange[] = [];
  for (const s of segs) {
    if (s.excl) {
      entries.push({ from: s.from, to: s.to, isFirst: true });
    } else {
      seen++;
      const isFirst = (seen === 1) ? !(singleWordAsSecond && totalNonExcl === 1) : false;
      entries.push({ from: s.from, to: s.to, isFirst });
    }
  }
  entries.sort((a, b) => a.from - b.from);
  for (const e of entries) out.push(e);
}

// Scan a text slice into raw word segments + non-excluded count, without applying style logic
function collectSegs(
  text: string,
  lineStart: number,
  lineEnd: number,
  lineBrSep: boolean,
  exSir: boolean,
  threeWord: boolean,
): { segs: WordSeg[]; count: number } {
  const segs: WordSeg[] = [];
  let inWord = false, wordStart = -1, count = 0;
  const maxCount = threeWord ? 9999 : 2;

  for (let j = lineStart; j <= lineEnd; j++) {
    const c = j < lineEnd ? text.charAt(j) : " ";
    const isSep = c === " " || c === "\t" || (lineBrSep && (c === "\r" || c === "\n" || c === "\x03"));
    if (isSep) {
      if (inWord) {
        const tok = text.substring(wordStart, j);
        const excl = exSir && tok.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase() === "sir";
        segs.push({ from: wordStart, to: j, excl });
        if (!excl) { count++; if (count >= maxCount) break; }
        inWord = false;
      }
    } else {
      if (!inWord) { inWord = true; wordStart = j; }
    }
  }
  return { segs, count };
}

function scanLine(
  text: string,
  lineStart: number,
  lineEnd: number,
  lineBrSep: boolean,
  singleWordAsSecond: boolean,
  exSir: boolean,
  threeWord: boolean,
  out: WordRange[]
): void {
  const { segs, count } = collectSegs(text, lineStart, lineEnd, lineBrSep, exSir, threeWord);
  if (segs.length > 0) applySegs(segs, count, singleWordAsSecond, out);
}

function computeWordRanges(
  text: string,
  perLine: boolean,
  singleWordAsSecond: boolean,
  exSir: boolean,
  threeWord: boolean
): WordRange[] {
  const out: WordRange[] = [];
  if (perLine) {
    let p = 0;
    let lineIndex = 0;
    while (p <= text.length) {
      const ls = p;
      while (p < text.length && text.charAt(p) !== "\r" && text.charAt(p) !== "\n" && text.charAt(p) !== "\x03") p++;
      if (p > ls) {
        const { segs } = collectSegs(text, ls, p, false, exSir, true);
        if (segs.length > 0) {
          const isFirst = lineIndex === 0;
          for (const s of segs) {
            out.push({ from: s.from, to: s.to, isFirst: s.excl ? true : isFirst });
          }
        }
      }
      if (p < text.length) {
        const br = text.charAt(p); p++;
        if (br === "\r" && p < text.length && text.charAt(p) === "\n") p++;
      } else { p++; }
      lineIndex++;
    }
  } else {
    scanLine(text, 0, text.length, true, singleWordAsSecond, exSir, threeWord, out);
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

// ── Exported API ─────────────────────────────────────────────────────────────

export interface FontWeightInit {
  maxIndex: number;
}

export const initFontWeightStyler = async (): Promise<FontWeightInit> => {
  const t0       = Date.now();
  const maxIndex = detectMaxTextIndex((photoshop.app as any).activeDocument);
  console.log(`[FontWeight] detectMaxTextIndex took ${Date.now() - t0}ms → maxIndex=${maxIndex}`);
  return { maxIndex };
};

export interface StyleLayerOptions {
  firstFont:          string;
  firstStyle:         string;
  secondFont:         string;
  secondStyle:        string;
  perLine:            boolean;
  singleWordAsSecond: boolean;
  exSir:              boolean;
  threeWord:          boolean;
  leadingOverridePt:  number | null;
}

async function styleOneLayerInCurrentDocument(
  layerName: string,
  opts: StyleLayerOptions,
): Promise<boolean> {
  console.log(`[FontWeight] styleOneLayer START — layer="${layerName}"`);

  try {
      // Select by name
      await batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _name: layerName }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      }], {});
      console.log(`[FontWeight] ${layerName} — selected OK`);

      // Get layer descriptor
      const getResult = await batchPlay([{
        _obj: "get",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        _options: { dialogOptions: "dontDisplay" },
      }], {});

      // layerDesc.textKey is the text descriptor; its .textKey property is the text content string
      const layerDesc = getResult[0] as any;
      const tk = layerDesc?.textKey as any;
      if (!tk || !tk.textKey) {
        console.log(`[FontWeight] ${layerName} — not a text layer or empty text, skipping`);
        return false;
      }

      const textContent = tk.textKey as string;
      console.log(`[FontWeight] ${layerName} — textKey found, text="${textContent.slice(0, 60)}${textContent.length > 60 ? "…" : ""}"`);

      const tLen      = textContent.length + 1;
      const baseStyle = tk.textStyleRange?.[0]?.textStyle;
      if (!baseStyle) {
        console.log(`[FontWeight] ${layerName} — no textStyleRange[0].textStyle, skipping`);
        return false;
      }

      // Step 1 — capture original size before any change
      const orig      = baseStyle;
      const origSize: number = orig.size?._value ?? orig.size;

      // Compute word ranges
      const wordRanges = computeWordRanges(
        textContent, opts.perLine, opts.singleWordAsSecond, opts.exSir, opts.threeWord
      );
      console.log(`[FontWeight] ${layerName} — wordRanges: ${JSON.stringify(wordRanges.map(r => ({ from: r.from, to: r.to, isFirst: r.isFirst })))}`);
      if (wordRanges.length === 0) {
        console.log(`[FontWeight] ${layerName} — no word ranges computed, skipping`);
        return false;
      }

      // Helper — builds ranges for a given word-range list
      const buildRanges = (includeSize: boolean, sizePt: number, factor: number): any[] => {
        const ranges: any[] = [];
        let cur = 0;
        const hasOverride = opts.leadingOverridePt !== null && opts.leadingOverridePt > 0;
        const add = (from: number, to: number, isFirst: boolean): void => {
          const style: any = {
            _obj:          "textStyle",
            fontName:      isFirst ? opts.firstFont  : opts.secondFont,
            fontStyleName: isFirst ? opts.firstStyle : opts.secondStyle,
            // Fix 2: always carry tracking and autoKern (em-relative, no factor correction)
            tracking:      orig.tracking,
            autoKern:      orig.autoKern,
          };

          // Fix 1: leading — always carry autoLeading; conditionally carry leading
          if (hasOverride) {
            // user override takes precedence; factor-correct in step 5 (it's a display-scale pt value, same as origSize)
            style.autoLeading = false;
            if (includeSize) {
              style.leading = { _unit: "pointsUnit", _value: opts.leadingOverridePt! * factor };
            }
          } else {
            style.autoLeading = orig.autoLeading;
            if (orig.autoLeading === false) {
              // manual leading — factor-correct in step 5, carry raw in step 2
              style.leading = includeSize
                ? { _unit: "pointsUnit", _value: orig.leading._value * factor }
                : orig.leading;
            }
          }

          if (includeSize) {
            style.size            = { _unit: "pointsUnit", _value: sizePt };
            style.color           = orig.color;
            style.horizontalScale = orig.horizontalScale;
            style.verticalScale   = orig.verticalScale;
            style.fontCaps        = orig.fontCaps;
          }

          ranges.push({ from, to, textStyle: style });
        };
        for (const wr of wordRanges) {
          if (wr.from > cur) add(cur, wr.from, true);
          add(wr.from, wr.to, wr.isFirst);
          cur = wr.to;
        }
        if (cur < tLen) add(cur, tLen, true);
        return ranges;
      };

      // Step 2 — push font-only (no size) so PS normalises the size
      const step2Ranges = buildRanges(false, 0, 1);
      console.log(`[FontWeight] ${layerName} — step 2: pushing ${step2Ranges.length} font-only ranges`);
      await batchPlay([{
        _obj: "set",
        _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "textLayer",
          textKey: textContent,
          textStyleRange: step2Ranges,
          paragraphStyleRange: tk.paragraphStyleRange,
        },
        _options: { dialogOptions: "dontDisplay" },
      }], {});

      // Step 3 — re-read normalised size
      const reRead = await batchPlay([{
        _obj: "get",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        _options: { dialogOptions: "dontDisplay" },
      }], {});
      const postStep2Size: number = reRead[0]?.textKey?.textStyleRange?.[0]?.textStyle?.size?._value ?? 12;
      console.log(`[FontWeight] ${layerName} — origSize: ${origSize}, postStep2Size: ${postStep2Size}`);

      // Step 4 — compute correction factor
      const factor      = 12 / postStep2Size;
      const correctSize = origSize * factor;
      console.log(`[FontWeight] ${layerName} — factor: ${factor}, correctSize: ${correctSize}`);

      // Step 5 — push full style with corrected size
      const step5Ranges = buildRanges(true, correctSize, factor);
      console.log(`[FontWeight] ${layerName} — step 5: pushing ${step5Ranges.length} ranges`);
      console.log(`[FontWeight] ${layerName} — step 5 fonts:`, step5Ranges.map((r: any) => ({ from: r.from, to: r.to, font: r.textStyle.fontName + '/' + r.textStyle.fontStyleName })));
      await batchPlay([{
        _obj: "set",
        _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "textLayer",
          textKey: textContent,
          textStyleRange: step5Ranges,
          paragraphStyleRange: tk.paragraphStyleRange,
        },
        _options: { dialogOptions: "dontDisplay" },
      }], {});

      console.log(`[FontWeight] ${layerName} — done, returning true`);
      return true;
    } catch (e: any) {
      console.log(`[FontWeight] ${layerName} — ERROR: ${e?.message ?? String(e)}`);
      return false;
    }
}

export const styleOneLayer = async (
  layerName: string,
  opts: StyleLayerOptions,
): Promise<boolean> => {
  const doc = photoshop.app.activeDocument as any;
  let result = false;
  await withHistory(doc, "Font Weight Styler", async () => {
    result = await styleOneLayerInCurrentDocument(layerName, opts);
  });
  return result;
};

export const styleFontWeightLayers = async (
  layerNames: string[],
  opts: StyleLayerOptions,
): Promise<number> => {
  const doc = photoshop.app.activeDocument as any;
  let processed = 0;
  await withHistory(doc, "Font Weight Styler", async () => {
    for (const layerName of layerNames) {
      if (await styleOneLayerInCurrentDocument(layerName, opts)) processed++;
    }
  });
  return processed;
};
