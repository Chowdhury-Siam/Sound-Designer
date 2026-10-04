# SoundDesigner Resolve release-candidate checklist

Record the plug-in version, Resolve Studio version, OS build, native module source, tester, and date. Restart Resolve after installing the candidate.

## Startup and project safety

- [ ] SoundDesigner opens from **Workspace → Workflow Integrations** with the original product UI and no diagnostic dashboard.
- [ ] Opening, closing, and reopening the window does not destabilize Resolve.
- [ ] Project name and project-scoped storage change correctly when switching projects, including projects with the same display name.
- [ ] Switching project or timeline during a pending mutation aborts safely and does not modify the new context.

## Local library

- [ ] Add two library roots and confirm nested hierarchy, supported formats, counts, labels, pins, and favorites.
- [ ] Search, multiple tabs, folder scoping, filters, sorting, and result density persist correctly.
- [ ] Rescan additions/removals, cancel a large scan, restart SoundDesigner, and verify the last valid index remains intact.
- [ ] Removing a library only removes its index; source files remain untouched.

## Preview, waveform, selection, and effects

- [ ] Preview short and long WAV, AIFF, MP3, M4A/AAC, FLAC, OGG/Opus, and any platform-supported WMA/CAF samples to their real end.
- [ ] Seek near the end, loop, auto-preview, switch selections quickly, and confirm playback never stops at the old partial-preview boundary.
- [ ] Verify mono/stereo channel waveforms, zoom, keyboard seeking, selection handles, and selection-only audition.
- [ ] Verify reverse, gain, pitch, speed, pitch lock, reset, full-sound rendering, and selected-segment rendering.
- [ ] Confirm original source files are unchanged and different effect settings create distinct prepared outputs.

## Freesound and offline behavior

- [ ] With no key, local libraries continue to work and the UI explains how to add a key.
- [ ] With a valid personal key, combined local/cloud search, pagination, license filters, preview, waveform, attribution, download progress, and cancellation work.
- [ ] Insert and drag a cloud result; confirm one cached source, prepared WAV, and license metadata sidecar are created for the active project.
- [ ] Test invalid key, rate limit, offline mode, timeout, and window close during a request; no secret appears in logs or UI errors.

## Cloud SFX and assistant

- [ ] Search, preview, favorite, download, cache, drag, and insert a live Cloud SFX result.
- [ ] Confirm Cloud SFX remains optional and local browsing works while the provider is offline or disabled.
- [ ] Analyze current clip, timeline edits, and timeline markers at every density.
- [ ] Preview and replace suggestions, apply offset and gain, disable individual moments, and place a batch.
- [ ] Confirm stale-timeline cancellation, exact frames, Media Pool reuse, non-overlapping tracks, and partial-batch guidance.

## Resolve handoff

- [ ] Drag a prepared WAV into the Media Pool, Edit timeline, and Fairlight timeline.
- [ ] Drag local non-WAV and cloud audio in one gesture; verify preparation feedback and automatic playhead insertion when native target drag cannot remain active.
- [ ] Use Insert and double-click at several playheads; verify audio-only placement, correct absolute frame, and `SoundDesigner` bin organization.
- [ ] Test mono and stereo sources, occupied tracks, disabled tracks, locked tracks, explicit tracks, and automatic track creation.
- [ ] On Fairlight, choose **Selected Fairlight track** and confirm insertion on the selected audio track.
- [ ] On Edit, use the selected-track setting and confirm the reported playhead fallback is correct and creates no duplicate clip.
- [ ] Verify repeated import reuses the Media Pool item and repeated prepared settings reuse the same project file.

## Updates, persistence, and artifact

- [ ] Automatic and manual stable-release checks handle current, available, offline-cache, rate-limit, and no-public-release states.
- [ ] Download opens only the trusted repository release URL and never installs silently.
- [ ] Restart Resolve and verify settings, libraries, metadata, and cached prepared media persist.
- [ ] Run `bun run build`; record the test count and artifact audit output.
- [ ] Inspect the assembled artifact for the correct manifest/version/native module and no source maps, credentials, CEP/JSX/ZXP files, local paths, or development URLs.
- [ ] Uninstall the plug-in and confirm Resolve starts cleanly; preserve or remove user cache according to the release policy.

## Acceptance

- [ ] Windows accepted
- [ ] macOS accepted
- [ ] All failures above are fixed or explicitly removed from claimed compatibility
