import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export type ShapeInserterShapeType = "rectangle" | "circle";
export type ShapeInserterTextPosition = "below" | "above";
export type ShapeInserterAntiAlias = "none" | "sharp" | "crisp" | "strong" | "smooth";
export type ShapeInserterArrowDirection = "right" | "left";
export type ShapeInserterArrowPreset = "small-arrow" | "chevron-arrow";
export type ShapeInserterArrowSource = "builtIn" | "custom";

export interface ShapeInserterOptions {
  shapeType: ShapeInserterShapeType;
  totalShapes: number;
  perRow?: number;
  rows: number;
  matchHorizontalGap: boolean;
  rowGap: number;
  ensureTextRoom: boolean;
  addText: boolean;
  textPosition: ShapeInserterTextPosition;
  textOffset: number;
  textSize: number;
  textSizeInPixels: boolean;
  antiAlias: ShapeInserterAntiAlias;
  initialText: string;
  addHorizontalArrows: boolean;
  addVerticalArrows: boolean;
  oddRowDirection: ShapeInserterArrowDirection;
  evenRowDirection: ShapeInserterArrowDirection;
  arrowSource: ShapeInserterArrowSource;
  arrowPreset: ShapeInserterArrowPreset;
  customArrowToken?: string;
  arrowPadding: number;
  arrowScalePercent: number;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function getLayerBounds(layer: any) {
  const b = layer.bounds;
  if (Array.isArray(b)) {
    return {
      left: toNumber(b[0]),
      top: toNumber(b[1]),
      right: toNumber(b[2]),
      bottom: toNumber(b[3]),
    };
  }
  return {
    left: toNumber(b.left),
    top: toNumber(b.top),
    right: toNumber(b.right),
    bottom: toNumber(b.bottom),
  };
}

function getDocSize(doc: any) {
  return {
    width: toNumber(doc.width),
    height: toNumber(doc.height),
  };
}

function getAllLayerNames(parent: any): Set<string> {
  const names = new Set<string>();
  function walk(node: any): void {
    try {
      for (const layer of Array.from<any>(node.layers)) {
        names.add(String(layer.name ?? ""));
        if (layer.kind === "group" && layer.layers) walk(layer);
      }
    } catch (_) {}
  }
  walk(parent);
  return names;
}

function findLayerById(parent: any, id: number): any | null {
  try {
    for (const layer of Array.from<any>(parent.layers)) {
      if (layer.id === id) return layer;
      if (layer.kind === "group" && layer.layers) {
        const found = findLayerById(layer, id);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

async function getActiveLayerDom(): Promise<any> {
  const doc = photoshop.app.activeDocument as any;
  const activeLayers = Array.from<any>(doc.activeLayers ?? []);
  if (activeLayers[0]) return activeLayers[0];
  if (doc.activeLayer) return doc.activeLayer;

  try {
    const result = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    const id = result[0]?.layerID ?? result[0]?.layerId;
    if (typeof id === "number") {
      const layer = findLayerById(doc, id);
      if (layer) return layer;
    }
  } catch (_) {}

  throw new Error("Could not read the active Photoshop layer after creating it.");
}

function uniqueName(doc: any, baseName: string): string {
  const names = getAllLayerNames(doc);
  let name = baseName;
  let index = 2;
  while (names.has(name)) {
    name = `${baseName} (${index})`;
    index++;
  }
  return name;
}

function textSizeToPixels(value: number, inPixels: boolean, resolution: number): number {
  return inPixels ? value : value * (resolution / 72);
}

function antiAliasFromName(name: ShapeInserterAntiAlias) {
  const aa = photoshop.constants.AntiAlias;
  switch (name) {
    case "none": return aa.NONE;
    case "crisp": return aa.CRISP;
    case "strong": return aa.STRONG;
    case "smooth": return aa.SMOOTH;
    case "sharp":
    default: return aa.SHARP;
  }
}

async function makeShapeLayer(
  kind: "rectangle" | "ellipse",
  left: number,
  top: number,
  right: number,
  bottom: number
): Promise<any> {
  await batchPlay([{
    _obj: "make",
    _target: [{ _ref: "contentLayer" }],
    using: {
      _obj: "contentLayer",
      type: {
        _obj: "solidColorLayer",
        color: {
          _obj: "RGBColor",
          red: 200,
          grain: 200,
          blue: 200,
        },
      },
      shape: {
        _obj: kind,
        top: { _unit: "pixelsUnit", _value: top },
        left: { _unit: "pixelsUnit", _value: left },
        bottom: { _unit: "pixelsUnit", _value: bottom },
        right: { _unit: "pixelsUnit", _value: right },
      },
      shapeOperation: { _enum: "shapeOperation", _value: "add" },
    },
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  return getActiveLayerDom();
}

async function convertActiveLayerToSmartObject(): Promise<any> {
  await batchPlay([{
    _obj: "newPlacedLayer",
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  return getActiveLayerDom();
}

async function createTextPrecisely(params: {
  doc: any;
  group: any;
  index: number;
  shapeLeft: number;
  shapeRight: number;
  shapeTop: number;
  shapeBottom: number;
  offsetPx: number;
  sizePx: number;
  content: string;
  aaName: ShapeInserterAntiAlias;
  pos: ShapeInserterTextPosition;
}): Promise<any | null> {
  const centerX = Math.round((params.shapeLeft + params.shapeRight) / 2);
  const approxBaselineY = params.pos === "above"
    ? params.shapeTop - params.offsetPx
    : params.shapeBottom + params.offsetPx + params.sizePx * 0.75;

  const black = new (photoshop.app as any).SolidColor();
  black.rgb.red = 0;
  black.rgb.green = 0;
  black.rgb.blue = 0;

  const textLayer = await params.doc.createTextLayer({
    name: `text_${params.index}`,
    contents: params.content,
    fontSize: params.sizePx,
    position: { x: centerX, y: Math.round(approxBaselineY) },
    textColor: black,
  });
  if (!textLayer) return null;

  try {
    textLayer.textItem.paragraphStyle.justification = photoshop.constants.Justification.CENTER;
    textLayer.textItem.characterStyle.antiAliasMethod = antiAliasFromName(params.aaName);
  } catch (_) {}

  const bounds = getLayerBounds(textLayer);
  const dx = Math.round(centerX - (bounds.left + bounds.right) / 2);
  const dy = params.pos === "above"
    ? Math.round((params.shapeTop - params.offsetPx) - bounds.bottom)
    : Math.round((params.shapeBottom + params.offsetPx) - bounds.top);
  await textLayer.translate(dx, dy);

  try {
    textLayer.move(params.group, photoshop.constants.ElementPlacement.PLACEINSIDE);
  } catch (_) {}
  return textLayer;
}

async function getPluginEntry(relativePath: string): Promise<any> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  let entry = await fs.getPluginFolder();
  for (const part of relativePath.split(/[\\/]+/).filter(Boolean)) {
    entry = await entry.getEntry(part);
  }
  return entry;
}

async function getArrowEntry(options: ShapeInserterOptions): Promise<any | null> {
  if (!options.addHorizontalArrows && !options.addVerticalArrows) return null;

  const { localFileSystem: fs } = (require("uxp") as any).storage;
  if (options.arrowSource === "custom") {
    if (!options.customArrowToken) throw new Error("Select a custom arrow image first.");
    return fs.getEntryForSessionToken(options.customArrowToken);
  }

  return getPluginEntry(`shape-inserter/arrows/${options.arrowPreset}.png`);
}

async function placeArrow(
  arrowEntry: any,
  targetW: number,
  targetH: number,
  centerX: number,
  centerY: number,
  dir: "right" | "left" | "down",
  name: string,
  arrowsGroup: any
): Promise<any | null> {
  if (targetW < 2 || targetH < 2) return null;

  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const token = fs.createSessionToken(arrowEntry);

  await batchPlay([{
    _obj: "placeEvent",
    null: { _path: token, _kind: "local" },
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  let layer = await getActiveLayerDom();
  try {
    await convertActiveLayerToSmartObject();
    layer = await getActiveLayerDom();
  } catch (_) {}

  if (dir === "left") {
    await layer.rotate(180, photoshop.constants.AnchorPosition.MIDDLECENTER);
  } else if (dir === "down") {
    await layer.rotate(90, photoshop.constants.AnchorPosition.MIDDLECENTER);
  }

  const initialBounds = getLayerBounds(layer);
  const currentW = Math.max(1, initialBounds.right - initialBounds.left);
  const currentH = Math.max(1, initialBounds.bottom - initialBounds.top);
  const scalePercent = Math.min((targetW / currentW) * 100, (targetH / currentH) * 100);
  await layer.scale(scalePercent, scalePercent, photoshop.constants.AnchorPosition.MIDDLECENTER);

  const finalBounds = getLayerBounds(layer);
  const currentCX = (finalBounds.left + finalBounds.right) / 2;
  const currentCY = (finalBounds.top + finalBounds.bottom) / 2;
  await layer.translate(Math.round(centerX - currentCX), Math.round(centerY - currentCY));

  layer.name = name;
  try {
    layer.move(arrowsGroup, photoshop.constants.ElementPlacement.PLACEINSIDE);
  } catch (_) {}
  return layer;
}

async function createLayerGroup(doc: any, baseName: string): Promise<any> {
  const group = await doc.createLayerGroup({ name: uniqueName(doc, baseName) });
  if (!group) throw new Error(`Could not create ${baseName} group.`);
  return group;
}

export const runShapeInserter = async (input: ShapeInserterOptions): Promise<string> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("Open a document first.");
  }

  const options = {
    ...input,
    totalShapes: clampInt(input.totalShapes, 1, 10000),
    rows: clampInt(input.rows, 1, 10000),
    rowGap: Math.max(0, Number(input.rowGap) || 0),
    textOffset: Math.max(0, Number(input.textOffset) || 12),
    textSize: Math.max(1, Number(input.textSize) || 24),
    arrowPadding: Math.max(0, Number(input.arrowPadding) || 0),
    arrowScalePercent: Math.min(100, Math.max(1, Number(input.arrowScalePercent) || 100)),
  };
  options.perRow = input.perRow
    ? clampInt(input.perRow, 1, 10000)
    : Math.ceil(options.totalShapes / options.rows);
  if (options.perRow * options.rows < options.totalShapes) {
    options.rows = Math.ceil(options.totalShapes / options.perRow);
  }

  const arrowEntry = await getArrowEntry(options);
  let shapesCreated = 0;
  let textCreated = 0;
  let arrowsCreated = 0;

  await withHistory(doc, "Insert Shapes Grid", async () => {
    doc = photoshop.app.activeDocument as any;
    const { width: W, height: H } = getDocSize(doc);
    const cellW = W / options.perRow;

    let gapForLayout: number;
    let sideMaxX: number;
    if (options.matchHorizontalGap) {
      const sideFromV = H - (options.rows - 1) * cellW;
      const sideFromH = 0.7 * cellW;
      const side0 = Math.max(1, Math.floor(Math.min(sideFromH, sideFromV)));
      gapForLayout = Math.max(0, cellW - side0);
      sideMaxX = 0.7 * cellW;
    } else {
      const customGap = Math.min(options.rowGap, Math.max(0, cellW - 1));
      gapForLayout = customGap;
      sideMaxX = Math.max(1, cellW - customGap);
    }

    if (options.ensureTextRoom && options.addText && options.textPosition === "below") {
      const textPx = textSizeToPixels(options.textSize, options.textSizeInPixels, doc.resolution || 72);
      gapForLayout = Math.max(gapForLayout, options.textOffset + textPx);
    }

    const sideMaxY = (H - (options.rows - 1) * gapForLayout) / options.rows;
    const side = Math.max(1, Math.floor(Math.min(sideMaxX, sideMaxY)));
    const hGap = cellW - side;
    const totalUsedH = options.rows * side + (options.rows - 1) * gapForLayout;
    const topMargin = Math.max(0, Math.floor((H - totalUsedH) / 2));

    const shapesGroup = await createLayerGroup(doc, "Shapes");
    let arrowsGroup: any = null;
    let textGroup: any = null;
    const shapeLayers: { index: number; layer: any }[] = [];
    const textLayers: { index: number; layer: any }[] = [];
    const arrowLayers: { index: number; layer: any }[] = [];
    const ensureArrowsGroup = async () => {
      if (!arrowsGroup) {
        arrowsGroup = await createLayerGroup(doc, "Arrows");
        try { arrowsGroup.move(shapesGroup, photoshop.constants.ElementPlacement.PLACEBEFORE); } catch (_) {}
        if (textGroup) {
          try { textGroup.move(arrowsGroup, photoshop.constants.ElementPlacement.PLACEBEFORE); } catch (_) {}
        }
      }
      return arrowsGroup;
    };
    const ensureTextGroup = async () => {
      if (!textGroup) {
        textGroup = await createLayerGroup(doc, "Text");
        try {
          textGroup.move(arrowsGroup || shapesGroup, photoshop.constants.ElementPlacement.PLACEBEFORE);
        } catch (_) {}
      }
      return textGroup;
    };

    const shapesInRow = (row: number) => {
      const remaining = options.totalShapes - row * options.perRow;
      if (remaining <= 0) return 0;
      return Math.min(options.perRow, remaining);
    };

    const rowDir = (rowOneBased: number) =>
      rowOneBased % 2 === 1 ? options.oddRowDirection : options.evenRowDirection;

    for (let r = 0; r < options.rows; r++) {
      const nInRow = shapesInRow(r);
      if (nInRow === 0) break;

      const rowTop = topMargin + r * (side + gapForLayout);
      const rowCenterY = rowTop + side / 2;

      for (let c = 0; c < nInRow; c++) {
        if (shapesCreated >= options.totalShapes) break;

        const x = c * cellW + (cellW - side) / 2;
        const left = Math.round(x);
        const top = Math.round(rowTop);
        const right = Math.round(x + side);
        const bottom = Math.round(rowTop + side);
        const isEvenRow = r % 2 === 1;
        const shapeIndex = isEvenRow
          ? r * options.perRow + (nInRow - 1 - c) + 1
          : r * options.perRow + c + 1;

        let shapeLayer = await makeShapeLayer(
          options.shapeType === "circle" ? "ellipse" : "rectangle",
          left,
          top,
          right,
          bottom
        );
        shapeLayer.name = `shape_${shapeIndex}`;
        shapeLayer = await convertActiveLayerToSmartObject();
        shapeLayer.name = `shape_${shapeIndex}`;
        try {
          shapeLayer.move(shapesGroup, photoshop.constants.ElementPlacement.PLACEINSIDE);
        } catch (_) {}
        shapeLayers.push({ index: shapeIndex, layer: shapeLayer });
        shapesCreated++;

        if (options.addText) {
          const content = options.initialText.trim() || `text_${shapeIndex}`;
          const sizePx = textSizeToPixels(options.textSize, options.textSizeInPixels, doc.resolution || 72);
          const targetTextGroup = await ensureTextGroup();
          const textLayer = await createTextPrecisely({
            doc,
            group: targetTextGroup,
            index: shapeIndex,
            shapeLeft: left,
            shapeRight: right,
            shapeTop: top,
            shapeBottom: bottom,
            offsetPx: options.textOffset,
            sizePx,
            content,
            aaName: options.antiAlias,
            pos: options.textPosition,
          });
          if (textLayer) textLayers.push({ index: shapeIndex, layer: textLayer });
          textCreated++;
        }
      }

      if (arrowEntry && options.addHorizontalArrows && nInRow >= 2) {
        const hDir = rowDir(r + 1);
        for (let ci = 0; ci < nInRow - 1; ci++) {
          const leftA = ci * cellW + (cellW - side) / 2;
          const rightA = leftA + side;
          const leftB = (ci + 1) * cellW + (cellW - side) / 2;
          const gapW = leftB - rightA;
          const gapCX = (rightA + leftB) / 2;
          const arrowScale = options.arrowScalePercent / 100;
          const made = await placeArrow(
            arrowEntry,
            (gapW - options.arrowPadding * 2) * arrowScale,
            side * 0.7 * arrowScale,
            gapCX,
            rowCenterY,
            hDir,
            `arrow_h_r${r + 1}_c${ci + 1}_${hDir}`,
            await ensureArrowsGroup()
          );
          if (made) {
            arrowLayers.push({ index: arrowLayers.length + 1, layer: made });
            arrowsCreated++;
          }
        }
      }

      if (arrowEntry && options.addVerticalArrows && r < options.rows - 1 && gapForLayout >= 2) {
        const nextN = shapesInRow(r + 1);
        if (nextN > 0) {
          const turnCol = r % 2 === 0 ? nInRow - 1 : 0;
          const vCX = turnCol * cellW + cellW / 2;
          const vCY = rowTop + side + gapForLayout / 2;
          const arrowScale = options.arrowScalePercent / 100;
          const made = await placeArrow(
            arrowEntry,
            side * 0.7 * arrowScale,
            (hGap - options.arrowPadding * 2) * arrowScale,
            vCX,
            vCY,
            "down",
            `arrow_v_r${r + 1}_to_r${r + 2}`,
            await ensureArrowsGroup()
          );
          if (made) {
            arrowLayers.push({ index: arrowLayers.length + 1, layer: made });
            arrowsCreated++;
          }
        }
      }
    }

    for (const item of [...shapeLayers].sort((a, b) => b.index - a.index)) {
      try {
        item.layer.move(shapesGroup, photoshop.constants.ElementPlacement.PLACEINSIDE);
      } catch (_) {}
    }

    if (textGroup) {
      for (const item of [...textLayers].sort((a, b) => b.index - a.index)) {
        try {
          item.layer.move(textGroup, photoshop.constants.ElementPlacement.PLACEINSIDE);
        } catch (_) {}
      }
    }

    if (arrowsGroup) {
      for (const item of [...arrowLayers].sort((a, b) => b.index - a.index)) {
        try {
          item.layer.move(arrowsGroup, photoshop.constants.ElementPlacement.PLACEINSIDE);
        } catch (_) {}
      }
    }
  });

  return `Created ${shapesCreated} shape${shapesCreated === 1 ? "" : "s"}, ${textCreated} text layer${textCreated === 1 ? "" : "s"}, ${arrowsCreated} arrow${arrowsCreated === 1 ? "" : "s"}.`;
};
