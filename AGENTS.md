# Agent Notes

This repo has a lot of behaviour that only becomes obvious after testing inside Photoshop/UXP. Prefer these notes over guesses from reading the code alone.

## Validate In Photoshop, Not Just TypeScript

- Symptom: Several changes built successfully but failed only after loading the plugin in Photoshop, especially folder tokens, focus handoff, and text-layer edits.
- Rule: Treat `npm run build:all` as necessary but not sufficient. For Photoshop-facing behaviour, ask for or perform a UXP Developer Tool test before committing/releasing unless the user explicitly wants an immediate package.

## UXP/Photoshop Issues We Hit

- Symptom: Some flag/badge source files opened as Indexed Color/background documents and then failed during replacement with errors like `Cannot read properties of undefined (reading 'targetLayersIDs')`, `The command "Set" is not currently available`, or `The command "<unknown>" is not currently available`.
- Rule: Before duplicating from an opened asset document, convert Indexed Color documents to RGB and make the background layer into a normal layer. This was verified as the fix for rectangle flag insertion failures.

- Symptom: Replaying raw Listener output often included notifier events or menu commands that looked plausible but failed in UXP.
- Rule: Strip Listener output down to the stable action descriptor that actually changes the document. Do not replay notifier events such as history/modal state changes.

- Symptom: Windows local-file paths failed or resolved to the wrong place when joining cache roots and relative badge paths.
- Rule: Normalize cache-root joins carefully. Avoid duplicating path segments like `badges/club-badges/badges/club-badges`, and convert Windows paths to file URLs consistently before calling `localFileSystem.getEntryWithUrl`.

- Symptom: UXP panel actions could leave Photoshop's layer panel unfocused, so pressing Delete/Backspace did nothing until the canvas was clicked.
- Rule: Keep the focus-release helper wired to tool actions and buttons. This is a Photoshop focus handoff issue, not a normal React focus bug.

## Release Workflow

- Symptom: `gh` was not installed, but releases were still created successfully.
- Rule: Use `npm version x.y.z --no-git-tag-version`, `npm run ccx`, commit, tag, and `git push origin main --tags`. Create the GitHub release through the REST API using `git credential fill` for the saved GitHub credential, then upload `ccx/com.bolt.uxp.bankseytoolbox_PS.ccx`.

- Symptom: The packaged CCX is generated into `ccx/` and is not the source of truth for commits.
- Rule: Commit source/version changes, not the release artefact unless the user specifically asks. The release asset is attached to GitHub Releases.

## Windows Shell Edits

- Symptom: PowerShell rejected `&&` with `The token '&&' is not a valid statement separator`.
- Rule: Run chained git/npm commands as separate shell calls in this workspace.

- Symptom: `apply_patch` failed to write some files earlier in the session, especially `src/api/photoshop.ts`; later it worked on other files.
- Rule: Try `apply_patch` first for normal edits. If it fails to write, use a tightly scoped Node script that replaces exact snippets, then inspect the diff.

## Encoding In UI Text

- Symptom: The Back button rendered as mojibake/garbled arrow text; ellipsis labels also rendered incorrectly in some places.
- Rule: Keep UI labels ASCII where practical. Use `Back`, `Selecting...`, and `Renaming...` instead of arrows or ellipses. If a mojibake string will not replace cleanly, replace the whole JSX line.

## Text Replacer

- Symptom: `text_1` sometimes jumped from about `24 pt` to about `94 pt` while other text layers stayed correct. Duplicating a good layer and renaming it still reproduced the issue, so it was tied to the replace path/name flow rather than a bad original layer.
- Rule: Do not use the simple `layer.textItem.contents = value` setter for Text Replacer. Use descriptor-based text replacement that reads `textKey` and writes back resized `textStyleRange` and `paragraphStyleRange`, preserving the original style. The user verified this fixed the blow-up.

## CSV To Group Asset Mappings

- Symptom: The backend already accepted multiple badge/flag mappings, but the UI only allowed one and the run payload used `cleanMappings.slice(0, 1)`.
- Rule: Do not reintroduce single-mapping truncation. CSV to Group must pass all configured `badgeMappings` and `flagMappings`; the UI should allow adding/removing multiple mapping rows.

- Symptom: The user needed two different badge Smart Objects in the same duplicated group.
- Rule: Support mapping either different CSV columns to different Smart Objects, or the same CSV column to multiple Smart Objects.

## Tweet Filler Avatar Folder

- Symptom: The avatar folder was lost after leaving Tweet Filler and returning to it.
- Rule: Keep the first-render restore and in-memory fallback in `TweetFillerTool`. The user verified the folder was retained when backing out of and reopening the Tweet Filler menu.

- Symptom: Displaying the full native path made the Tweet Filler UI noisy.
- Rule: Show only the folder name in the button, while keeping token/path details internally.

- Symptom: The folder was not retained after closing Photoshop because the previous `getDataFolder()` write path silently swallowed failures and never created the settings file.
- Rule: Store Tweet Filler settings through the UXP Node-style `fs` API at `plugin-data:/tweet-filler-settings.json`, verify each write by reading it back, and retain the persistent folder token plus native-path fallback. The settings file and token were verified after a full Photoshop restart.

- Symptom: After the backend folder token survived restart, the Tweet Filler button still did not show the restored folder name.
- Rule: Hydrate from `getTweetAvatarFolder()` on first render and retry briefly while the webview bridge becomes ready. Keep the frontend fallback, but make the backend settings file the first source after restart.

- Symptom: Folder persistence appeared inconsistent between UXP Developer Tool and an installed CCX.
- Rule: Developer and installed builds use separate plugin storage namespaces. Select the folder once in each environment and test restart persistence without switching between them.

## Focus Handoff

- Symptom: After running some tools, Delete/Backspace in Photoshop's Layers panel did nothing until the canvas was clicked.
- Rule: Keep the focus-release behaviour around tool actions. If adding new tool buttons or long-running flows, make sure they call the existing focus-release helper in the same pattern as nearby tools.

## Photoshop Dialogs And Listener Output

- Symptom: Listener output often contained notifier events or menu commands like `<unknown>`, `Copy`, or `Move` that were not replayable in UXP and produced "command is not currently available."
- Rule: Listener snippets are useful clues, not drop-in fixes. Prefer stable `batchPlay` descriptors that are already proven in this codebase.

## Image/Asset Folder Defaults

- Symptom: Some file pickers defaulted to only JPG or PNG while the user expected all supported image types.
- Rule: For image file pickers/searches, default to all supported image extensions unless a tool has a verified reason to narrow the type.
