import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export interface GridlinesOptions {
  columns: number;
  rows: number;
  lineWidth: number;
  colorHex: string;
  opacity: number;
  includeBorder: boolean;
  groupName: string;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(value: number, min: number, max: number): number {
  const n = Number(value);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function normaliseHex(hex: string): { r: number; g: number; b: number; hex: string } {
  let value = String(hex || "").trim();
  if (value.startsWith("#")) value = value.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(value)) value = "FFFFFF";
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    hex: `#${value.toUpperCase()}`,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function getActiveLayerDom(): Promise<any> {
  const doc = photoshop.app.activeDocument as any;
  const activeLayers = Array.from<any>(doc.activeLayers ?? []);
  if (activeLayers[0]) return activeLayers[0];
  if (doc.activeLayer) return doc.activeLayer;

  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const id = result[0]?.layerID;
  if (typeof id === "number") {
    for (const layer of Array.from<any>(doc.layers)) {
      if (layer.id === id) return layer;
    }
  }

  throw new Error("Could not read the created gridline layer.");
}

async function createRectShape(
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: { r: number; g: number; b: number },
  opacity: number,
  name: string
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
          red: color.r,
          grain: color.g,
          blue: color.b,
        },
      },
      shape: {
        _obj: "rectangle",
        top: { _unit: "pixelsUnit", _value: top },
        left: { _unit: "pixelsUnit", _value: left },
        bottom: { _unit: "pixelsUnit", _value: bottom },
        right: { _unit: "pixelsUnit", _value: right },
      },
    },
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const layer = await getActiveLayerDom();
  layer.name = name;
  layer.opacity = opacity;
  return layer;
}

async function ensureTopLevelGroup(doc: any, name: string): Promise<any> {
  for (const layer of Array.from<any>(doc.layers ?? [])) {
    if (layer.kind === "group" && String(layer.name ?? "") === name) return layer;
  }

  const group = await doc.createLayerGroup({ name });
  if (!group) throw new Error(`Could not create ${name} group.`);
  return group;
}

export const runGridlines = async (input: GridlinesOptions): Promise<string> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("Open a document first.");
  }

  const columns = clampInt(input.columns, 1, 9999);
  const rows = clampInt(input.rows, 1, 9999);
  const lineWidth = clampFloat(input.lineWidth, 1, 10000);
  const opacity = clampFloat(input.opacity, 0, 100);
  const color = normaliseHex(input.colorHex);
  const groupName = String(input.groupName || "").trim() || "Gridlines";
  let created = 0;

  await withHistory(doc, "Create Gridlines", async () => {
    doc = photoshop.app.activeDocument as any;
    const width = toNumber(doc.width);
    const height = toNumber(doc.height);
    const group = await ensureTopLevelGroup(doc, groupName);

    if (columns >= 2) {
      const stepX = width / columns;
      for (let i = 1; i <= columns - 1; i++) {
        const x = i * stepX;
        const left = round2(x - lineWidth / 2);
        const right = round2(left + lineWidth);
        const layer = await createRectShape(left, 0, right, height, color, opacity, `V ${i} @ ${round2(x)}px`);
        try { layer.move(group, photoshop.constants.ElementPlacement.PLACEINSIDE); } catch (_) {}
        created++;
      }
    }

    if (rows >= 2) {
      const stepY = height / rows;
      for (let i = 1; i <= rows - 1; i++) {
        const y = i * stepY;
        const top = round2(y - lineWidth / 2);
        const bottom = round2(top + lineWidth);
        const layer = await createRectShape(0, top, width, bottom, color, opacity, `H ${i} @ ${round2(y)}px`);
        try { layer.move(group, photoshop.constants.ElementPlacement.PLACEINSIDE); } catch (_) {}
        created++;
      }
    }

    if (input.includeBorder) {
      const borders = [
        { name: "Border Top", left: 0, top: 0, right: width, bottom: lineWidth },
        { name: "Border Bottom", left: 0, top: height - lineWidth, right: width, bottom: height },
        { name: "Border Left", left: 0, top: 0, right: lineWidth, bottom: height },
        { name: "Border Right", left: width - lineWidth, top: 0, right: width, bottom: height },
      ];

      for (const border of borders) {
        const layer = await createRectShape(border.left, border.top, border.right, border.bottom, color, opacity, border.name);
        try { layer.move(group, photoshop.constants.ElementPlacement.PLACEINSIDE); } catch (_) {}
        created++;
      }
    }
  });

  return `Created ${created} gridline layer${created === 1 ? "" : "s"} in "${groupName}" (${columns} columns, ${rows} rows, ${lineWidth}px, ${color.hex}, ${opacity}%).`;
};
