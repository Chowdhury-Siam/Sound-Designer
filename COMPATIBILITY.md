# Candidate compatibility and installation paths

All statuses are candidate-specific: `PASS` needs evidence; `FAIL` identifies a defect; `BLOCKED` identifies missing environment/input. This candidate is unpublished and not native-certified. Detailed execution logs and hashes are retained locally rather than included in the public repository documentation.

| Target | Declared floor / architecture | Status | Evidence or missing requirement |
| --- | --- | --- | --- |
| Shared static code | Windows/macOS/Linux | PASS for local Windows checks; BLOCKED for remote matrix execution | Types, shared-source tests, audio/storage mocks and packaging tests; no native claim |
| Adobe Premiere Pro | Manifest 15.4+, CEP 11 / Chromium 88 | BLOCKED | Candidate-specific Windows Premiere session and Mac sessions unavailable |
| Adobe After Effects | Manifest 18.4+, CEP 11 / Chromium 88 | BLOCKED | Current hash-specific full preview/FX/drag/insertion/segment and installer acceptance evidence missing |
| DaVinci Resolve Studio | Target 20.1+, Windows x64 | BLOCKED | Official Windows PE/x64 addon and audited payload build available; current native candidate session not certified |
| DaVinci Resolve Studio | Target 20.1+, macOS Intel x64 | BLOCKED | Mac environment, matching native addon/runtime and full native matrix missing |
| DaVinci Resolve Studio | Target 20.1+, macOS Apple Silicon arm64 | BLOCKED | Mac environment, matching native addon/runtime and full native matrix missing |
| Windows unified setup | Windows x64; EXE | BLOCKED | Clean matching supplied ZXP and candidate EXE assembly/audit are recorded in Phase 6; actual elevation/install/upgrade/rollback/native acceptance missing |
| macOS unified setup | Native Installer distribution PKG | BLOCKED | Mac SDK/environment, actual choices/receipts/install/rollback, Developer ID Installer credentials, notarization/stapling missing |

Minimum versions in manifests are **declared constraints**, not a tested support range. Windows ARM64 Resolve, Free Resolve and Linux Workflow Integration hosting are not claimed. Universal Mach-O header support is an audit feature, not certification of universal native loading or Rosetta. Historical Windows user confirmation applies to earlier payloads only.

## Installation and data paths

| Material | Windows | macOS |
| --- | --- | --- |
| Adobe system payload | `%CommonProgramFiles(x86)%\Adobe\CEP\extensions\com.rksound.designer` | `/Library/Application Support/Adobe/CEP/extensions/com.rksound.designer` |
| Resolve system payload | `%ProgramData%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.sound.designer.resolve` | `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.sound.designer.resolve` |
| Per-user pointer and credential file | `%APPDATA%\SoundDesigner\storage-location.json` and `credentials.json` | `~/Library/Application Support/SoundDesigner/storage-location.json` and `credentials.json` |
| Portable data | User-selected writable SoundDesigner root; both hosts must choose the same root | Same |

User-scoped development CEP installs can shadow system installs; remove or relocate only a deliberately selected old development payload after backup/review. The evidence build can expose a pre-existing development symlink to `dist/cep`; it does not install the system candidate. Credentials are excluded from portable manifests and payloads. Installers do not write user pointers or change media folders.

## Host limitations

- Resolve launches its own Electron application bundle, so the macOS application menu can show **Electron**. SoundDesigner's window title, rounded icon and menu actions remain branded. The experimental native menu helper was removed after Resolve rejected its different signing Team ID; no host bundle or security settings are modified. The PKG builder preserves the Resolve SDK module's vendor signature rather than re-signing it.
- Adobe requires a saved project for prepared media and an active composition/timeline for insertion. Browser preview cannot certify host operations.
- Resolve uses native project IDs; current non-WAV handoff prepares WAV even when shared Adobe conversion settings differ. Selected Fairlight-track placement and Edit fallback need real-host evidence.
- Native drag can display a path-labelled target preview; no custom target label or Soundly-equivalent latency claim is made. Pending conversion can fall back to insertion; measure actual behavior per host.
- SFX Assistant maps After Effects layers and Resolve edit/marker analysis differently. Placement frame, gain, mono/stereo and partial-batch behavior need current native evidence.
- Preview/processing codec support follows each embedded runtime's decoders. OGG/Opus/long-file playback must be tested to the actual end; indexing an extension does not establish decoding support.
- Portable manifests use exclusive cross-host locks and verified copy/migration. Windows filesystem/mock tests pass; actual two-host concurrency, removable/read-only/case-sensitive volume handling and interrupted native operations remain BLOCKED.
- Credentials share one machine-local plaintext user file. Moving the portable root to another machine does not transfer the key. Shared clearing persists and does not migrate a stale key back in.

