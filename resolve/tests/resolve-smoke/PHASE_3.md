# Phase 3 native Resolve smoke test

Build installed on 2026-08-29. Restart DaVinci Resolve Studio before running this checklist.

## Local library

- [ ] Open **Workspace → Workflow Integrations → SoundDesigner** and confirm the library workspace appears without the Phase 0 diagnostic panels.
- [ ] Add a small local sound-effects folder. Confirm indexing progress appears and the complete nested folder hierarchy and sound count match the disk.
- [ ] Add a second folder and confirm both roots remain independent.
- [ ] Search for a sound, focus search with **Ctrl+K**, create a second search tab with the **+** button, and confirm switching tabs preserves each query and selected folder.
- [ ] Exercise **All**, **Favorites**, **Ambience**, and **One shots**, plus name and recently-modified sorting.
- [ ] Favorite a sound and pin a folder. Close and reopen SoundDesigner, then confirm both states persist.
- [ ] Add and remove one audio file on disk, rescan its library root, and confirm the index updates.
- [ ] Start a larger scan, cancel it, and confirm the existing saved library remains usable.
- [ ] Remove a library root from SoundDesigner and confirm its files remain untouched on disk.

## Resolve handoff

- [ ] Drag an indexed WAV into the Media Pool and Edit timeline.
- [ ] With a timeline open, use the row play/add button for a WAV and confirm it appears at the current playhead without overlap.
- [ ] Drag an indexed non-WAV format and confirm SoundDesigner prepares a WAV before the Resolve handoff.
- [ ] Click add-to-timeline for a non-WAV and confirm the prepared WAV is inserted at the current playhead and organized in the `SoundDesigner` Media Pool bin.
- [ ] Record Fairlight drag behavior separately; it is not inferred from Edit-page success.

## Evidence

Record Resolve version, OS, tested folder sizes, formats, and any mismatch before accepting Phase 3. Phase 4 begins only after the local-library workflow is accepted natively.
