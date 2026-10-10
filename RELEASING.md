# SoundDesigner release readiness and handoff

See [compatibility](COMPATIBILITY.md) for remaining native verification requirements. The read-only readiness workflow does not publish candidates. The separate automatic release workflow publishes version bumps after regression checks, Adobe payload signing and installer audits succeed. Public unsigned EXE/PKG distribution is intentional; publication does not establish native certification, installer publisher trust or macOS notarization.

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

- `resolve/vendor/windows/WorkflowIntegration.node`: bundled Windows x64 addon, included in the checkout.
- `resolve/vendor/macos/WorkflowIntegration.node`: bundled Mac addon supporting the arm64 Resolve target, included in the checkout. An Intel candidate needs a separately configured x64 target and independent native evidence. No native-module Base64 secrets are required.
- `SOUNDDESIGNER_CANDIDATE_ZXP_BASE64`: separately approved, existing signed Adobe ZXP whose non-signature file hashes match the current candidate Adobe payload.

Missing inputs fail with `BLOCKED` messages. A filesystem path alone does not supply a module/certificate. Workflow edits were locally reviewed/tested; a remote Actions run is separate evidence. The native-certification reminder's successful shell exit is not certification.

The separate [release banner action](.github/workflows/release-banner.yml) runs after a release is published. Its job has `contents: write` only to embed the commit-pinned artwork in existing release notes and attach the SVG. It does not publish drafts, replace installer assets, or change the readiness/signing gates. See [banner integration](docs/BANNER.md#release-description) for prerequisites and automated-publisher behavior.

## Automatic version releases

[`.github/workflows/release.yml`](.github/workflows/release.yml) runs on `main` pushes and compares the current `package.json` version with the version before the push. A strict `X.Y.Z` increase starts release builds; unchanged versions do not publish and decreases fail. No special commit message or manually pushed tag is required. Update the Resolve manifest to match and add `.github/releases/vX.Y.Z.md` in the same push. The notes' first line must be `# SoundDesigner vX.Y.Z — Your release title`; the remaining Markdown becomes the description.

Configure these repository **Secrets** in **Settings → Secrets and variables → Actions**, preserving the existing Adobe publisher identity:

| Secret | Purpose |
| --- | --- |
| `SOUNDDESIGNER_ZXP_CERT_BASE64` | Existing Adobe publisher P12 encoded as Base64 |
| `SOUNDDESIGNER_ZXP_PASSWORD` | Adobe publisher certificate password |

The release matrix targets Windows x64 and macOS arm64 with the bundled matching Resolve modules. Each runner performs regression checks, builds/audits Resolve and builds/signs its matching Adobe ZXP. Signing files are removed afterward. Missing Adobe credentials fail explicitly; CI never creates a new publisher identity. No Resolve Base64 module secrets are required.

**Unsigned installer policy:** the release workflow deliberately uses `SOUNDDESIGNER_INSTALLER_CANDIDATE=1` to assemble the outer EXE and PKG without claiming native certification or outer-installer signing. The user approved distributing the unsigned Mac installer after their Mac testing. Apple signing/notarization credentials and the production-only approval flags are not required for this path. Regression, native-module presence/OS/CPU checks and embedded-payload audits are still mandatory. The SDK module's vendor signature is retained. The PKG is not notarized and the EXE has no Authenticode publisher signature; OS security warnings may appear. Disclose this in each version's release notes. The signed Adobe ZXP inside the installers is a separate signature, not outer-installer trust. The optional signed/notarized Mac assembly path below still retains its original approval requirements.

Only after **both** installer jobs succeed does the publisher verify exact-version installer checksums and stage a private release. It uploads the EXE, PKG, their SHA-256 sidecars and the release SVG, checks uploaded digests/sizes, then publishes with `draft: false`, `prerelease: false` and latest status. The banner is embedded directly because releases created with `GITHUB_TOKEN` do not trigger the separate banner workflow. The internal Adobe ZXP, signing certificates and build directories are never public assets. Failed uploads leave an unpublished draft for inspection; reruns resume matching assets without overwriting them. Existing public releases and drafts/tags targeting another commit are never replaced.

To release an already-pushed version such as **v1.0.5**, first push this workflow, then choose **Actions → Build and publish version release → Run workflow**, select **main**, and enable **publish_release**. This retries the current package version; it does not require an artificial second version bump. If a failed private draft belongs to a different commit or contains mismatched assets, inspect it manually before retrying rather than deleting recovery evidence automatically.

Local checks: `node --test scripts/release-automation.test.mjs scripts/release-banner.test.mjs` and `bun run test:installers`. They do not certify native signing, installation or a live release run.

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

On Windows, after a clean matching signed input is independently supplied, `SOUNDDESIGNER_CANDIDATE_EXE` optionally requests an unsigned candidate assembly at a **new** path. For example, set it to `output/phase6/windows-candidate/SoundDesigner-v1.0.5-Windows-Setup.exe`, then run `node scripts/phase6-evidence.mjs output/phase6/new-evidence-directory`. The runner captures the builder, embedded-payload audit, unsigned signature observation and final hashes. Existing output paths are refused. This does not production-sign, install or certify the EXE.

Payloads: `dist/cep/` and `resolve/dist/plugin/com.sound.designer.resolve/`. The candidate build removes only the CEP tool's generated `.debug` and empty `node_modules` directory; any actual dependencies, maps, caches, logs, fixture/source files, credentials, dev URLs, local checkout paths or browser-demo material cause rejection. Both manifests and runtime package versions must match root `package.json`. Resolve accepts one compiled shared UI script/stylesheet and no CEP/JSX. Source-boundary tests reject a second renderer/component/style tree.

Runtime schema/property names such as `freesoundApiKey` are necessary code, not embedded credentials. The audit rejects credential files, private keys and literal credential assignments. This is a concrete guard, not proof against every possible obfuscation; native SDK provenance and final signer trust require manual verification.

## Candidate installer handoff

Do not run `release:package`, `installer:windows:build` or `installer:macos` during an unsigned handoff: all sign the Adobe ZXP. After separate permission and provision of a matching signed input, the candidate-only assembly commands can run:

`bun run installer:windows:build` builds both payloads, signs the ZXP, then automatically sets `SOUNDDESIGNER_INSTALLER_CANDIDATE=1` for the EXE step. Its output is an unpublished, unsigned EXE candidate, not native certification or release approval. To finish after ZXP signing already succeeded, reuse that input with `$env:SOUNDDESIGNER_INSTALLER_CANDIDATE = '1'; bun run installer:windows` instead of repeating the full chain.

```powershell
$env:SOUNDDESIGNER_INSTALLER_CANDIDATE = '1'
$env:SOUNDDESIGNER_ZXP = 'absolute-path-to-matching-signed-input.zxp'
$env:SOUNDDESIGNER_INSTALLER_OUTPUT = 'absolute-path-to-new-unpublished-candidate.exe'
bun run installer:windows
```

On a Mac, `bun run installer:macos` builds Resolve, builds/signs the Adobe ZXP, and assembles an unsigned test PKG in one fail-fast chain. It reuses `SOUNDDESIGNER_ZXP_CERT` or `.signing/SoundDesigner-publisher.p12`. If neither is present/configured, local packaging creates a new local certificate and prompts for a password (minimum 12 characters) and confirmation; signing then asks for that password again unless `SOUNDDESIGNER_ZXP_PASSWORD` is set. This is a new publisher identity, not your original release identity: restore the original certificate for updates requiring that identity. Missing explicit certificate paths and missing CI certificates fail without automatic replacement. This command uses the freshly generated ZXP and automatically selects candidate mode for PKG assembly.

For a prebuilt-input handoff or production assembly, set the corresponding variables and matching `RESOLVE_TARGET_ARCH`, build Resolve on that Mac, then run `bun run installer:macos:assemble`. Readiness CI uses existing ZXP inputs; release CI builds/signs the ZXP before this assembly-only command. Existing outputs are refused; set `SOUNDDESIGNER_INSTALLER_OUTPUT` to a new path for another build. No setup is executed by a builder. Candidate EXEs/PKGs are not production-signed/notarized. The ZXP is an internal input, not a public release asset.

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

Only after **separate production-signing approval**, `SOUNDDESIGNER_PHASE4_APPROVED=1`, `SOUNDDESIGNER_SIGNING_APPROVED=1`, valid native signatures, and provisioned keychain identities/profile, may the existing Mac production builder use Developer ID **Installer** (`SOUNDDESIGNER_MAC_INSTALLER_IDENTITY`) and `SOUNDDESIGNER_MAC_NOTARY_PROFILE`. The Resolve SDK module retains its vendor signature; the builder verifies it without re-signing it.

Capture and verify `codesign --verify --strict`, `pkgutil --check-signature`, `xcrun notarytool submit --wait` (Accepted), `xcrun stapler staple`, `xcrun stapler validate`, `spctl --assess --type install`, and a clean downloaded-package installation. Those operations are **BLOCKED** in this Windows handoff and were not performed. A signature metadata file or header audit does not verify publisher trust/notarization.

## Rollback and troubleshooting

Close the affected host first. Restore a separately retained known-good host payload at the exact [installation path](COMPATIBILITY.md#installation-and-data-paths); record its original hash. Do not point the host at the other platform's addon. No backup/archive is created automatically by this Phase 6 handoff.

- A failed target swap restores that target's `.previous` when possible; other successful targets remain installed. Retained `.previous`, `.failed-*` and lock files require inspection before retrying. After a power interruption, restore the retained old tree before clearing an orphaned lock; never erase recovery material to force success.
- Successful setup normally cleans its own `.previous`, so it is not a general downgrade archive. Preserve a known-good payload separately before approved native testing. Do not roll back to an old plugin while a new native mutation is pending.
- Leave the selected portable root, `sounddesigner.json`, media, manifest backups and machine-local pointer/credentials intact. A storage-root change retains the old root; switching back requires explicitly adopting that intact folder in Settings. Review manifest backup recovery if the current manifest is invalid.
- Uninstall only the chosen host's exact payload directory. On Mac, `pkgutil --forget <that receipt-id>` alone does not uninstall script-managed files. After moving/removing the payload, forget only its receipt; preserve the other target and all user data.
- Credential mismatch: open the updated host containing the old local key first, then refocus the other updated host. A shared key wins over stale local values; an explicitly cleared key is not resurrected. The machine-local file is user-accessible plaintext, not an encrypted keychain.
- Resolve loading failure: verify Studio edition, native OS/CPU, SDK source, addon ABI and runtime. Do not rebuild against an unrelated Node/Electron version. Mac permission/architecture/signature failures require the actual target Mac.

## Publication requirements

Review native-host and installer results, update the root version and Resolve manifest together, and add matching release notes including the unsigned-installer disclosure. With the existing Adobe credentials configured, pushing a version increase to `main` authorizes the automatic unsigned-installer release pipeline described above. An unchanged-version push only runs readiness/release-detection checks; the readiness workflow itself never publishes. The optional production-signed Mac path still requires its separate approvals and Apple credentials.

The updater ignores drafts/prereleases, checks trusted repository URLs, falls back to the release page when no compatible asset exists, and never silently installs an update. Verify both hosts' live current/available/offline/cache behavior before publication.
