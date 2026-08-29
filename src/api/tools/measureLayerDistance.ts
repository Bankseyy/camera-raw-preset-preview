import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function isGroupLayer(layer: any): boolean {
  return layer?.kind === "group" || layer?.typename === "LayerSet";
}

function boundsFromDom(layer: any): Bounds {
  const bounds = layer.bounds;
  if (!bounds) throw new Error(`"${layer.name}" has no bounds.`);

  if (Array.isArray(bounds)) {
    return {
      left: toNumber(bounds[0]),
      top: toNumber(bounds[1]),
      right: toNumber(bounds[2]),
      bottom: toNumber(bounds[3]),
    };
  }

  return {
    left: toNumber(bounds.left),
    top: toNumber(bounds.top),
    right: toNumber(bounds.right),
    bottom: toNumber(bounds.bottom),
  };
}

async function boundsFromActionGet(layerId: number): Promise<Bounds> {
  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _id: layerId }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  const bounds = result[0]?.boundsNoEffects ?? result[0]?.bounds;
  if (!bounds) throw new Error("Layer has no measurable bounds.");

  return {
    left: toNumber(bounds.left),
    top: toNumber(bounds.top),
    right: toNumber(bounds.right),
    bottom: toNumber(bounds.bottom),
  };
}

async function getLayerBounds(layer: any): Promise<Bounds> {
  const bounds = isGroupLayer(layer)
    ? boundsFromDom(layer)
    : await boundsFromActionGet(layer.id as number);

  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    throw new Error(`"${layer.name}" has empty bounds.`);
  }

  return bounds;
}

function horizontalMeasurement(first: Bounds, second: Bounds): string {
  if (first.right <= second.left) return `${Math.round(second.left - first.right)}px gap (first layer is left)`;
  if (second.right <= first.left) return `${Math.round(first.left - second.right)}px gap (first layer is right)`;
  return `${Math.round(Math.min(first.right, second.right) - Math.max(first.left, second.left))}px overlap`;
}

function verticalMeasurement(first: Bounds, second: Bounds): string {
  if (first.bottom <= second.top) return `${Math.round(second.top - first.bottom)}px gap (first layer is above)`;
  if (second.bottom <= first.top) return `${Math.round(first.top - second.bottom)}px gap (first layer is below)`;
  return `${Math.round(Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))}px overlap`;
}

function bottomToSecondTopMeasurement(first: Bounds, second: Bounds): string {
  const distance = Math.round(second.top - first.bottom);
  return `${distance}px${distance < 0 ? " overlap" : " gap"}`;
}

function centreMeasurement(first: Bounds, second: Bounds): string {
  const firstCentreX = (first.left + first.right) / 2;
  const firstCentreY = (first.top + first.bottom) / 2;
  const secondCentreX = (second.left + second.right) / 2;
  const secondCentreY = (second.top + second.bottom) / 2;
  const offsetX = Math.round(secondCentreX - firstCentreX);
  const offsetY = Math.round(secondCentreY - firstCentreY);
  const directDistance = Math.round(Math.hypot(offsetX, offsetY));

  return `X ${offsetX}px, Y ${offsetY}px, direct ${directDistance}px`;
}

export const runMeasureLayerDistance = async (): Promise<string> => {
  let message = "";

  await asModal("Measure Layer Distance", async () => {
    const doc = photoshop.app.activeDocument as any;
    const selectedLayers = Array.from<any>(doc.activeLayers ?? []);
    if (selectedLayers.length !== 2) {
      throw new Error("Select exactly two layers or groups.");
    }

    const [firstLayer, secondLayer] = selectedLayers;
    const firstBounds = await getLayerBounds(firstLayer);
    const secondBounds = await getLayerBounds(secondLayer);

    message = [
      `${firstLayer.name} / ${secondLayer.name}`,
      `Horizontal: ${horizontalMeasurement(firstBounds, secondBounds)}`,
      `Vertical: ${verticalMeasurement(firstBounds, secondBounds)}`,
      `Bottom edge -> second top: ${bottomToSecondTopMeasurement(firstBounds, secondBounds)}`,
      `Centre to centre: ${centreMeasurement(firstBounds, secondBounds)}`,
    ].join("\n");
  });

  await photoshop.app.showAlert(message);
  return message;
};
