import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export interface CreateGridFramesOptions {
  rows: number;
  cols: number;
  margin: number;
  gutterY: number;
  gutterX: number;
  attemptFrames: boolean;
  smartObjects: boolean;
}

export interface Bounds {
  l: number;
  t: number;
  r: number;
  b: number;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
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

function getDocSize(doc: any) {
  return {
    width: toNumber(doc.width),
    height: toNumber(doc.height),
  };
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

  throw new Error("Could not read the active Photoshop layer.");
}

function gridBounds(width: number, height: number, rows: number, cols: number, margin: number, gutterY: number, gutterX: number): Bounds[] {
  const usableW = width - 2 * margin - (cols - 1) * gutterX;
  const usableH = height - 2 * margin - (rows - 1) * gutterY;
  if (usableW <= 0 || usableH <= 0) throw new Error("Margins/gutters are too large for the canvas.");

  const cellW = usableW / cols;
  const cellH = usableH / rows;
  const bounds: Bounds[] = [];
  let top = margin;

  for (let row = 0; row < rows; row++) {
    let left = margin;
    for (let col = 0; col < cols; col++) {
      bounds.push({
        l: left,
        t: top,
        r: col === cols - 1 ? width - margin : left + cellW,
        b: row === rows - 1 ? height - margin : top + cellH,
      });
      left += cellW + gutterX;
    }
    top += cellH + gutterY;
  }

  return bounds;
}

async function createGroup(name: string): Promise<any> {
  await batchPlay([{
    _obj: "make",
    _target: [{ _ref: "layerSection" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  const group = await getActiveLayerDom();
  try { group.name = name; } catch (_) {}
  return group;
}

async function createRectShape(name: string, bounds: Bounds): Promise<any> {
  await batchPlay([{
    _obj: "make",
    _target: [{ _ref: "contentLayer" }],
    using: {
      _obj: "contentLayer",
      type: {
        _obj: "solidColorLayer",
        color: {
          _obj: "RGBColor",
          red: 255,
          grain: 255,
          blue: 255,
        },
      },
      shape: {
        _obj: "rectangle",
        top: { _unit: "pixelsUnit", _value: bounds.t },
        left: { _unit: "pixelsUnit", _value: bounds.l },
        bottom: { _unit: "pixelsUnit", _value: bounds.b },
        right: { _unit: "pixelsUnit", _value: bounds.r },
      },
    },
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  const layer = await getActiveLayerDom();
  try { layer.name = name; } catch (_) {}
  return layer;
}

async function convertActiveLayerToSmartObject(): Promise<any | null> {
  try {
    await batchPlay([{ _obj: "newPlacedLayer", _options: { dialogOptions: "dontDisplay" } }], {});
    return getActiveLayerDom();
  } catch (_) {
    return null;
  }
}

async function makeNativeFrame(name: string, bounds: Bounds): Promise<any | null> {
  try {
    await batchPlay([{
      _obj: "make",
      _target: [{ _ref: "framedGroupSection" }],
      name,
      framedGroupRect: {
        _obj: "classFloatRect",
        top: bounds.t,
        left: bounds.l,
        bottom: bounds.b,
        right: bounds.r,
      },
      framedGroupType: 4,
      LockPPI: false,
      PreferredResolution: 300,
      SavedIteratedName: "",
      framedGroupPathResolution: 300,
      framedGroupPath: {
        _obj: "pathClass",
        pathComponents: [{
          _obj: "pathComponent",
          shapeOperation: { _enum: "shapeOperation", _value: "add" },
          subpathListKey: [{
            _obj: "subpathsList",
            closedSubpath: true,
            points: [
              {
                _obj: "pathPoint",
                anchor: {
                  _obj: "paint",
                  horizontal: { _unit: "pixelsUnit", _value: bounds.l },
                  vertical: { _unit: "pixelsUnit", _value: bounds.t },
                },
              },
              {
                _obj: "pathPoint",
                anchor: {
                  _obj: "paint",
                  horizontal: { _unit: "pixelsUnit", _value: bounds.r },
                  vertical: { _unit: "pixelsUnit", _value: bounds.t },
                },
              },
              {
                _obj: "pathPoint",
                anchor: {
                  _obj: "paint",
                  horizontal: { _unit: "pixelsUnit", _value: bounds.r },
                  vertical: { _unit: "pixelsUnit", _value: bounds.b },
                },
              },
              {
                _obj: "pathPoint",
                anchor: {
                  _obj: "paint",
                  horizontal: { _unit: "pixelsUnit", _value: bounds.l },
                  vertical: { _unit: "pixelsUnit", _value: bounds.b },
                },
              },
            ],
          }],
        }],
      },
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    const frame = await getActiveLayerDom();
    try { frame.name = name; } catch (_) {}
    return frame;
  } catch (_) {
    return null;
  }
}

function frameNumber(layer: any): number {
  const match = String(layer.name ?? "").match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function moveIntoGroup(frameLayers: any[], group: any): Promise<void> {
  for (const layer of frameLayers) {
    try {
      await layer.move(group, photoshop.constants.ElementPlacement.PLACEINSIDE);
    } catch (_) {}
  }
}

async function reorderFrameOneAtTop(frameLayers: any[], group: any): Promise<void> {
  const sorted = [...frameLayers].sort((a, b) => frameNumber(a) - frameNumber(b));
  const firstFrame = sorted[0];
  if (!firstFrame) return;

  // PLACEINSIDE only controls the parent. Explicit sibling placement is needed
  // to guarantee that Frame 1 is the first child shown in the Layers panel.
  try {
    const firstChild = Array.from<any>(group.layers ?? [])[0];
    if (firstChild && firstChild.id !== firstFrame.id) {
      await firstFrame.move(firstChild, photoshop.constants.ElementPlacement.PLACEBEFORE);
    }
  } catch (_) {}

  let anchor = firstFrame;
  for (const layer of sorted.slice(1)) {
    try {
      await layer.move(anchor, photoshop.constants.ElementPlacement.PLACEAFTER);
      anchor = layer;
    } catch (_) {}
  }
}

export interface FrameLayerCreationOptions {
  attemptFrames: boolean;
  smartObjects: boolean;
}

export async function createFrameLayers(
  doc: any,
  bounds: Bounds[],
  groupName: string,
  options: FrameLayerCreationOptions
): Promise<{ created: number; convertedFrames: number; convertedSmartObjects: number }> {
  const parent = await createGroup(groupName);
  const made: any[] = [];
  let convertedFrames = 0;
  let convertedSmartObjects = 0;

  for (let i = 0; i < bounds.length; i++) {
    const name = `Frame ${i + 1}`;
    let current: any | null = null;

    if (options.attemptFrames) {
      current = await makeNativeFrame(name, bounds[i]);
      if (current) convertedFrames++;
    }

    if (!current) {
      current = await createRectShape(name, bounds[i]);
    }

    if (options.smartObjects && current) {
      const shapeLayer = current;
      await selectLayer(shapeLayer);
      const converted = await convertActiveLayerToSmartObject();
      if (converted) {
        current = converted;
        convertedSmartObjects++;
      }
    }

    try { current.name = name; } catch (_) {}
    made.push(current);
  }

  await moveIntoGroup(made, parent);
  await reorderFrameOneAtTop(made, parent);

  return { created: made.length, convertedFrames, convertedSmartObjects };
}

export const runCreateGridFrames = async (input: CreateGridFramesOptions): Promise<string> => {
  let doc: any;
  try {
    doc = photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("Open a document first.");
  }

  const rows = clampInt(input.rows, 1, 100);
  const cols = clampInt(input.cols, 1, 100);
  const margin = clampFloat(input.margin, 0, 100000);
  const gutterY = clampFloat(input.gutterY, 0, 100000);
  const gutterX = clampFloat(input.gutterX, 0, 100000);
  const smartObjects = Boolean(input.smartObjects);
  const attemptFrames = smartObjects ? false : Boolean(input.attemptFrames);
  let convertedSmartObjects = 0;
  let convertedFrames = 0;

  await withHistory(doc, "Create Grid Frames", async () => {
    doc = photoshop.app.activeDocument as any;
    const size = getDocSize(doc);
    const bounds = gridBounds(size.width, size.height, rows, cols, margin, gutterY, gutterX);
    const result = await createFrameLayers(doc, bounds, `Grid Frames ${rows}x${cols}`, {
      attemptFrames,
      smartObjects,
    });
    convertedFrames = result.convertedFrames;
    convertedSmartObjects = result.convertedSmartObjects;
  });

  const count = rows * cols;
  const extra = smartObjects
    ? ` ${convertedSmartObjects} converted to Smart Object${convertedSmartObjects === 1 ? "" : "s"}.`
    : attemptFrames
      ? ` ${convertedFrames} converted to native Frame${convertedFrames === 1 ? "" : "s"}.`
    : "";

  return `Done. Created ${count} frame placeholder${count === 1 ? "" : "s"} in Grid Frames ${rows}x${cols}.${extra}`;
};

async function selectLayer(layer: any): Promise<void> {
  if (typeof layer?.id !== "number") return;
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: layer.id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}
