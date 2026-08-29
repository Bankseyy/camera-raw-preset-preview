import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export interface TweetFillerOptions {
  displayName: string;
  handle: string;
  tweetBody: string;
  showVerifiedBadge: boolean;
  badgeGap: number;
  badgeOffY: number;
  bodyToRT: number;
  rtToEdge: number;
  avatarToken?: string;
}

export interface TweetFillerBatchItem extends TweetFillerOptions {
  outputName?: string;
}

export interface TweetFillerBatchOptions {
  tweets: TweetFillerBatchItem[];
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function normalizeBreaks(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r");
}

function safeLayerName(value: string): string {
  const cleaned = String(value || "tweet")
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || "tweet";
}

async function setText(layerName: string, text: string): Promise<void> {
  const infoBefore = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _name: layerName }],
    _options: { dialogOptions: "dontDisplay" },
  }]);
  const existingTextKey = infoBefore[0].textKey;
  const newLength = text.length + 1;
  const updatedStyleRange = existingTextKey.textStyleRange.map((r: any) => {
    const updated = Object.assign({}, r);
    updated.to = newLength;
    return updated;
  });
  const updatedParaRange = existingTextKey.paragraphStyleRange.map((r: any) => {
    const updated = Object.assign({}, r);
    updated.to = newLength;
    return updated;
  });
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _name: layerName }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }]);
  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
    to: {
      _obj: "textLayer",
      textKey: text,
      textStyleRange: updatedStyleRange,
      paragraphStyleRange: updatedParaRange,
    },
    _options: { dialogOptions: "dontDisplay" },
  }]);
}

async function moveLayer(layerName: string, dy: number): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _name: layerName }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }]);
  await batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: 0 },
      vertical: { _unit: "pixelsUnit", _value: dy },
    },
    linked: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
    _options: { dialogOptions: "dontDisplay" },
  }]);
}

async function resizeRectangleToBottom(layerName: string, newBottom: number): Promise<void> {
  const info = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _name: layerName }],
    _options: { dialogOptions: "dontDisplay" },
  }], { synchronousExecution: true });

  const bne = info[0].boundsNoEffects;
  const topBefore = bne.top._value as number;
  const currentHeight = (bne.bottom._value as number) - topBefore;
  const newHeight = newBottom - topBefore;
  if (currentHeight <= 0 || newHeight <= 0) return;
  if (Math.abs(newHeight - currentHeight) < 1) return;

  const heightPercent = (newHeight / currentHeight) * 100;
  const anticipatedDrift = (newHeight - currentHeight) * 0.5;

  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _name: layerName }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], { synchronousExecution: true });

  await batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "path", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: 0 },
      vertical: { _unit: "pixelsUnit", _value: anticipatedDrift },
    },
    height: { _unit: "percentUnit", _value: heightPercent },
    linked: false,
    _options: { dialogOptions: "dontDisplay" },
  }], { synchronousExecution: true });
}

async function moveBadgeAfterName(badgeGap: number, badgeOffY: number): Promise<void> {
  const nameInfo = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _name: "DisplayName" }],
    _options: { dialogOptions: "dontDisplay" },
  }]);
  const badgeInfo = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _name: "VerifiedBadge" }],
    _options: { dialogOptions: "dontDisplay" },
  }]);
  const nameRight = nameInfo[0].bounds.right._value as number;
  const nameTop = nameInfo[0].bounds.top._value as number;
  const nameBottom = nameInfo[0].bounds.bottom._value as number;
  const badgeLeft = badgeInfo[0].bounds.left._value as number;
  const badgeTop = badgeInfo[0].bounds.top._value as number;
  const badgeBottom = badgeInfo[0].bounds.bottom._value as number;
  const deltaX = nameRight + badgeGap - badgeLeft;
  const deltaY = (nameTop + nameBottom) / 2 - (badgeTop + badgeBottom) / 2 + badgeOffY;
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _name: "VerifiedBadge" }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }]);
  await batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: deltaX },
      vertical: { _unit: "pixelsUnit", _value: deltaY },
    },
    linked: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
    _options: { dialogOptions: "dontDisplay" },
  }]);
}

async function replaceAvatar(token: string): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _name: "Avatar" }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }]);
  await batchPlay([{
    _obj: "placedLayerReplaceContents",
    null: { _path: token, _kind: "local" },
    _options: { dialogOptions: "dontDisplay" },
  }]);
}

async function renameActiveLayer(name: string): Promise<void> {
  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "layer", name },
    _options: { dialogOptions: "dontDisplay" },
  }]);
}

async function moveActiveLayerToTop(): Promise<void> {
  const doc = photoshop.app.activeDocument as any;
  const activeLayer = Array.from<any>(doc.activeLayers ?? [])[0] ?? doc.activeLayer;
  const topLayer = Array.from<any>(doc.layers ?? [])[0];
  const activeId = Number(activeLayer?.id ?? 0);
  const topId = Number(topLayer?.id ?? 0);

  if (!activeId || !topId || activeId === topId) return;

  try {
    activeLayer.move(topLayer, photoshop.constants.ElementPlacement.PLACEBEFORE);
    return;
  } catch (_) {}

  try {
    await batchPlay([{
      _obj: "move",
      _target: [{ _ref: "layer", _id: activeId }],
      to: { _ref: "layer", _id: topId },
      adjustment: false,
      version: 5,
      layerID: [activeId],
      _options: { dialogOptions: "dontDisplay" },
    }]);
    return;
  } catch (_) {}

  try {
    await batchPlay([{
      _obj: "move",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      to: { _ref: "layer", _enum: "ordinal", _value: "front" },
      _options: { dialogOptions: "dontDisplay" },
    }]);
  } catch (_) {}
}
async function hideActiveLayer(): Promise<void> {
  await batchPlay([{
    _obj: "hide",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }]);
}

