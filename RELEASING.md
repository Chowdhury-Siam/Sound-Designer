# SoundDesigner release procedure

The panel checks the public GitHub repository `iboyshanto/SoundDesigner` for the latest stable GitHub Release. It accepts semantic tags such as `v1.2.3`, ignores drafts and prereleases, and selects the Windows EXE or macOS DMG for the current platform.

## One-time setup

1. Create the public repository `https://github.com/iboyshanto/SoundDesigner` or change `UPDATE_REPOSITORY` in `src/js/main/updater.ts` before the first public build.
2. Run `bun run certificate:create` once and enter a strong password when prompted. This creates `.signing/SoundDesigner-publisher.p12` without printing or storing the password.
3. Securely back up the certificate and password. The `.signing` directory is ignored by Git; never commit or publish the certificate.
4. Test the signed package and platform installer on macOS and Windows.
5. If Freesound is enabled in a commercial release, obtain the required API-use permission from Freesound and verify that the release UX preserves creator, source URL, and license metadata.

## Publish a stable update

1. Update `version` in `package.json` using semantic versioning, for example `1.2.3`.
2. Build and sign with the same publisher identity. The command automatically finds the local certificate and securely prompts for its password:

   ```sh
   bun run release:package
   ```

   CI may instead provide `SOUNDDESIGNER_ZXP_CERT` and `SOUNDDESIGNER_ZXP_PASSWORD` through secrets. The GitHub workflow expects `SOUNDDESIGNER_ZXP_CERT_BASE64` and `SOUNDDESIGNER_ZXP_PASSWORD`.

3. Verify the internal signed ZXP, then install and smoke-test the generated EXE and DMG in supported Premiere Pro and After Effects versions.
   Include a saved-project Freesound download, unsupported local audio conversion, optional −1 dBFS normalization, Project-panel `SoundDesigner` organization, and a project-switch cache check.
4. Commit the source/version change and push it. Create the tag `v1.2.3` from that exact commit.
5. Add `.github/releases/vX.Y.Z.md` with the release notes before tagging. The tag workflow builds with the persistent publisher certificate and creates a draft release containing:
   - `SoundDesigner-v1.2.3-Windows-Setup.exe`
   - `SoundDesigner-v1.2.3-macOS.dmg`
   - `SoundDesigner.png`
6. Verify the draft's ZXP signature, manifest version, Windows install and macOS drag install, then publish it as the latest stable release. Existing installations will discover it during their next automatic check (at most once per 24 hours), or immediately from Settings > Updates > Check now. Confirm the public latest-release endpoint and test the updater with the previous and new installed versions.

## Platform installers

- Windows uses the custom SoundDesigner setup UI and installs system-wide to `%CommonProgramFiles(x86)%\Adobe\CEP\extensions\com.rksound.designer`. It requests administrator access and safely replaces an older installation.
- macOS uses the native drag-to-install pattern. Open the branded DMG and drag `SoundDesigner` onto `Adobe CEP Extensions`; Finder requests administrator access for the system extension directory when needed.
- The macOS DMG does not contain a custom installer app, so it needs no separate app signing or notarization. Its extension payload is still the signed ZXP produced by the release job.
- Run `bun run test:installers` before tagging. Platform artifacts themselves are built on their matching GitHub runners.

## Safety contract

- The running extension never downloads into its installation directory, executes a file, or silently replaces itself.
- Release and asset URLs must belong to the configured GitHub repository.
- A missing compatible installer falls back to the GitHub Release page so installation guidance remains visible.
- GitHub errors, rate limits, offline hosts, malformed versions, and oversized responses fail gracefully; a previously verified cached result remains usable.
- The update check runs in panel JavaScript through CEP Node HTTPS. It does not cross `evalScript` and does not modify the ES3 ExtendScript host layer.
