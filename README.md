# RAW PREVIEW

A Photoshop UXP panel for comparing Adobe Camera Raw XMP presets against the active document.

## What it does

- Persists a selected XMP preset folder using a UXP persistent token.
- Finds `.xmp` presets recursively and groups them by folder.
- Renders a thumbnail from a temporary duplicate of the active Photoshop document.
- Applies a selected preset to the active layer.

The supplied `BankseyModded.xmp` and `BrownSport.xmp` are compatible with the preset reader. In the panel, select `H:\Documents\XMPs` as the preset folder.

## Development

```powershell
npm ci
npm ci --prefix webview-ui
npm run build:all
```

Load the project folder in Adobe UXP Developer Tool and test with an open RGB document. Use **Render preview** on each supplied preset, then compare the result to Photoshop's Camera Raw Filter using the same XMP file. The Camera Raw Filter action descriptor is isolated in `src/api/tools/cameraRawPresetPreview.ts` for this validation.

## Important behaviour

Rendering never changes the source document: it duplicates the document, applies the Camera Raw descriptor to the duplicate, encodes a small JPEG preview, then closes the duplicate without saving. Applying a preset changes the current active layer, so use a Smart Object first when you want Photoshop's editable Smart Filter workflow.
