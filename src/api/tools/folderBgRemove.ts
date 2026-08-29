import { photoshop } from "../../globals";
import { asModal } from "bolt-uxp-utils/ps";

const batchPlay = (descs: object[], opts: object = {}) =>
  (photoshop.action.batchPlay as any)(descs, opts) as Promise<any[]>;

const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "psd", "psb", "gif", "heic", "heif"]);

interface ImageFileJob {
  file: any;
  outputFolder?: any;
}

export interface FolderBgRemoveOptions {
  mode: "folder" | "files";
  folderToken?: string;
  fileTokens?: Array<string | { token: string; folderToken?: string }>;
  recursive?: boolean;
  skipTransparent?: boolean;
  deleteOriginalNonPng?: boolean;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function baseName(name: string): string {
  return String(name ?? "image").replace(/\.[^.]+$/i, "") || "image";
}

function nativePathToFileUrl(nativePath: string): string {
  const slashPath = nativePath.replace(/\\/g, "/");
  return /^[a-zA-Z]:\//.test(slashPath) ? `file:/${slashPath}` : `file:${slashPath}`;
}

function replaceExtension(nativePath: string, extension: string): string {
  return nativePath.replace(/\.[^\\/]*$/i, extension);
}

async function readFolderEntries(folder: any): Promise<any[]> {
  if (typeof folder?.getEntries !== "function") return [];
  return Array.from<any>(await folder.getEntries());
}

async function listImageFiles(folder: any, recursive: boolean, out: ImageFileJob[] = []): Promise<ImageFileJob[]> {
  const entries = await readFolderEntries(folder);
  for (const entry of entries) {
    const name = String(entry.name ?? "");
    if (entry.isFile && EXTENSIONS.has(fileExtension(name))) {
      out.push({ file: entry, outputFolder: folder });
    } else if (entry.isFolder && recursive) {
      await listImageFiles(entry, recursive, out);
    }
  }
  return out;
}

async function getFolderFromToken(folderToken?: string): Promise<any | null> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  if (!folderToken) return null;
  return fs.getEntryForSessionToken(folderToken);
}

async function getFilesFromTokens(fileTokens?: Array<string | { token: string; folderToken?: string }>): Promise<ImageFileJob[]> {
  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const files: ImageFileJob[] = [];
  for (const item of fileTokens ?? []) {
    const token = typeof item === "string" ? item : item.token;
    const folderToken = typeof item === "string" ? "" : item.folderToken;
    const entry = await fs.getEntryForSessionToken(token);
    if (!entry?.isFile || !EXTENSIONS.has(fileExtension(String(entry.name ?? "")))) continue;

    let outputFolder: any = null;
    if (folderToken) {
      try { outputFolder = await fs.getEntryForSessionToken(folderToken); } catch (_) {}
    }
    files.push({ file: entry, outputFolder });
  }
  return files;
}

async function deselect(): Promise<void> {
  try {
    await batchPlay([{
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      to: { _enum: "ordinal", _value: "none" },
      _options: { dialogOptions: "dontDisplay" },
    }], {});
  } catch (_) {}
}

function getDocumentModeName(doc: any): string {
  const mode = doc?.mode;
  return String(mode?._value ?? mode?.value ?? mode ?? "");
}

async function convertDocumentToRgbLayer(doc: any): Promise<void> {
  photoshop.app.activeDocument = doc;

  if (getDocumentModeName(doc) !== "RGBColorMode" && getDocumentModeName(doc) !== "rgbColorMode") {
    try {
      await batchPlay([{
        _obj: "convertMode",
        to: { _class: "RGBColorMode" },
        _options: { dialogOptions: "dontDisplay" },
      }], {});
    } catch (_) {}
  }

  try {
    await batchPlay([{
      _obj: "set",
      _target: [{ _ref: "layer", _property: "background" }],
      to: {
        _obj: "layer",
        name: "Layer 0",
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" },
      },
      _options: { dialogOptions: "dontDisplay" },
    }], {});
  } catch (_) {}
}

