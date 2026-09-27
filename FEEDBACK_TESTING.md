# Browsing and Quick FX test candidate

This is a local 1.0.3 candidate, not a published release.

- Pin Library, drag its divider, narrow the dock, reopen the panel: pin and width should persist. Very narrow docks necessarily leave less space for results; unpin to use the drawer.
- Folder navigation badges show total audio including all descendants; tooltips distinguish direct versus recursive counts. Include subfolders is checked on launch; uncheck it in Search scope for direct-folder-only results. Favorites remains global. Empty folders cannot fall back to another folder's results.
- Library and Favorites branches use flat, single-line accordion rows without accumulating indentation. Full library paths are in tooltips. Favorites opens as one compact shortcut; its collection tree is hidden until expanded. Click a pinned folder: ancestor branches open, any folder-tree filter clears, Favorites filtering exits, the drawer stays open, and the original row scrolls into view and receives focus.
- Switch List/Grid, adjust tile size, reopen. The view and size are remembered. Both modes use virtualized results; unanalysed audio shows a neutral baseline, not invented peaks.
- Without selection, the player stays slim. Select to open the waveform inside the bottom player dock: beside playback controls in wide panels, stacked in narrow panels. Results remain visible. Segment selection, zoom, mono/stereo, reverse and Insert stay available. Sound metadata and license are under Sound details. FX opens above the dock and dismisses on outside click or Escape. Hover audition is off by default; enable in Browse options. It starts after 350 ms and cancels on leave, selection, host hand-off, or panel teardown.
- Heart opens destination selection. Main Favorites is the default. Create a collection inside Main or another collection; an existing favorite can move or be removed. These are references, never physical moves/deletes. The top sidebar Favorites entry shows all collections, while Main shows unassigned references.
- Quick FX: peak normalization to −1 dBFS before gain, three-tap 300 ms echo (900 ms tail), short room reflections (320 ms tail), existing gain/pitch/speed/reverse. Reset restores defaults; Bypass retains choices but exports/auditions without rack effects. Preview and Insert render the same settings into separate PCM files, not host effect instances. Global conversion/normalization policy remains separate.
- Noise Reduction is intentionally not shipped in this candidate. Room is a lightweight reflection effect, not a convolution or studio reverb.

Automated checks screen TypeScript/Svelte, folder/collection filtering, browser layout/persistence/hover playback, DSP impulse/normalization/bypass/cancellation, SFX matching, ES3 host syntax, and ZXP signature. They do not prove native AE/Premiere insertion or Windows performance. Test those in both hosts before publishing.

## Floating-tools polish candidate

- FX is now an app-level floating panel, above pinned/drawer sidebars. Its content determines its height; short windows scroll the body while keeping the heading/footer visible. Escape restores focus to FX; outside click dismisses it. Browse options and Sound details use the same app-level layering.
- FX uses aligned parameter rows and a plain FX trigger with an active-effect indicator. The previous fabricated name-length-based relevance percentages were removed, and their row space returned to the sound title/waveform. The unchanged default ordering is now labeled Default.
- Space activates focused buttons normally; global preview playback remains available outside interactive controls. Include subfolders still starts checked.
- `scripts/product-polish-ui-smoke.mjs` injects 10,000 browser-only fixture entries with nested folders, long titles and color labels. It checks virtualization, recursive/direct folder search, real pointer hit-testing over the pinned sidebar, popup bounds, focus restoration and keyboard activation. The fixture never enters the release bundle or reads/writes source audio.