async function stampVisibleHidden(name: string): Promise<void> {
  await batchPlay([{
    _obj: "mergeVisible",
    duplicate: true,
    _options: { dialogOptions: "dontDisplay" },
  }]);
  await renameActiveLayer(name);
  await moveActiveLayerToTop();
  await hideActiveLayer();
}

async function fillTweetTemplate(options: TweetFillerOptions, warnings: string[]): Promise<void> {
  try { await setText("DisplayName", options.displayName); } catch (e: any) { warnings.push("DisplayName: " + e.message); }
  try { await setText("Handle", options.handle); } catch (e: any) { warnings.push("Handle: " + e.message); }
  try { await setText("TweetBody", normalizeBreaks(options.tweetBody)); } catch (e: any) { warnings.push("TweetBody: " + e.message); }

  try {
    await batchPlay([{
      _obj: options.showVerifiedBadge ? "show" : "hide",
      _target: [{ _ref: "layer", _name: "VerifiedBadge" }],
      _options: { dialogOptions: "dontDisplay" },
    }]);
  } catch (e: any) { warnings.push("Badge visibility: " + e.message); }

  if (options.showVerifiedBadge) {
    try { await moveBadgeAfterName(options.badgeGap, options.badgeOffY); } catch (e: any) { warnings.push("Badge move: " + e.message); }
  }

  if (options.avatarToken) {
    try { await replaceAvatar(options.avatarToken); } catch (e: any) { warnings.push("Avatar: " + e.message); }
  }

  try {
    const doc = photoshop.app.activeDocument;
    const dpi = (doc as any).resolution as number;
    const pointsToPixels = dpi / 72;

    const bodyInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _name: "TweetBody" }],
      _options: { dialogOptions: "dontDisplay" },
    }]);
    const layerTop = bodyInfo[0].bounds.top._value as number;
    const bbBottom = bodyInfo[0].textKey.boundingBox.bottom._value as number;
    const trueTextBottom = layerTop + (bbBottom * pointsToPixels);

    const rtInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _name: "RT symbols" }],
      _options: { dialogOptions: "dontDisplay" },
    }]);
    const rtTop = rtInfo[0].bounds.top._value as number;
    const rtDelta = (trueTextBottom + options.bodyToRT) - rtTop;
    await moveLayer("RT symbols", rtDelta);

    const rtAfterInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _name: "RT symbols" }],
      _options: { dialogOptions: "dontDisplay" },
    }]);
    const newCardBottom = (rtAfterInfo[0].bounds.bottom._value as number) + options.rtToEdge;
    await resizeRectangleToBottom("Rectangle 1 copy", newCardBottom);
  } catch (e: any) {
    warnings.push("Layout: " + e.message);
  }
}

export const runTweetFiller = async (options: TweetFillerOptions): Promise<string> => {
  const warnings: string[] = [];
  try {
    const doc = photoshop.app.activeDocument as any;
    await withHistory(doc, "Tweet Filler", async () => {
      await fillTweetTemplate(options, warnings);
      const outputName = options.outputName || `tweet_1_${safeLayerName(options.handle || options.displayName)}`;
      await stampVisibleHidden(outputName);
    });
  } catch (e: any) {
    return "MODAL ERROR: " + e.message;
  }
  return "Done. Created 1 hidden tweet layer." + (warnings.length ? "\n" + warnings.join("\n") : "");
};

export const runTweetFillerBatch = async (options: TweetFillerBatchOptions): Promise<string> => {
  const tweets = (options.tweets ?? []).filter(tweet => String(tweet.tweetBody ?? "").trim());
  if (!tweets.length) throw new Error("Paste at least one tweet.");

  const warnings: string[] = [];
  let created = 0;
  try {
    const doc = photoshop.app.activeDocument as any;
    await withHistory(doc, "Tweet Filler Batch", async () => {
      for (let i = 0; i < tweets.length; i++) {
        const tweet = tweets[i];
        const itemWarnings: string[] = [];
        await fillTweetTemplate(tweet, itemWarnings);
        warnings.push(...itemWarnings.map(message => `tweet_${i + 1}: ${message}`));
        const baseName = tweet.outputName || `tweet_${i + 1}_${safeLayerName(tweet.handle || tweet.displayName)}`;
        await stampVisibleHidden(baseName);
        created++;
      }
    });
  } catch (e: any) {
    return "MODAL ERROR: " + e.message;
  }

  return `Done. Created ${created} hidden tweet layer${created === 1 ? "" : "s"}.` + (warnings.length ? "\n" + warnings.join("\n") : "");
};