async function removeBackgroundFromActiveLayer(): Promise<void> {
  try {
    await batchPlay([{
      _obj: "removeBackground",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    return;
  } catch (_) {}

  await batchPlay([{
    _obj: "autoCutout",
    sampleAllLayers: false,
    _options: { dialogOptions: "dontDisplay" },
  }], {});

  await batchPlay([{
    _obj: "make",
    new: { _class: "channel" },
    at: { _ref: "channel", _enum: "channel", _value: "mask" },
    using: { _enum: "userMaskEnabled", _value: "revealSelection" },
    _options: { dialogOptions: "dontDisplay" },
  }], {});
}

async function activeLayerIsBackground(): Promise<boolean> {
  try {
    const result = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    return Boolean(result[0]?.background);
  } catch (_) {
    return false;
  }
}

async function activeLayerHasTransparentPixels(): Promise<boolean> {
  try {
    await batchPlay([{
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      to: { _ref: "channel", _enum: "channel", _value: "transparencyEnum" },
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    await batchPlay([{ _obj: "inverse", _options: { dialogOptions: "dontDisplay" } }], {});
    const selection = await batchPlay([{
      _obj: "get",
      _target: [
        { _property: "selection" },
        { _ref: "document", _enum: "ordinal", _value: "targetEnum" },
      ],
      _options: { dialogOptions: "dontDisplay" },
    }], {});
    await deselect();
    return Boolean(selection[0]?.selection);
  } catch (_) {
    await deselect();
    return false;
  }
}

async function isAlreadyTransparent(doc: any): Promise<boolean> {
  if (await activeLayerIsBackground()) return false;
  try {
    if (doc.layers && doc.layers.length > 1) return false;
  } catch (_) {
    return false;
  }
  return activeLayerHasTransparentPixels();
}

async function getOutputFile(fileEntry: any, outputFolder?: any): Promise<any> {
  if (fileExtension(String(fileEntry.name ?? "")) === "png") return fileEntry;

  const { localFileSystem: fs } = (require("uxp") as any).storage;
  const nativePath = String(fileEntry.nativePath ?? "");
  if (nativePath && typeof fs.createEntryWithUrl === "function") {
    const outputPath = replaceExtension(nativePath, ".png");
    try {
      return await fs.createEntryWithUrl(nativePathToFileUrl(outputPath), { overwrite: true });
    } catch (_) {}
  }

  const folderPath = String(outputFolder?.nativePath ?? "");
  if (folderPath && typeof fs.createEntryWithUrl === "function") {
    const separator = folderPath.includes("\\") ? "\\" : "/";
    const outputPath = `${folderPath.replace(/[\\/]+$/g, "")}${separator}${baseName(String(fileEntry.name ?? ""))}.png`;
    try {
      return await fs.createEntryWithUrl(nativePathToFileUrl(outputPath), { overwrite: true });
    } catch (_) {}
  }

  const parent = outputFolder ?? fileEntry.parent;
  if (!parent || typeof parent.createFile !== "function") {
    throw new Error("Could not create output PNG beside the source file.");
  }
  return parent.createFile(`${baseName(String(fileEntry.name ?? ""))}.png`, { overwrite: true });
}

async function deleteEntry(fileEntry: any): Promise<void> {
  if (typeof fileEntry.delete === "function") {
    await fileEntry.delete();
  } else if (typeof fileEntry.remove === "function") {
    await fileEntry.remove();
  }
}

async function processImageFile(
  job: ImageFileJob,
  options: Required<Pick<FolderBgRemoveOptions, "skipTransparent" | "deleteOriginalNonPng">>
): Promise<"processed" | "skipped"> {
  let doc: any = null;
  const fileEntry = job.file;
  const originalExtension = fileExtension(String(fileEntry.name ?? ""));

  try {
    doc = await photoshop.app.open(fileEntry);
    photoshop.app.activeDocument = doc;

    if (options.skipTransparent && await isAlreadyTransparent(doc)) {
      await doc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
      doc = null;
      return "skipped";
    }

    await convertDocumentToRgbLayer(doc);
    try {
      if (doc.layers && doc.layers.length > 1 && typeof doc.flatten === "function") {
        await doc.flatten();
        await convertDocumentToRgbLayer(doc);
      }
    } catch (_) {}

    await removeBackgroundFromActiveLayer();
    await deselect();
    try { await doc.trim(photoshop.constants.TrimType.TRANSPARENT); } catch (_) {}

    const outFile = await getOutputFile(fileEntry, job.outputFolder);
    await doc.saveAs.png(outFile, { compression: 6, interlaced: false }, true);
    await doc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
    doc = null;

    if (options.deleteOriginalNonPng && originalExtension !== "png") {
      try { await deleteEntry(fileEntry); } catch (_) {}
    }

    return "processed";
  } finally {
    try {
      if (doc) await doc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES);
    } catch (_) {}
  }
}

export const runFolderBgRemove = async (options: FolderBgRemoveOptions): Promise<string> => {
  const warnings: string[] = [];

  await asModal("Folder BG Remove", async () => {
    const skipTransparent = options.skipTransparent ?? true;
    const deleteOriginalNonPng = options.deleteOriginalNonPng ?? true;
    const files = options.mode === "folder"
      ? await listImageFiles(await getFolderFromToken(options.folderToken), options.recursive ?? false)
      : await getFilesFromTokens(options.fileTokens);

    if (!files.length) {
      throw new Error(options.mode === "folder" ? "Choose a folder containing images first." : "Choose one or more image files first.");
    }

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const job of files) {
      try {
        const result = await processImageFile(job, { skipTransparent, deleteOriginalNonPng });
        if (result === "skipped") skipped++;
        else processed++;
      } catch (e: any) {
        failed++;
        warnings.push(`${job.file?.name ?? "Image"}: ${e?.message ?? String(e)}`);
      }
    }

    warnings.unshift(`Done - ${processed} processed, ${skipped} skipped, ${failed} failed.`);
  });

  return warnings.join("\n");
};
