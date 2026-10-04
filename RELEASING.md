# SoundDesigner release readiness and handoff

The current candidate is **unpublished**. See [compatibility](COMPATIBILITY.md) for remaining native verification requirements. Do not commit, push, tag, production-sign, publish or archive it without separate authorization. The existing public `v1.0.4` release is historical; this dirty candidate is not a replacement release.

## CI boundaries

| Job | Environment | What it proves |
| --- | --- | --- |
| `shared-static` | Windows/macOS/Linux | Types, shared-source boundary, mock/backend tests, artifact negative tests; no native claim |
| `adobe-build` | Windows/macOS | Unsigned release-clean CEP/JSX payload and strict audit |
| `resolve-build` | Windows/macOS, manual dispatch | Shared UI/native backend packaging with supplied matching SDK input; PE/Mach-O/CPU checks, not ABI certification |
| `windows-installer` | Windows | Candidate EXE assembly from already signed matching Adobe input; embedded payload audit |
| `macos-installer` | macOS | Unsigned native selectable distribution PKG; receipt identity and extracted-payload audit |
| `artifact-audit` | Windows/macOS | Rechecks actual embedded/expanded installer payloads and available SHA-256 sidecars |
| `native-certification` | Manual evidence | Explicit BLOCKED reminder; never inferred from green CI |

`.github/workflows/main.yml` runs on main pushes, pull requests and manual dispatch with `contents: read`. It has no publication job, release-tag trigger, publisher certificate restore or signing operation. Normal runs skip SDK/installer jobs. Explicit `native_candidates=true` dispatch requires:

- `RESOLVE_WORKFLOW_NODE_WINDOWS_BASE64`: official Windows x64 SDK addon.
- `RESOLVE_WORKFLOW_NODE_MACOS_BASE64`: official addon supporting the runner's arm64 Resolve runtime. An Intel candidate needs a separately configured x64 runner/module and independent native evidence.
- `SOUNDDESIGNER_CANDIDATE_ZXP_BASE64`: separately approved, existing signed Adobe ZXP whose non-signature file hashes match the current candidate Adobe payload.

Missing inputs fail with `BLOCKED` messages. A filesystem path alone does not supply a module/certificate. Workflow edits were locally reviewed/tested; a remote Actions run is separate evidence. The native-certification reminder's successful shell exit is not certification.

## Reproduce the unsigned candidate

From this repository only, with Bun 1.3.14 and a matching Windows SDK addon or explicitly supplied Mac addon:

```sh
bun install --frozen-lockfile
bun run build:adobe:candidate
bun run build:resolve
bun run audit:artifacts
bun run test:artifact-audit
bun run test:audio
bun run test:search-tabs
bun run test:installers
node scripts/phase6-evidence.mjs
```

The evidence runner creates a fresh `output/phase6/<timestamp>/` containing command logs, candidate commit/dirty status, versions, file-level SHA-256 inventories and `evidence.json`. Existing installer inputs are audited against the new payloads; stale/contaminated ones are `FAIL`, not quietly reused. It never invokes production signing, system setup, publication or source-control mutation. Product build logs can contain diagnostic paths; those logs are evidence only, never payload files.

On Windows, after a clean matching signed input is independently supplied, `SOUNDDESIGNER_CANDIDATE_EXE` optionally requests an unsigned candidate assembly at a **new** path. For example, set it to `output/phase6/windows-candidate/SoundDesigner-v1.0.4-Windows-Setup.exe`, then run `node scripts/phase6-evidence.mjs output/phase6/new-evidence-directory`. The runner captures the builder, embedded-payload audit, unsigned signature observation and final hashes. Existing output paths are refused. This does not production-sign, install or certify the EXE.

Payloads: `dist/cep/` and `resolve/dist/plugin/com.sound.designer.resolve/`. The candidate build removes only the CEP tool's generated `.debug` and empty `node_modules` directory; any actual dependencies, maps, caches, logs, fixture/source files, credentials, dev URLs, local checkout paths or browser-demo material cause rejection. Both manifests and runtime package versions must match root `package.json`. Resolve accepts one compiled shared UI script/stylesheet and no CEP/JSX. Source-boundary tests reject a second renderer/component/style tree.

Runtime schema/property names such as `freesoundApiKey` are necessary code, not embedded credentials. The audit rejects credential files, private keys and literal credential assignments. This is a concrete guard, not proof against every possible obfuscation; native SDK provenance and final signer trust require manual verification.

## Candidate installer handoff

Do not run `release:package` or `installer:windows:build` during an unsigned handoff: both sign the Adobe ZXP. After separate permission and provision of a matching signed input, the candidate-only builders can run:

`bun run installer:windows:build` builds both payloads, signs the ZXP, then automatically sets `SOUNDDESIGNER_INSTALLER_CANDIDATE=1` for the EXE step. Its output is an unpublished, unsigned EXE candidate, not native certification or release approval. To finish after ZXP signing already succeeded, reuse that input with `$env:SOUNDDESIGNER_INSTALLER_CANDIDATE = '1'; bun run installer:windows` instead of repeating the full chain.

```powershell
$env:SOUNDDESIGNER_INSTALLER_CANDIDATE = '1'
$env:SOUNDDESIGNER_ZXP = 'absolute-path-to-matching-signed-input.zxp'
$env:SOUNDDESIGNER_INSTALLER_OUTPUT = 'absolute-path-to-new-unpublished-candidate.exe'
bun run installer:windows
```

