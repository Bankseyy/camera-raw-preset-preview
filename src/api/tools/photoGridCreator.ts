import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";
import { createFrameLayers, type Bounds } from "./createGridFrames";
import { PHOTO_GRID_LAYOUTS } from "./photoGridLayouts";

export interface PhotoGridCreatorOptions {
  layoutId: number;
  gutter: number;
  createNew: boolean;
  canvasPreset: "square" | "portrait" | "landscape";
  attemptFrames: boolean;
  smartObjects: boolean;
}

const CANVAS_PRESETS = {
  square: { width: 1080, height: 1080, label: "Square 1:1" },
  portrait: { width: 1080, height: 1350, label: "Portrait 4:5" },
  landscape: { width: 1600, height: 900, label: "Landscape 16:9" },
} as const;

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function getDocSize(doc: any): { width: number; height: number } {
  return { width: toNumber(doc.width), height: toNumber(doc.height) };
}

function clampGutter(value: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100000, parsed));
}

function layoutBounds(
  width: number,
  height: number,
  cells: Array<{ x: number; y: number; w: number; h: number }>,
  gutter: number
): Bounds[] {
  const halfGutter = Math.round(gutter / 2);

  return cells.map(cell => {
    const left = Math.round(cell.x * width) + (cell.x <= 0.001 ? 0 : halfGutter);
    const top = Math.round(cell.y * height) + (cell.y <= 0.001 ? 0 : halfGutter);
    const rightEdge = cell.x + cell.w;
    const bottomEdge = cell.y + cell.h;
    const right = Math.round(rightEdge * width) - (rightEdge >= 0.999 ? 0 : halfGutter);
    const bottom = Math.round(bottomEdge * height) - (bottomEdge >= 0.999 ? 0 : halfGutter);

    if (right - left < 1 || bottom - top < 1) {
      throw new Error("The gutter is too large for this layout and canvas.");
    }

    return { l: left, t: top, r: right, b: bottom };
  });
}

async function getActiveDocument(): Promise<any> {
  try {
    return photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("Open a document first, or choose Create new document.");
  }
}

async function createDocument(presetKey: PhotoGridCreatorOptions["canvasPreset"]): Promise<any> {
  const preset = CANVAS_PRESETS[presetKey] ?? CANVAS_PRESETS.square;
  const created = await (photoshop.app.documents as any).add({
    name: `Photo Grid ${preset.label}`,
    width: preset.width,
    height: preset.height,
    resolution: 72,
    mode: "RGBColorMode",
    fill: "transparent",
  });

  if (!created) throw new Error("Photoshop could not create the new document.");
  return created;
}

export const runPhotoGridCreator = async (input: PhotoGridCreatorOptions): Promise<string> => {
  const selected = PHOTO_GRID_LAYOUTS.find(layout => layout.id === Number(input.layoutId));
  if (!selected) throw new Error("Choose a Photo Grid layout first.");

  const createNew = Boolean(input.createNew);
  const attemptFrames = Boolean(input.attemptFrames) && !Boolean(input.smartObjects);
  const smartObjects = Boolean(input.smartObjects);
  const gutter = clampGutter(input.gutter);
  const doc = createNew
    ? await createDocument(input.canvasPreset)
    : await getActiveDocument();

  await withHistory(doc, "Create Photo Grid", async () => {
    photoshop.app.activeDocument = doc;
    const size = getDocSize(doc);
    const bounds = layoutBounds(size.width, size.height, selected.cells, gutter);
    await createFrameLayers(doc, bounds, `Photo Grid ${selected.cells.length} - ${selected.name}`, {
      attemptFrames,
      smartObjects,
    });
  });

  const layerType = smartObjects
    ? "Smart Object placeholders"
    : attemptFrames
      ? "native Frame layers where available"
      : "shape-layer placeholders";
  const canvas = createNew ? ` in a new ${CANVAS_PRESETS[input.canvasPreset]?.label ?? "document"} document` : "";
  const gutterNote = gutter > 0 ? ` Gutter: ${gutter}px.` : "";
  return `Created ${selected.cells.length} ${layerType} using "${selected.name}"${canvas}.${gutterNote}`;
};
