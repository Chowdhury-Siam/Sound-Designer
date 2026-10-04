# Phase 0 Resolve Studio smoke record

Do not mark a row passed from browser or mock evidence. Record the Resolve version, operating system, tester, date, exact steps, and observed result.

## Environment

- Resolve Studio version: `21.0.2.4`
- Operating system and version: `Microsoft Windows 11 IoT Enterprise LTSC 10.0.26100`
- WorkflowIntegration module version: bundled with Resolve Studio `21.0.2.4` (native binary has no Windows product-version field)
- SoundDesigner version: `0.1.0-alpha.1`
- Tester: user-confirmed native smoke run
- Date: `2026-08-29`

## Windows rerun - 2026-09-26

- Built and installed the production artifact against Resolve Studio `21.0.2.4`; all 41 automated tests and the artifact audit passed.
- Resolve loaded `com.sound.designer.resolve` with Workflow Integration interface v2 and opened the packaged Svelte UI in a disposable project.
- Local WAV streaming reported the real duration, decoded stereo channels, advanced playback, and applied live processing after enabling Electron custom-protocol streaming.
- Full and selected processed audio inserted into the timeline, created compatible tracks when occupied, and appeared under the root `SoundDesigner` Media Pool bin.
- Native drag from SoundDesigner into the Edit timeline was accepted; the independent Resolve scripting inspector confirmed the resulting timeline and Media Pool items.
- Resolve closed cleanly, unloaded the plug-in, and reopened the same project and plug-in without startup errors.
- Selected-track Fairlight insertion, locked/disabled-track behavior, and stale project-switch cancellation remain release-candidate checks rather than inferred passes.

## Required checks

| Check | Windows | macOS | Evidence / notes |
| --- | --- | --- | --- |
| Plugin appears under Workspace > Workflow Integrations | Pass | Not tested | Resolve launched `com.sound.designer.resolve` from the Workflow Integrations menu. |
| Svelte renderer loads without DevTools or navigation errors | Pass | Not tested | User-confirmed rendered production UI; custom protocol, preload, and packaged paths exercised. |
| Project ID and name match the active project | Pass | Not tested | Native UI and independent inspector matched `Emdad Bhai_AIML_2026-08-25`. |
| Timeline ID, name, page, and playhead match Resolve | Pass | Not tested | Timelines `01` and `02`, Edit page, playhead, start/end frames, and 30 fps were read natively. |
| Exact root `SoundDesigner` bin is created once | Pass | Not tested | Inspector found one exact root bin and repeated operations reused it. |
| WAV imports into that bin | Pass | Not tested | Multiple local WAV files imported and were independently visible through Resolve scripting. |
| Previous Media Pool folder is restored | Not independently observed | Not tested | Covered by integration tests; retain for a later focused native regression. |
| Repeated import reuses the existing item | Pass | Not tested | Native activity log reported existing-item reuse; bin inspection showed no duplicate for the tested path. |
| WAV inserts audio-only at the playhead | Pass | Not tested | User confirmed; insertion now checks channel compatibility, full-duration overlap, and post-insert presence. |
| Disabled and locked tracks are skipped | Not tested | Not tested | |
| No available track creates the requested mono/stereo track | Not independently observed | Not tested | Covered by integration regression; retain for a focused native smoke run. |
| Project or timeline switch aborts stale work | Not tested | Not tested | |
| Native drag accepted by Media Pool | Pass | Not tested | User confirmed one-gesture native WAV drag; dragged media appeared in the `SoundDesigner` bin. |
| Native drag accepted by Edit timeline | Pass | Not tested | User confirmed one-gesture native WAV drag; dragged audio appeared on Edit audio tracks. |
| Native drag accepted by Fairlight timeline | Not tested | Not tested | |
| Close calls WorkflowIntegration.CleanUp without destabilizing Resolve | Not tested | Not tested | |

## Gate decision

- [x] Windows Phase 0 accepted
- [ ] macOS Phase 0 accepted
- [x] Product decision recorded for any one-gesture drag limitation — not required on the tested Windows host because one-gesture native drag was accepted.
- [x] Full parity migration authorized to begin
