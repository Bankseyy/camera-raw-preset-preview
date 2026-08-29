import { photoshop } from "../../globals";
import { withHistory } from "../psHistory";
import {
  replaceBadgeSmartObjectContents,
  resetClubBadgeAssetResolver,
  resolveBadgeDropperAsset,
} from "./badgeDropper";
import { setTextLayerContents } from "./textReplacer";

type VisibilitySnapshot = {
  layer: any;
  visible: boolean;
};

export interface LayerCompsCsvOptions {
  csvText: string;
  heading?: string;
}

type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

function normalizedName(value: unknown): string {
  return String(value ?? "").trim();
}

function nameKey(value: unknown): string {
  return normalizedName(value).toLocaleLowerCase();
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  cells.push(current.trim());
  return cells;
}

function parseCsv(csvText: string): ParsedCsv {
  const lines = String(csvText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const firstLineIndex = lines.findIndex(line => line.trim());
  if (firstLineIndex < 0) return { headers: [], rows: [] };

  const headerLine = lines[firstLineIndex];
  const delimiter = headerLine.includes(";") && !headerLine.includes(",") ? ";" : ",";
  return {
    headers: parseCsvLine(headerLine, delimiter),
    rows: lines
      .slice(firstLineIndex + 1)
      .filter(line => line.trim())
      .map(line => parseCsvLine(line, delimiter)),
  };
}

function targetPrefix(heading: string): string {
  const base = normalizedName(heading)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base ? `${base}_` : "";
}

function compHeadingTarget(header: string): string | null {
  const match = normalizedName(header).match(/^(.+?)\s*\(x\)\s*$/i);
  return match ? normalizedName(match[1]) : null;
}

function isStandardCsvHeading(header: string): boolean {
  const key = nameKey(header);
  return key === "name" || key === "badge" || key === "flag";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasVisibility(layer: any): boolean {
  try {
    return typeof layer?.visible === "boolean";
  } catch (_) {
    return false;
  }
}

function isGroupLayer(layer: any): boolean {
  try {
    return layer?.kind === "group" || layer?.typename === "LayerSet";
  } catch (_) {
    return false;
  }
}

function collectVisibilitySnapshots(groups: any[]): VisibilitySnapshot[] {
  const snapshots = new Map<number, VisibilitySnapshot>();

  const add = (layer: any) => {
    const id = Number(layer?.id);
    if (!id || snapshots.has(id)) return;
    snapshots.set(id, { layer, visible: Boolean(layer.visible) });
  };

  for (const target of groups) {
    add(target);
    let parent = target.parent;
    while (parent) {
      if (hasVisibility(parent)) add(parent);
      parent = parent.parent;
    }
  }

  return Array.from(snapshots.values());
}

function setCompVisibility(groups: any[], activeGroup: any): void {
  const activeId = Number(activeGroup.id);
  for (const group of groups) {
    group.visible = Number(group.id) === activeId;
  }

  let parent = activeGroup.parent;
  while (parent) {
    if (hasVisibility(parent)) parent.visible = true;
    parent = parent.parent;
  }
}

async function restoreVisibility(snapshots: VisibilitySnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    try {
      snapshot.layer.visible = snapshot.visible;
    } catch (_) {}
  }
}

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

async function selectLayerById(id: number, add = false): Promise<void> {
  const descriptor: any = {
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  };
  if (add) {
    descriptor.selectionModifier = {
      _enum: "selectionModifierType",
      _value: "addToSelection",
    };
  }
  await batchPlay([descriptor], {});
}

async function getLayerDescriptorById(id: number): Promise<any | null> {
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

function isGroupDescriptor(descriptor: any): boolean {
  const section = descriptor?.layerSection?._value;
  return section === "layerSectionStart" || descriptor?.layerKind === 7;
}

function findLayerById(parent: any, id: number): any | null {
  try {
    for (const layer of Array.from<any>(parent?.layers ?? [])) {
      if (Number(layer?.id) === id) return layer;
      if (isGroupLayer(layer)) {
        const found = findLayerById(layer, id);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

function collectLayerPanelOrder(parent: any, order: Map<number, number>): void {
  try {
    for (const layer of Array.from<any>(parent?.layers ?? [])) {
      const id = Number(layer?.id);
      if (id > 0 && !order.has(id)) order.set(id, order.size);
      if (isGroupLayer(layer)) collectLayerPanelOrder(layer, order);
    }
  } catch (_) {}
}

async function getExplicitSelectedGroups(doc: any): Promise<any[]> {
  const documentInfo = await batchPlay([{
    _obj: "get",
    _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" },
  }], {});
  const targetLayers = Array.from<any>(documentInfo[0]?.targetLayers ?? []);
  const groupIds = new Set<number>();

  for (const target of targetLayers) {
    try {
      const layerTarget = Number.isFinite(Number(target?._id))
        ? { _ref: "layer", _id: Number(target._id) }
        : { _ref: "layer", _index: Number(target?._index) + 1 };
      const result = await batchPlay([{
        _obj: "get",
        _target: [layerTarget],
        _options: { dialogOptions: "dontDisplay" },
      }], {});
      const descriptor = result[0];
      const id = Number(descriptor?.layerID);
      if (id > 0 && isGroupDescriptor(descriptor)) groupIds.add(id);
    } catch (_) {}
  }

  if (!groupIds.size) {
    try {
      const active = await batchPlay([{
        _obj: "get",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        _options: { dialogOptions: "dontDisplay" },
      }], {});
      const descriptor = active[0];
      const id = Number(descriptor?.layerID);
      if (id > 0 && isGroupDescriptor(descriptor)) groupIds.add(id);
    } catch (_) {}
  }

  const groups = Array.from(groupIds)
    .map(id => findLayerById(doc, id))
    .filter((layer): layer is any => Boolean(layer && isGroupLayer(layer)));
  const selectedIds = new Set(groups.map(group => Number(group.id)));

  const selectedGroups = groups.filter(group => {
    let parent = group.parent;
    while (isGroupLayer(parent)) {
      if (selectedIds.has(Number(parent.id))) return false;
      parent = parent.parent;
    }
    return true;
  });

  const panelOrder = new Map<number, number>();
  collectLayerPanelOrder(doc, panelOrder);

  // Layer Comps are appended, so create them in the Layers panel's top-to-bottom order.
  return selectedGroups.sort((first, second) => (
    (panelOrder.get(Number(first.id)) ?? Number.MAX_SAFE_INTEGER)
      - (panelOrder.get(Number(second.id)) ?? Number.MAX_SAFE_INTEGER)
  ));
}

async function restoreSelection(ids: number[]): Promise<void> {
  if (!ids.length) return;

  for (let index = 0; index < ids.length; index++) {
    await selectLayerById(ids[index], index > 0);
  }
}

function collectAllLayers(parent: any, output: any[]): void {
  try {
    for (const layer of Array.from<any>(parent.layers ?? [])) {
      output.push(layer);
      collectAllLayers(layer, output);
    }
  } catch (_) {}
}

function collectIndexedTargets(doc: any, prefix: string): { targets: Map<number, any>; duplicateIndexes: Set<number> } {
  const allLayers: any[] = [];
  collectAllLayers(doc, allLayers);

  const targets = new Map<number, any>();
  const duplicateIndexes = new Set<number>();
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, "i");

  for (const layer of allLayers) {
    const match = normalizedName(layer?.name).match(pattern);
    if (!match) continue;

    const index = Number(match[1]);
    if (!Number.isFinite(index) || index < 1) continue;
    if (targets.has(index)) duplicateIndexes.add(index);
    else targets.set(index, layer);
  }

  return { targets, duplicateIndexes };
}

type IndexedTargetSet = ReturnType<typeof collectIndexedTargets>;

function targetForRow(
  targets: IndexedTargetSet,
  prefix: string,
  rowIndex: number,
  notes: string[]
): any | null {
  const targetIndex = rowIndex + 1;
  const targetName = `${prefix}${targetIndex}`;
  if (targets.duplicateIndexes.has(targetIndex)) {
    notes.push(`${targetName}: multiple matching layers`);
    return null;
  }

  const target = targets.targets.get(targetIndex);
  if (!target) {
    notes.push(`${targetName}: target not found`);
    return null;
  }

  return target;
}

async function applySmartObjectLayerComp(hostDoc: any, layer: any, requestedName: string): Promise<boolean> {
  const layerId = Number(layer?.id);
  if (!layerId) throw new Error("Target layer is missing its Photoshop ID.");

  photoshop.app.activeDocument = hostDoc;
  await selectLayerById(layerId);
  const descriptor = await getLayerDescriptorById(layerId);
  if (!descriptor?.smartObject) {
    throw new Error(`${normalizedName(layer.name)} is not a Smart Object.`);
  }

  const openDocumentIds = new Set(Array.from<any>(photoshop.app.documents ?? []).map(document => Number(document?.id)));
  await batchPlay([{ _obj: "placedLayerEditContents", _options: { dialogOptions: "dontDisplay" } }], {});
  const smartObjectDocument = photoshop.app.activeDocument as any;
  const shouldClose = !openDocumentIds.has(Number(smartObjectDocument?.id));

  try {
    const comp = Array.from<any>(smartObjectDocument?.layerComps ?? [])
      .find(item => nameKey(item?.name) === nameKey(requestedName));
    if (!comp) return false;

    await comp.apply();
    return true;
  } finally {
    if (shouldClose) {
      await smartObjectDocument.close(photoshop.constants.SaveOptions.SAVECHANGES);
    }
    photoshop.app.activeDocument = hostDoc;
  }
}

async function createOrOverwriteLayerComp(doc: any, groupName: string): Promise<"created" | "overwritten"> {
  const matchingComps = Array.from<any>(doc.layerComps ?? [])
    .filter(comp => nameKey(comp?.name) === nameKey(groupName));

  const options = {
    visibility: true,
    position: true,
    appearance: true,
    childComp: true,
  };

  if (!matchingComps.length) {
    await doc.layerComps.add({ name: groupName, ...options });
    return "created";
  }

  for (const comp of matchingComps) await comp.remove();
  await doc.layerComps.add({ name: groupName, ...options });
  return "overwritten";
}

export const runLayerCompsFromSelectedLayers = async (): Promise<string> => {
  const doc = photoshop.app.activeDocument as any;

  let created = 0;
  let overwritten = 0;

  await withHistory(doc, "Create Layer Comps From Groups", async () => {
    const selectedTargets = await getExplicitSelectedGroups(doc);
    if (!selectedTargets.length) {
      throw new Error("Select one or more group layers first.");
    }

    const selectedIds = selectedTargets
      .map(target => Number(target.id))
      .filter(id => Number.isFinite(id) && id > 0);
    const targetNames = selectedTargets.map(target => normalizedName(target.name));
    if (targetNames.some(name => !name)) {
      throw new Error("Every selected layer needs a name.");
    }
    const visibilitySnapshots = collectVisibilitySnapshots(selectedTargets);
    try {
      for (const target of selectedTargets) {
        setCompVisibility(selectedTargets, target);
        const outcome = await createOrOverwriteLayerComp(doc, normalizedName(target.name));
        if (outcome === "created") created++;
        else overwritten++;
      }
    } finally {
      await restoreVisibility(visibilitySnapshots);
      await restoreSelection(selectedIds);
    }
  });

  return `Created ${created} layer comp${created === 1 ? "" : "s"}; overwritten ${overwritten}.`;
};

export const runLayerCompsFromCsv = async (options: LayerCompsCsvOptions): Promise<string> => {
  const csv = parseCsv(options.csvText);
  if (!csv.headers.length || !csv.rows.length) {
    throw new Error("CSV must contain a header row and at least one data row.");
  }

  const findColumn = (heading: string) => csv.headers.findIndex(header => nameKey(header) === nameKey(heading));
  const nameColumnIndex = findColumn("NAME");
  const badgeColumnIndex = findColumn("BADGE");
  const flagColumnIndex = findColumn("FLAG");
  const requestedHeading = normalizedName(options.heading);
  const automaticCompColumns = csv.headers
    .map((header, index) => {
      if (isStandardCsvHeading(header)) return null;
      const target = compHeadingTarget(header) ?? normalizedName(header);
      return target ? { index, heading: target, prefix: targetPrefix(target) } : null;
    })
    .filter((column): column is { index: number; heading: string; prefix: string } => Boolean(column?.prefix));
  const compColumns = requestedHeading
    ? automaticCompColumns.filter(column => nameKey(column.heading) === nameKey(requestedHeading))
    : automaticCompColumns;

  if (requestedHeading && !compColumns.length) {
    throw new Error(`Could not find the "${requestedHeading}" CSV heading.`);
  }

  if (nameColumnIndex < 0 && badgeColumnIndex < 0 && flagColumnIndex < 0 && !compColumns.length) {
    throw new Error("CSV needs at least one heading.");
  }

  const doc = photoshop.app.activeDocument as any;
  const originalSelectionIds = Array.from<any>(doc.activeLayers ?? [])
    .map(layer => Number(layer?.id))
    .filter(id => Number.isFinite(id) && id > 0);
  const targetSets = new Map<string, IndexedTargetSet>();
  const targetsFor = (prefix: string): IndexedTargetSet => {
    const key = prefix.toLocaleLowerCase();
    if (!targetSets.has(key)) targetSets.set(key, collectIndexedTargets(doc, prefix));
    return targetSets.get(key)!;
  };

  let textUpdates = 0;
  let badgeUpdates = 0;
  let flagUpdates = 0;
  let compUpdates = 0;
  let skippedEmpty = 0;
  const notes: string[] = [];

  resetClubBadgeAssetResolver();

  await withHistory(doc, "Fill Layers From CSV", async () => {
    try {
      for (let rowIndex = 0; rowIndex < csv.rows.length; rowIndex++) {
        const row = csv.rows[rowIndex];

        if (nameColumnIndex >= 0) {
          const value = normalizedName(row[nameColumnIndex]);
          if (!value) {
            skippedEmpty++;
          } else {
            const prefix = "name_";
            const target = targetForRow(targetsFor(prefix), prefix, rowIndex, notes);
            if (target) {
              try {
                photoshop.app.activeDocument = doc;
                await setTextLayerContents(target, value);
                textUpdates++;
              } catch (error: any) {
                notes.push(`${prefix}${rowIndex + 1}: ${error?.message ?? String(error)}`);
              }
            }
          }
        }

        const replaceAsset = async (columnIndex: number, type: "badge" | "flag") => {
          if (columnIndex < 0) return;

          const value = normalizedName(row[columnIndex]);
          if (!value) {
            skippedEmpty++;
            return;
          }

          const prefix = `${type}_`;
          const target = targetForRow(targetsFor(prefix), prefix, rowIndex, notes);
          if (!target) return;

          try {
            const asset = await resolveBadgeDropperAsset(
              value,
              type === "badge" ? "club" : "flag",
              "regular",
              "square"
            );
            if (!asset) {
              notes.push(`${prefix}${rowIndex + 1}: no ${type} match for "${value}"`);
              return;
            }

            await replaceBadgeSmartObjectContents(doc, Number(target.id), asset.entry, {
              fitMode: "height",
              keepBaseVisible: type === "flag",
              clipToBase: type === "flag",
            });
            if (type === "badge") badgeUpdates++;
            else flagUpdates++;
          } catch (error: any) {
            notes.push(`${prefix}${rowIndex + 1}: ${error?.message ?? String(error)}`);
          }
        };

        await replaceAsset(badgeColumnIndex, "badge");
        await replaceAsset(flagColumnIndex, "flag");

        for (const column of compColumns) {
          const requestedName = normalizedName(row[column.index]);
          if (!requestedName) {
            skippedEmpty++;
            continue;
          }

          const target = targetForRow(targetsFor(column.prefix), column.prefix, rowIndex, notes);
          if (!target) continue;

          try {
            const applied = await applySmartObjectLayerComp(doc, target, requestedName);
            if (!applied) {
              notes.push(`${column.prefix}${rowIndex + 1}: Layer Comp "${requestedName}" not found`);
              continue;
            }

            compUpdates++;
          } catch (error: any) {
            notes.push(`${column.prefix}${rowIndex + 1}: ${error?.message ?? String(error)}`);
          }
        }
      }
    } finally {
      photoshop.app.activeDocument = doc;
      await restoreSelection(originalSelectionIds);
    }
  });

  const summary = [
    `${textUpdates} name update${textUpdates === 1 ? "" : "s"}.`,
    `${badgeUpdates} badge${badgeUpdates === 1 ? "" : "s"}.`,
    `${flagUpdates} flag${flagUpdates === 1 ? "" : "s"}.`,
    `${compUpdates} Layer Comp${compUpdates === 1 ? "" : "s"}.`,
  ];
  if (skippedEmpty) summary.push(`Skipped ${skippedEmpty} blank cell${skippedEmpty === 1 ? "" : "s"}.`);
  return [...summary, ...notes].join("\n");
};
