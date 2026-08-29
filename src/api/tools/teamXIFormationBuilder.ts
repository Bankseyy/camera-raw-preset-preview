import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";

export const TEAM_XI_FORMATION_ROWS: Record<string, string[][]> = {
  "4-3-3": [
    ["LW", "ST", "RW"],
    ["CM3", "CM2", "CM1"],
    ["LB", "LCB", "RCB", "RB"],
    ["GK"],
  ],
  "4-2-3-1": [
    ["ST"],
    ["LW", "CAM", "RW"],
    ["CDM2", "CDM1"],
    ["LB", "LCB", "RCB", "RB"],
    ["GK"],
  ],
  "4-4-2": [
    ["ST1", "ST2"],
    ["LM", "CM2", "CM1", "RM"],
    ["LB", "LCB", "RCB", "RB"],
    ["GK"],
  ],
  "3-5-2": [
    ["ST1", "ST2"],
    ["LWB", "CM2", "CAM", "CM1", "RWB"],
    ["CB1", "CB2", "CB3"],
    ["GK"],
  ],
  "3-4-3": [
    ["LW", "ST", "RW"],
    ["LWB", "CM2", "CM1", "RWB"],
    ["CB1", "CB2", "CB3"],
    ["GK"],
  ],
};

const TEAM_XI_FORMATION_POSITIONS: Record<string, string[]> = {
  "4-3-3": ["GK", "RB", "RCB", "LCB", "LB", "CM1", "CM2", "CM3", "RW", "ST", "LW"],
  "4-2-3-1": ["GK", "RB", "RCB", "LCB", "LB", "CDM1", "CDM2", "CAM", "RW", "ST", "LW"],
  "4-4-2": ["GK", "RB", "RCB", "LCB", "LB", "RM", "CM1", "CM2", "LM", "ST1", "ST2"],
  "3-5-2": ["GK", "CB1", "CB2", "CB3", "RWB", "LWB", "CM1", "CM2", "CAM", "ST1", "ST2"],
  "3-4-3": ["GK", "CB1", "CB2", "CB3", "RWB", "CM1", "CM2", "LWB", "RW", "ST", "LW"],
};

export interface TeamXIFormationBuilderOptions {
  formation: string;
  gkAtTop?: boolean;
  topMargin?: number;
  sideMargin?: number;
  useCustomGaps?: boolean;
  horizontalGap?: number;
  verticalGap?: number;
}

export interface TeamXIFormationNamingOptions {
  formation: string;
}

interface LayerBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value) || 0;
}

function normalMargin(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getAllLayers(parent: any): any[] {
  const layers: any[] = [];
  try {
    for (const layer of Array.from<any>(parent.layers ?? [])) {
      layers.push(layer);
      if (layer.kind === "group" && layer.layers) layers.push(...getAllLayers(layer));
    }
  } catch (_) {}
  return layers;
}

function findLayerById(parent: any, id: number): any | null {
  for (const layer of getAllLayers(parent)) {
    try {
      if (layer.id === id) return layer;
    } catch (_) {}
  }
  return null;
}

function isBaseGroupName(value: unknown): boolean {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "_") === "BASE_GROUP";
}

async function getActiveLayerId(): Promise<number | null> {
  try {
    const result = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    return typeof result[0]?.layerID === "number" ? result[0].layerID : null;
  } catch (_) {
    return null;
  }
}

async function findBaseGroup(doc: any): Promise<any | null> {
  const named = getAllLayers(doc).find(layer => layer.kind === "group" && isBaseGroupName(layer.name));
  if (named) return named;

  const activeId = await getActiveLayerId();
  const activeLayer = activeId ? findLayerById(doc, activeId) : null;
  return activeLayer?.kind === "group" ? activeLayer : null;
}

function isTemplateLayerName(value: unknown, name: string): boolean {
  const actual = String(value ?? "").trim().toUpperCase();
  const target = name.toUpperCase();
  return actual === target || new RegExp(`^${target} COPY(?: \\d+)?$`).test(actual);
}