## Dependency security review

The final pre-release audit removed the unused Babel 6 preset and refreshed compatible dependencies without migrating Svelte 5 or Vite 6 to another major version. The lockfile records the exact tested versions; release and CI builds must use `bun install --frozen-lockfile`.

`bun audit` still reports one high-severity, build-time advisory: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) in `braces@3.0.3`, reached through `fast-glob` in the CEP build toolchain. The advisory lists no patched version. The candidate payloads do not ship this build dependency, and the finding is not evidence of an installed audio-feature exploit. Do not build untrusted source or accept user-controlled build glob patterns. The advisory remains open for release risk review; it has not been suppressed or claimed fixed.

## macOS verification

Obtain `WorkflowIntegration.node` from the supported Resolve SDK. Record SDK provenance, addon SHA-256, Resolve/macOS versions and the actual Resolve/Electron runtime architecture. Do not install a Windows-built payload on a Mac or rebuild the addon against an unrelated Electron/Node runtime. Header checks do not prove ABI compatibility or native loading.

Run on the target Mac, using `x64` for an Intel runtime or `arm64` for an Apple Silicon runtime:

```sh
export RESOLVE_WORKFLOW_NODE='/absolute/path/from/Resolve/SDK/WorkflowIntegration.node'
export RESOLVE_TARGET_ARCH=arm64
bun install --frozen-lockfile
bun run check && bun run check:resolve && bun run test:resolve
bun run test:audio && bun run test:search-tabs
bun run build:adobe && bun run build:resolve
shasum -a 256 "$RESOLVE_WORKFLOW_NODE"
```

Do not set `ALLOW_MISSING_NATIVE=1` for native acceptance. Before development installation, close Resolve and inspect `resolve/scripts/install-dev.ts`. It stages the new copy first, retains the previous plugin outside the discovery directory and restores it if replacement fails. A legacy-ID plugin must be backed up and moved explicitly; it is never deleted automatically. Obtain the required `/Library` write permission and preserve existing data.

Record native results separately for each architecture claimed:

- Verify shared UI/preload/addon loading, cloud networking, waveform, preview and settings persistence.
- Select the same portable root in both hosts; verify settings, libraries, favorites, labels, pins and memories in both directions. Test unavailable/read-only/external volumes, permissions, Unicode names, case-sensitive APFS, concurrent writes and interrupted root copying.
- Drag original WAV, converted audio, FX-rendered audio, segments and Assistant audio into Media Pool and timeline. Verify the non-empty drag image, intended audio/name, duplicates and measured cold/warm latency.
- Test mono/stereo insertion, Fairlight-track placement, absolute/drop-frame timing, project switching, stale requests, cancellation and import-folder restoration. Verify Adobe handoff and playback/FX too.
- Test native PKG Customize choices, receipts, permissions, clean installs, upgrades, rollback and preservation of the other target and user data. Complete signing, notarization, stapling and Gatekeeper checks before release.

POSIX paths preserve case and literal backslashes; metadata identities use Unicode NFC. Older Adobe Mac project IDs used lowercase hashes, so the corrected identity may create a new generated-audio directory. Old directories remain intact; no automatic migration or deletion is performed.

Resolve prepared-media directories now hash the complete native project ID to prevent different projects sharing one folder. This can create a new generated-media directory for an existing project; older media and timeline references remain untouched. Library scans reject stale commits when another host changes the index: refresh and retry rather than overwrite the other host's work.

For rollback and receipt/signing requirements see [RELEASING.md](RELEASING.md#rollback-and-troubleshooting). Storage onboarding and source-preserving migration are documented in [README](README.md#shared-storage-onboarding-and-migration).
