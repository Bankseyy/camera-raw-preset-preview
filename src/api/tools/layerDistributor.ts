import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";
import { withHistory } from "../psHistory";

export interface CachedLayer {
  id: number;
  name: string;
  isGroup: boolean;
  tL: number; tT: number; tR: number; tB: number;
  tW: number; tH: number;
  cX: number; cY: number;
}

export interface LayerMove {
  id: number;
  dX: number;
  dY: number;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

export const buildLayerCache = async (): Promise<CachedLayer[]> => {
  return (await asModal("Layer Distributor", async () => {
    const docInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});

    const targetLayers: any[] = docInfo[0].targetLayers ?? [];
    if (targetLayers.length === 0) return [];

    type RawLayer = {
      id: number; name: string; isGroup: boolean;
      parentLayerID: number | undefined;
      tL: number; tT: number; tR: number; tB: number;
    };

    const rawLayers: RawLayer[] = [];

    for (const t of targetLayers) {
      try {
        const info = await batchPlay([{
          _obj: "get",
          _target: [{ _ref: "layer", _index: t._index + 1 }],
          _options: { dialogOptions: "dontDisplay" },
        }], {});
        const d = info[0];
        const id   = d.layerID as number;
        const name = d.name   as string;

        const layerSection = d.layerSection?._value as string | undefined;
        const isGroup = layerSection === "layerSectionStart" || d.layerKind === 7;

        const parentLayerID = d.parentLayerID as number | undefined;

        const b = d.boundsNoEffects ?? d.bounds;
        if (!b) continue;

        rawLayers.push({
          id, name, isGroup, parentLayerID,
          tL: b.left._value   as number,
          tT: b.top._value    as number,
          tR: b.right._value  as number,
          tB: b.bottom._value as number,
        });
      } catch (_) {}
    }

    // Filter out child layers when their parent group is also selected
    const hasGroups    = rawLayers.some(l => l.isGroup);
    const hasNonGroups = rawLayers.some(l => !l.isGroup);
    let filtered = rawLayers;
    if (hasGroups && hasNonGroups) {
      const groupIds = new Set(rawLayers.filter(l => l.isGroup).map(l => l.id));
      filtered = rawLayers.filter(
        l => l.isGroup || l.parentLayerID == null || !groupIds.has(l.parentLayerID)
      );
    }

    return filtered.map(l => ({
      id: l.id, name: l.name, isGroup: l.isGroup,
      tL: l.tL, tT: l.tT, tR: l.tR, tB: l.tB,
      tW: l.tR - l.tL, tH: l.tB - l.tT,
      cX: (l.tL + l.tR) / 2, cY: (l.tT + l.tB) / 2,
    }));
  })) as CachedLayer[];
};

export const selectLayers = async (ids: number[]): Promise<void> => {
  if (ids.length === 0) return;
  await asModal("Layer Distributor", async () => {
    await batchPlay([{
      _obj: "select",
      _target: [{ _ref: "layer", _id: ids[0] }],
      makeVisible: false,
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    for (let k = 1; k < ids.length; k++) {
      await batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: ids[k] }],
        selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" },
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      }], {});
    }
  });
};

export const moveLayers = async (moves: LayerMove[]): Promise<void> => {
  const significant = moves.filter(m => Math.abs(m.dX) > 0.5 || Math.abs(m.dY) > 0.5);
  if (significant.length === 0) return;

  const doc = photoshop.app.activeDocument as any;
  await withHistory(doc, "Distribute Layers", async () => {
    for (const { id, dX, dY } of significant) {
      await batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: id }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      }], {});
      await batchPlay([{
        _obj: "transform",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: dX },
          vertical:   { _unit: "pixelsUnit", _value: dY },
        },
        linked: true,
        interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
        _options: { dialogOptions: "dontDisplay" },
      }], {});
    }
  });
};