function getIndexedCopyName(sourceName: string, copyOffset: number): string | null {
  const suffixIndex = sourceName.match(/^(.*_)(\d+)(\D*)$/);
  if (suffixIndex) {
    const [, prefix, rawIndex, suffix] = suffixIndex;
    const nextIndex = String(parseInt(rawIndex, 10) + copyOffset).padStart(rawIndex.length, "0");
    return prefix + nextIndex + suffix;
  }

  const leadingIndex = sourceName.match(/^(\d+)(_.*)$/);
  if (leadingIndex) {
    const [, rawIndex, suffix] = leadingIndex;
    const nextIndex = String(parseInt(rawIndex, 10) + copyOffset).padStart(rawIndex.length, "0");
    return nextIndex + suffix;
  }

  return null;
}

function renumberIndexedLayerNames(group: any, copyOffset: number): void {
  for (const layer of getAllLayers(group)) {
    const sourceName = String(layer.name ?? "");
    const nextName = getIndexedCopyName(sourceName, copyOffset);
    if (!nextName || nextName === sourceName) continue;
    layer.name = nextName;
  }
}

interface PositionRenameResult {
  renamedLayers: number;
  photoLayers: number;
}

function positionTargetSuffix(value: string): "name" | "photo" | "shape" | null {
  const match = value.trim().match(/_(name|photo|shape)(?: COPY(?: \d+)?)?$/i);
  const suffix = match?.[1]?.toLowerCase();
  return suffix === "name" || suffix === "photo" || suffix === "shape" ? suffix : null;
}

function renamePositionLayers(group: any, position: string): PositionRenameResult {
  let renamedLayers = 0;
  let photoLayers = 0;

  for (const layer of getAllLayers(group)) {
    if (layer.kind === "group") continue;

    const name = String(layer.name ?? "");
    let suffix = positionTargetSuffix(name);
    let setPositionText = false;

    if (isTemplateLayerName(name, "TEXT")) {
      suffix = "name";
      setPositionText = true;
    } else if (
      isTemplateLayerName(name, "PLAYER")
      || isTemplateLayerName(name, "PHOTO")
    ) {
      suffix = "photo";
    } else if (isTemplateLayerName(name, "SHAPE")) {
      suffix = "shape";
    }

    if (!suffix) continue;
    const nextName = position + "_" + suffix;
    if (name !== nextName) {
      layer.name = nextName;
      renamedLayers++;
    }
    if (setPositionText) {
      try { layer.textItem.contents = position; } catch (_) {}
    }
    if (suffix === "photo") photoLayers++;
  }

  return { renamedLayers, photoLayers };
}

async function getLayerBounds(id: number): Promise<LayerBounds> {
  const result = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "layer", _id: id }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  const bounds = result[0]?.boundsNoEffects ?? result[0]?.bounds;
  if (!bounds) throw new Error("Could not read the duplicated group bounds.");

  return {
    left: toNumber(bounds.left),
    top: toNumber(bounds.top),
    right: toNumber(bounds.right),
    bottom: toNumber(bounds.bottom),
  };
}

async function moveGroupTo(group: any, x: number, y: number): Promise<void> {
  const bounds = await getLayerBounds(group.id);
  const dx = x - ((bounds.left + bounds.right) / 2);
  const dy = y - ((bounds.top + bounds.bottom) / 2);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

  try {
    await group.translate(Math.round(dx), Math.round(dy));
    return;
  } catch (_) {}

  // Some Photoshop versions reject a group translate. Moving every child is a
  // fallback, but the normal group move best preserves template relationships.
  const leaves = getAllLayers(group).filter(layer => layer.kind !== "group");
  for (const layer of leaves) {
    await layer.translate(Math.round(dx), Math.round(dy));
  }
}