On a Mac, set the corresponding variables, `RESOLVE_WORKFLOW_NODE` and matching `RESOLVE_TARGET_ARCH`, build Resolve on that Mac, then run `bun run installer:macos`. Existing outputs are refused. No setup is executed by a builder. Candidate EXEs/PKGs are not production-signed/notarized. The ZXP is an internal input, not a public release asset.

Windows regression tests compile the current C# worker and execute install/upgrade/rollback/traversal/wrong-module/partial-success cases in scratch directories. Mac script syntax and Distribution choice JavaScript tests do not establish native installation, receipts, permission behavior or recovery. Capture Windows presentation with `node scripts/installer-screenshot.mjs`; capture the native Mac welcome/Customize/completion pages and `pkgutil --pkg-info` outputs on the actual tested Mac. Screenshots must omit credentials and user data.

## Native certification evidence

For each claimed OS, host version and architecture, record exact candidate file hashes, SDK origin/hash, host/runtime version, tester/date, and real preview-to-end, mono/stereo, FX, warm/cold drag, import/insertion, selected-track/playhead behavior, segments, project switching, cancelled/stale operations and source preservation. Test both hosts against the same selected storage root, concurrent writes, migration, restart, unavailable/read-only/external volumes and shared credential migration/update/clearing.

Installers must pass Adobe-only, Resolve-only, both, zero choices, cancel, elevation/permissions, running-host refusal, clean install, upgrade, failed upgrade rollback, retained-backup recovery, independent-target failure/retry and data-preserving uninstall. Actual compatibility rows remain `BLOCKED` until candidate-specific evidence is attached. Historical user confirmation is not certification of these new hashes.

## macOS release asset and signing gate

The canonical asset is **`SoundDesigner-vX.Y.Z-macOS.pkg`**; DMG is optional wrapping only. Both hosts use the same updater implementation, which selects PKG ahead of legacy DMG and rejects cross-platform assets. Tests execute the actual scoring function; CI uploads `.pkg` plus `.pkg.sha256`, never a DMG in place of the unified installer.

The native distribution has independent Customize choices and stable component receipts:

- `com.rksound.designer.pkg.adobe`
- `com.sound.designer.pkg.resolve`

Both receipt versions must match the candidate; their `--nopayload` scripts manage fixed-path host files, so receipts do not enumerate installed media files. On an actual test Mac verify `installer -showChoicesXML -pkg <candidate.pkg>`, per-choice installs, `pkgutil --pkg-info <receipt-id>`, and exact target payload hashes. Retain screenshots and command outputs.

Only after **separate production-signing approval**, `SOUNDDESIGNER_PHASE4_APPROVED=1`, `SOUNDDESIGNER_SIGNING_APPROVED=1`, valid native signatures, and provisioned keychain identities/profile, may the existing Mac production builder use Developer ID **Installer** (`SOUNDDESIGNER_MAC_INSTALLER_IDENTITY`), optional Developer ID Application native signing (`SOUNDDESIGNER_MAC_CODE_IDENTITY`), and `SOUNDDESIGNER_MAC_NOTARY_PROFILE`.

Capture and verify `codesign --verify --strict`, `pkgutil --check-signature`, `xcrun notarytool submit --wait` (Accepted), `xcrun stapler staple`, `xcrun stapler validate`, `spctl --assess --type install`, and a clean downloaded-package installation. Those operations are **BLOCKED** in this Windows handoff and were not performed. A signature metadata file or header audit does not verify publisher trust/notarization.

## Rollback and troubleshooting

Close the affected host first. Restore a separately retained known-good host payload at the exact [installation path](COMPATIBILITY.md#installation-and-data-paths); record its original hash. Do not point the host at the other platform's addon. No backup/archive is created automatically by this Phase 6 handoff.

- A failed target swap restores that target's `.previous` when possible; other successful targets remain installed. Retained `.previous`, `.failed-*` and lock files require inspection before retrying. After a power interruption, restore the retained old tree before clearing an orphaned lock; never erase recovery material to force success.
- Successful setup normally cleans its own `.previous`, so it is not a general downgrade archive. Preserve a known-good payload separately before approved native testing. Do not roll back to an old plugin while a new native mutation is pending.
- Leave the selected portable root, `sounddesigner.json`, media, manifest backups and machine-local pointer/credentials intact. A storage-root change retains the old root; switching back requires explicitly adopting that intact folder in Settings. Review manifest backup recovery if the current manifest is invalid.
- Uninstall only the chosen host's exact payload directory. On Mac, `pkgutil --forget <that receipt-id>` alone does not uninstall script-managed files. After moving/removing the payload, forget only its receipt; preserve the other target and all user data.
- Credential mismatch: open the updated host containing the old local key first, then refocus the other updated host. A shared key wins over stale local values; an explicitly cleared key is not resurrected. The machine-local file is user-accessible plaintext, not an encrypted keychain.
- Resolve loading failure: verify Studio edition, native OS/CPU, SDK source, addon ABI and runtime. Do not rebuild against an unrelated Node/Electron version. Mac permission/architecture/signature failures require the actual target Mac.

## Later publication — separately authorized

Approve the audited candidate and complete all blocked native/signing/installer evidence first. Choose a new release version if replacing the already published historical `v1.0.4`; update the root version and Resolve manifest together, rebuild/audit/re-certify, and add matching release notes. Only separate authorization permits committing, tagging, production-signing or publishing. The current workflow does none of these; a green run cannot publish a release.

The updater ignores drafts/prereleases, checks trusted repository URLs, falls back to the release page when no compatible asset exists, and never silently installs an update. Verify both hosts' live current/available/offline/cache behavior before publication.