async function getLayerDescriptor(id: number): Promise<any | null> {
  try {
    const result = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _id: id }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    return result[0] ?? null;
  } catch (_) {
    return null;
  }
}

function isClipped(descriptor: any): boolean {
  return Boolean(descriptor?.group ?? descriptor?.clipping);
}

async function collectClippedLayerPaths(container: any, parentPath: number[] = []): Promise<number[][]> {
  const paths: number[][] = [];
  const children = Array.from<any>(container?.layers ?? []);
  for (let index = 0; index < children.length; index++) {
    const layer = children[index];
    const path = [...parentPath, index];
    if (isClipped(await getLayerDescriptor(layer.id as number))) paths.push(path);
    if (layer.kind === "group" && layer.layers) {
      paths.push(...await collectClippedLayerPaths(layer, path));
    }
  }
  return paths;
}

function findLayerByPath(container: any, path: number[]): any | null {
  let current = container;
  for (const index of path) {
    const children = Array.from<any>(current?.layers ?? []);
    current = children[index];
    if (!current) return null;
  }
  return current;
}

async function restoreClippingByPath(root: any, paths: number[][]): Promise<void> {
  for (const path of paths) {
    const layer = findLayerByPath(root, path);
    if (!layer || isClipped(await getLayerDescriptor(layer.id as number))) continue;
    await selectLayerById(layer.id as number);
    await batchPlay([{
      _obj: "groupEvent",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
  }
}

async function isSmartObject(id: number): Promise<boolean> {
  return Boolean((await getLayerDescriptor(id))?.smartObject);
}

async function selectLayerById(id: number): Promise<void> {
  await batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function renameActiveLayer(name: string): Promise<void> {
  await batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "layer", name },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function makeSmartObjectUnique(id: number, name: string): Promise<void> {
  await selectLayerById(id);
  await batchPlay([{
    _obj: "placedLayerMakeCopy",
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  await renameActiveLayer(name);
  await batchPlay([{
    _obj: "delete",
    _target: [{ _ref: "layer", _id: id }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

interface FormationBuildResult {
  formation: string;
  built: number;
  photoLayers: number;
  uniquePhotos: number;
  parentGroupId: number | null;
}

async function buildFormation(doc: any, options: TeamXIFormationBuilderOptions): Promise<FormationBuildResult> {
  const formation = String(options.formation ?? "");
  const sourceRows = TEAM_XI_FORMATION_ROWS[formation];
  const positionOrder = TEAM_XI_FORMATION_POSITIONS[formation];
  if (!positionOrder) throw new Error("Unknown formation.");
  if (!sourceRows) throw new Error(`Unknown formation "${formation}".`);

  const rows = options.gkAtTop ? [...sourceRows].reverse() : sourceRows;
  const topMargin = normalMargin(options.topMargin, 80);
  const sideMargin = normalMargin(options.sideMargin, 60);
  const useCustomGaps = Boolean(options.useCustomGaps);
  const horizontalGap = normalMargin(options.horizontalGap, 20);
  const verticalGap = normalMargin(options.verticalGap, 40);
  const baseGroup = await findBaseGroup(doc);
  if (!baseGroup) {
    throw new Error('Name a template group "BASE_GROUP", or select a template group before building.');
  }

  const width = toNumber(doc.width);
  const height = toNumber(doc.height);
  if (!width || !height) throw new Error("Could not read document canvas size.");

  const usableWidth = Math.max(0, width - (sideMargin * 2));
  const usableHeight = Math.max(0, height - (topMargin * 2));
  const baseBounds = await getLayerBounds(baseGroup.id as number);
  const positionWidth = Math.max(1, baseBounds.right - baseBounds.left);
  const positionHeight = Math.max(1, baseBounds.bottom - baseBounds.top);
  const customFormationHeight = (rows.length * positionHeight) + (Math.max(0, rows.length - 1) * verticalGap);
  const customFirstY = (height - customFormationHeight) / 2 + (positionHeight / 2);
  const baseWasVisible = Boolean(baseGroup.visible);
  const baseClippedPaths = await collectClippedLayerPaths(baseGroup);
  const parentGroup = await doc.createLayerGroup({ name: formation });
  const duplicateGroups: Array<{ id: number; clippedPaths: number[][] }> = [];
  let built = 0;
  let photoLayers = 0;
  let uniquePhotos = 0;

  try {
    baseGroup.visible = false;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const y = useCustomGaps
        ? customFirstY + (rowIndex * (positionHeight + verticalGap))
        : rows.length <= 1
          ? topMargin + (usableHeight / 2)
          : topMargin + (rowIndex * (usableHeight / (rows.length - 1)));
      const customRowWidth = (row.length * positionWidth) + (Math.max(0, row.length - 1) * horizontalGap);
      const customFirstX = (width - customRowWidth) / 2 + (positionWidth / 2);

      for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
        const position = row[columnIndex];
        const x = useCustomGaps
          ? customFirstX + (columnIndex * (positionWidth + horizontalGap))
          : row.length <= 1
            ? width / 2
            : sideMargin + (columnIndex * (usableWidth / (row.length - 1)));

        const newGroup = await baseGroup.duplicate(baseGroup, photoshop.constants.ElementPlacement.PLACEAFTER);
        newGroup.name = position;
        newGroup.visible = true;
        photoLayers += renamePositionLayers(newGroup, position).photoLayers;
        const positionIndex = positionOrder.indexOf(position);
        renumberIndexedLayerNames(newGroup, Math.max(0, positionIndex));
        await newGroup.move(parentGroup, photoshop.constants.ElementPlacement.PLACEINSIDE);
        await moveGroupTo(newGroup, x, y);
        duplicateGroups.push({ id: newGroup.id as number, clippedPaths: baseClippedPaths });
        built++;
      }
    }

    try {
      await parentGroup.move(baseGroup, photoshop.constants.ElementPlacement.PLACEAFTER);
    } catch (_) {}

    const smartObjectTargets = getAllLayers(parentGroup)
      .filter(layer => {
        if (layer.kind === "group") return false;
        const name = String(layer.name ?? "");
        return /_photo$/i.test(name) || /^shape_\d+(?=$|[^0-9])/i.test(name);
      });
    for (const layer of smartObjectTargets) {
      const id = layer.id as number;
      if (!id || !(await isSmartObject(id))) continue;
      const name = String(layer.name ?? "");
      await makeSmartObjectUnique(id, name);
      uniquePhotos++;
    }

    for (const duplicate of duplicateGroups) {
      const group = findLayerById(doc, duplicate.id);
      if (group) await restoreClippingByPath(group, duplicate.clippedPaths);
    }
  } finally {
    try { baseGroup.visible = baseWasVisible; } catch (_) {}
  }

  return {
    formation,
    built,
    photoLayers,
    uniquePhotos,
    parentGroupId: typeof parentGroup.id === "number" ? parentGroup.id : null,
  };
}

function buildSummary(results: FormationBuildResult[]): string {
  const built = results.reduce((total, result) => total + result.built, 0);
  const photos = results.reduce((total, result) => total + result.photoLayers, 0);
  const uniquePhotos = results.reduce((total, result) => total + result.uniquePhotos, 0);
  const formations = results.map(result => result.formation).join(", ");
  return [
    `Built ${built} position group${built === 1 ? "" : "s"} in ${formations}.`,
    `${photos} photo layer${photos === 1 ? "" : "s"} renamed; ${uniquePhotos} Smart Object${uniquePhotos === 1 ? "" : "s"} made unique.`,
  ].join("\n");
}

async function activeDocument(): Promise<any> {
  try {
    return photoshop.app.activeDocument as any;
  } catch (_) {
    throw new Error("Open your template document first.");
  }
}

function formationCode(value: unknown): string {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

function directChildGroups(group: any): any[] {
  try {
    return Array.from<any>(group?.layers ?? []).filter(layer => layer.kind === "group");
  } catch (_) {
    return [];
  }
}

function isPositionTargetLayer(layer: any): boolean {
  if (!layer || layer.kind === "group") return false;
  const name = String(layer.name ?? "");
  return Boolean(
    positionTargetSuffix(name)
    || isTemplateLayerName(name, "TEXT")
    || isTemplateLayerName(name, "PLAYER")
    || isTemplateLayerName(name, "PHOTO")
    || isTemplateLayerName(name, "SHAPE")
  );
}

function positionGroupsWithDirectTargets(root: any): any[] {
  const groups: any[] = [];

  const visit = (group: any) => {
    const children = Array.from<any>(group?.layers ?? []);
    if (children.some(isPositionTargetLayer)) groups.push(group);
    for (const child of children) {
      if (child.kind === "group") visit(child);
    }
  };

  visit(root);
  return groups;
}

async function findFormationNamingRoot(doc: any, formation: string): Promise<any | null> {
  const activeId = await getActiveLayerId();
  const activeLayer = activeId ? findLayerById(doc, activeId) : null;
  if (activeLayer?.kind === "group" && directChildGroups(activeLayer).length) return activeLayer;

  const targetCode = formationCode(formation);
  if (!targetCode) return null;
  return getAllLayers(doc).find(layer => (
    layer.kind === "group"
    && formationCode(layer.name) === targetCode
    && directChildGroups(layer).length > 0
  )) ?? null;
}

export const runTeamXIFormationNaming = async (options: TeamXIFormationNamingOptions): Promise<string> => {
  const doc = await activeDocument();
  let groupCount = 0;
  let renamedLayers = 0;
  let rootName = "";

  await withHistory(doc, "Rename XI Formation Targets", async () => {
    const root = await findFormationNamingRoot(photoshop.app.activeDocument as any, options.formation);
    if (!root) {
      throw new Error("Select a formation group, or choose a formation that already exists in the document.");
    }

    rootName = String(root.name ?? "Formation");
    for (const positionGroup of positionGroupsWithDirectTargets(root)) {
      const position = String(positionGroup.name ?? "").trim();
      if (!position) continue;
      const result = renamePositionLayers(positionGroup, position);
      renamedLayers += result.renamedLayers;
      groupCount++;
    }

    try { await selectLayerById(root.id as number); } catch (_) {}
  });

  return "Renamed " + renamedLayers + " target layer" + (renamedLayers === 1 ? "" : "s")
    + " across " + groupCount + " position group" + (groupCount === 1 ? "" : "s")
    + " in " + rootName + ".";
};

export const runTeamXIFormationBuilder = async (options: TeamXIFormationBuilderOptions): Promise<string> => {
  const doc = await activeDocument();
  let result: FormationBuildResult | null = null;

  await withHistory(doc, "Build XI Formation", async () => {
    result = await buildFormation(photoshop.app.activeDocument as any, options);
    if (result.parentGroupId) {
      try { await selectLayerById(result.parentGroupId); } catch (_) {}
    }
  });

  return buildSummary(result ? [result] : []);
};

export const runTeamXIFormationBuilderBatch = async (options: TeamXIFormationBuilderOptions[]): Promise<string> => {
  const selected = options.filter(option => TEAM_XI_FORMATION_ROWS[String(option.formation ?? "")]);
  if (!selected.length) throw new Error("Select at least one formation to build.");

  const doc = await activeDocument();
  const results: FormationBuildResult[] = [];

  await withHistory(doc, "Build XI Formations", async () => {
    for (const option of selected) {
      const result = await buildFormation(photoshop.app.activeDocument as any, option);
      results.push(result);
    }

    const lastParentId = results[results.length - 1]?.parentGroupId;
    if (lastParentId) {
      try { await selectLayerById(lastParentId); } catch (_) {}
    }
  });

  return buildSummary(results);
};
