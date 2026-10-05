<div align="center">

<img alt="SoundDesigner v1.0.3 — More room. More control." src=".github/assets/SoundDesigner.png" width="800">

**Find it. Shape it. Drop it into the edit.**

A project-aware sound-effects workspace for **Adobe Premiere Pro**, **After Effects**, and **DaVinci Resolve Studio**.

See [compatibility and known limitations](COMPATIBILITY.md). Native certification is incomplete; the unified candidate is not available from the public release link.

<p>
  <a href="https://github.com/iboyshanto/SoundDesigner/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/iboyshanto/SoundDesigner?style=for-the-badge&color=f97316&label=Latest"></a>
  <a href="https://github.com/iboyshanto/SoundDesigner"><img alt="Repository size" src="https://img.shields.io/github/repo-size/iboyshanto/SoundDesigner?style=for-the-badge&color=FF8C00"></a>
  <a href="https://github.com/iboyshanto/SoundDesigner/blob/main/LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/iboyshanto/SoundDesigner?style=for-the-badge&color=ea1f26"></a>
  <br>
  <img alt="Svelte 5" src="https://img.shields.io/badge/Powered_by-Svelte_5-ff3e00?style=for-the-badge&logo=svelte&logoColor=white">
  <img alt="Bun" src="https://img.shields.io/badge/Tooling-Bun-fbf0df?style=for-the-badge&logo=bun&logoColor=black">
  <img alt="Adobe CEP 11" src="https://img.shields.io/badge/Platform-Adobe_CEP_11-ea1f26?style=for-the-badge&logo=adobe&logoColor=white">
</p>

[**Website**](https://sounddesigner-web.vercel.app) · [**Download Latest**](https://github.com/iboyshanto/SoundDesigner/releases/latest) · [**Report a Bug**](https://github.com/iboyshanto/SoundDesigner/issues) · [**Release Guide**](RELEASING.md)

</div>

---

## 🧭 Explore

- [Meet SoundDesigner](#meet-sounddesigner)
- [Features](#features)
- [Get started](#get-started)
- [Preview, select and shape](#preview-select-shape)
- [Connect Freesound](#connect-freesound)
- [Project audio and conversion](#project-audio-conversion)
- [Settings](#settings)
- [Development](#development)
- [Publishing](#publishing)
- [Troubleshooting](#troubleshooting)
- [Developers](#developers)
- [License](#license)

---

<a id="meet-sounddesigner"></a>

## ✨ Meet SoundDesigner

SoundDesigner keeps sound design close to the timeline. Browse local folders and Freesound from one panel, inspect real channel waveforms, select the exact moment you need, shape it with realtime effects, and insert it without breaking your creative flow.

> [!IMPORTANT]
> No more scattered media. SoundDesigner automatically creates a `SoundDesigner` bin or folder in the Adobe Project panel and organizes every sound inserted through the extension inside it.

### From search to timeline

```text
Local library + Freesound
           ↓
 Search, filter and preview
           ↓
 Select a segment and shape it
           ↓
 Drag, double-click or Insert
           ↓
 Organized SoundDesigner project media
```

---

<a id="features"></a>

## 💎 Everything You Need to Design Sound

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🔍 One Search, Multiple Libraries</h3>
      <p>Browse preserved local folder trees and optional Freesound results together. Enable either source—or both—from the Library panel.</p>
    </td>
    <td width="50%" valign="top">
      <h3>〰️ Real Audio Waveforms</h3>
      <p>Preview decoded mono and stereo channels, zoom, seek, loop, and see the sound you are actually hearing.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>✂️ Precision Segment Selection</h3>
      <p>Drag across the waveform, refine the selection, audition only that range, then insert or drag exactly the part you need.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎛️ Realtime Sound Shaping</h3>
      <p>Reverse, adjust gain, shift pitch, change speed, or lock pitch while auditioning. The same processing follows the sound into Adobe.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>☁️ Freesound On Demand</h3>
      <p>Search and preview cloud sounds inside the panel. Files download only when you drag or insert them, with visible progress.</p>
    </td>
    <td width="50%" valign="top">
      <h3>⚡ Adobe-Ready Audio</h3>
      <p>Unsupported audio can be converted to 24-bit PCM WAV automatically, with optional peak normalization and no bundled FFmpeg binary.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🗂️ Project-Smart Organization</h3>
       <p>Prepared audio is stored beside the Adobe project or in your chosen central SoundDesigner folder, scoped to the active project. Imported media stays grouped in a dedicated SoundDesigner bin.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📐 Built for Dockable Panels</h3>
      <p>The interface adapts to wide, compact, short, and vertical layouts while keeping the waveform and essential controls available.</p>
    </td>
  </tr>
</table>

### More workflow essentials

- Recursive local-library indexing with the original folder hierarchy preserved.
- Multiple independent search tabs, favorites, filters, sorting, and adjustable result density.
- Auto-preview, looping, channel display controls, waveform zoom, and keyboard navigation.
- Drag-and-drop, double-click insertion, and a dedicated **Insert** action.
- Full-sound and selection-only processing without overwriting the source audio.
- Cached downloads, conversions, waveforms, and rendered segments for faster reuse.
- Stable update checks that open an explicit download instead of silently replacing the extension.

---

<a id="get-started"></a>

## 🚀 Get Started

### Compatibility

| Requirement | Minimum |
| --- | --- |
| **Adobe Premiere Pro** | 15.4 or newer |
| **Adobe After Effects** | 18.4 or newer |
| **Adobe extension runtime** | CEP 11 / Chromium 88 |
| **Resolve candidate target** | Resolve Studio 20.1+ on Windows/macOS with matching SDK addon; native acceptance remains BLOCKED |
| **Installer** | Unified candidate: Windows setup EXE or native macOS PKG (not yet released/certified) |
| **Internet** | Only for Freesound and update checks |

### Install

Public Adobe-only installers remain at [GitHub Releases](https://github.com/iboyshanto/SoundDesigner/releases/latest). The following unified installers are candidate filenames, not published downloads:

- **Windows unified candidate:** run `SoundDesigner-vX.Y.Z-Windows-Setup.exe`, select Adobe, Resolve Studio, or both, then approve elevation. Selections survive elevation; updates are independent per target.
- **macOS unified candidate:** open `SoundDesigner-vX.Y.Z-macOS.pkg` with native Installer and click **Customize** to select Adobe, Resolve Studio, or both. At least one target is required. Destinations are fixed under `/Library/Application Support`.

These unified installers are unreleased and native certification is incomplete. Existing public Adobe-only releases may still provide a DMG; follow their release-specific instructions. Portable data is not installed, migrated, or removed by setup. Choose its folder inside the extension on first launch or in Settings.

Restart Premiere Pro or After Effects, then open **Window → Extensions** or **Window → Extensions (Legacy)** and choose **SoundDesigner**.

For the Resolve candidate, restart **Resolve Studio** and open **Workspace → Workflow Integrations → SoundDesigner**. Free Resolve and Linux Workflow Integration hosting are not claimed. Exact system installation paths and current evidence are in [COMPATIBILITY.md](COMPATIBILITY.md).

### Installer screenshots

![Current Windows setup, both applications selected](docs/windows-installer.png)

This capture renders the current Windows Forms source without installing software. It does not certify elevation, DPI, accessibility or native payload operation. Native macOS Customize/receipt screenshots are **BLOCKED** until a Mac candidate is built and tested; no simulated Mac screenshot is presented as evidence.

### Audio storage and migration

1. **Settings → Audio storage** offers **Beside project** and **Central folder**. Adobe defaults to Beside project, using the v1.0.3 layout, independently of Resolve's central folder. Older Adobe mode files reset to Beside project once because they could inherit Resolve's default; select Central folder again if desired. Subsequent Adobe choices persist. Resolve requires Central folder; Beside project is disabled there.
2. Switching modes or changing the central folder applies to new files. Existing media stays in place, preserving timeline references. Choose an empty writable folder or an existing SoundDesigner folder for central audio.
3. Settings, libraries, favorites, labels and collections are saved automatically in the machine-local SoundDesigner application-data directory, independently of the audio destination. The version-2 `sounddesigner.json` manifest retains cross-host locking and backups. Existing central settings are imported once without changing the source. The Adobe audio mode is saved separately so Resolve cannot overwrite it.
4. Beside project reuses `SoundDesigner/<Project name>/` beside the saved Adobe project. Legacy project audio is not copied or moved automatically. Legacy Resolve pointer/index/memories continue to be imported. Keep legacy folders during candidate testing.
5. The shared Freesound key is machine-local at `%APPDATA%\SoundDesigner\credentials.json` on Windows or `~/Library/Application Support/SoundDesigner/credentials.json` on macOS. Existing per-host keys migrate on opening the updated host; an existing shared key wins. Open updated Resolve first to migrate a key previously entered there, then Adobe. Clearing it is shared. The file is plaintext with user-level access; it is not an encrypted OS vault.

Unavailable/read-only volumes, concurrent native-host use and external-volume permissions still require the manual acceptance matrix. Setup never moves or deletes existing media or credentials.

> [!TIP]
> Save the Adobe project before using cloud audio, conversion, effects rendering, or segment export. SoundDesigner uses the project location to keep prepared media portable and organized.

### Add a local library

1. Select **Add sound folder** in the Library panel.
2. Choose the top-level folder containing your sound effects.
3. Keep **Local** enabled in the source list.
4. Search, browse the folder tree, and select a sound to preview it.
5. Drag it into the timeline or composition, double-click it, or select **Insert**.

SoundDesigner indexes nested folders but leaves every original file where it is. Removing a library from the extension never deletes the source folder.

---

<a id="preview-select-shape"></a>

## 🎧 Preview, Select and Shape

The spectrum preview is a channel-aware waveform editor—not a decorative animation.

### Select the exact moment

- Drag horizontally across the waveform to create a selection.
- Drag either edge to refine the start or end.
- Playback stays inside the selected range and respects looping.
- Drag the highlighted range or choose **Insert segment** to use only that moment.
- Clear the selection to return to the full sound.

### Shape the sound non-destructively

| Effect | Control | What it does |
| --- | --- | --- |
| **Reverse** | On/off | Reverses the full sound or only the active selection |
| **Gain** | −24 dB to +12 dB | Raises or lowers the output level |
| **Pitch** | −12 to +12 semitones | Shifts pitch independently |
| **Speed** | 0.50× to 2.00× | Changes playback speed and rendered duration |
| **Pitch Lock** | Locked/unlocked | Preserves pitch while speed changes |

Effects are previewed in realtime and applied consistently when the sound or selected segment is dragged or inserted. **Reset** returns all controls to their neutral values.

### Useful shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play or pause the extension preview while focus is inside the panel |
| `Ctrl+K` / `Cmd+K` | Focus and select the search field |
| `Escape` | Close the FX rack, settings, drawer, or transient interface |
| `Enter` on waveform | Create a short selection around the playhead |
| Arrow keys | Seek or adjust the focused selection handle |
| `Shift+Arrow` | Make a larger seek or selection adjustment |
| `Home` / `End` | Move a selection boundary to the beginning or end |

Typing inside an input field is never intercepted by preview shortcuts.

---

<a id="connect-freesound"></a>

## ☁️ Connect Freesound

Freesound is optional. When enabled, Local and Freesound become independent sources in the Library panel, so users can search either one or both at the same time.

SoundDesigner uses the official Freesound API with a personal key. It does not scrape the website and does not ship with a shared credential.

### 1. Create a Freesound credential

1. [Create a Freesound account](https://freesound.org/home/register/) or sign in.
2. Open the [API credentials page](https://freesound.org/apiv2/apply/).
3. Create a credential using:

   | Field | Suggested value |
   | --- | --- |
   | **Name** | `SoundDesigner` |
   | **URL** | `https://github.com/iboyshanto/SoundDesigner` |
   | **Callback URL** | `http://freesound.org/home/app_permissions/permission_granted/` |

   SoundDesigner uses token authentication, not an OAuth2 login flow. The callback is the Freesound-provided fallback for desktop and non-server applications.
4. Submit the form and find the new credential in the table.

### 2. Copy the correct key

Copy the long value under **Client secret/API key**—not the shorter **Client ID**.

Treat the key like a password:

- Do not commit it to the repository.
- Do not share it in screenshots, issues, or discussions.
- Do not bundle one personal key with public builds.
- Revoke or regenerate it if it becomes exposed.

### 3. Enable Freesound in SoundDesigner

1. Open **Settings → Freesound**.
2. Enable **Freesound library**.
3. Paste the **Client secret/API key** into **Personal API key**.
4. Choose a license filter and select **Save changes**.
5. Enable **Freesound** in the Library panel.
6. Enter at least two search characters.

**Browse without key** opens Freesound in the default browser. Searching and previewing Freesound inside the panel requires a personal API credential.

> [!WARNING]
> Every Freesound item keeps its own Creative Commons license. CC BY sounds require attribution. Free API access is for non-commercial use; commercial API use must be arranged with Freesound/UPF. Read the official [authentication guide](https://freesound.org/docs/api/authentication.html) and [API terms](https://freesound.org/help/tos_api/).

---

<a id="project-audio-conversion"></a>

## 🗂️ Project Audio and Conversion

Directly supported local audio can be inserted from its original location. With **Beside project**, Adobe uses:

```text
<Project directory>/SoundDesigner/<Project name>/
├── Freesound/Originals/
├── Converted/
├── Processed/
├── Segments/
├── Waveforms/
└── Metadata/
```

With **Central folder**, both hosts use:

```text
<Selected SoundDesigner root>/
└── Projects/
    └── <adobe-or-resolve>/<Project name>--<stable project ID>/
        ├── Downloads/
        ├── Converted/
        ├── Processed/
        ├── Segments/
        ├── Waveforms/
        └── Metadata/
```

| Folder | Purpose |
| --- | --- |
| `Downloads` / `Freesound/Originals` | Provider audio downloaded only when needed |
| `Converted` | Adobe-compatible, normalized, or effect-processed WAV files |
| `Processed` / `Waveforms` | Processed output and reusable waveform data |
| `Segments` | Rendered waveform selections |
| `Metadata` | Source, license, conversion, processing, and selection records |

Prepared filenames use stable fingerprints so valid outputs can be reused without collisions between projects or processing settings.

### Conversion options

- **Convert unsupported audio to WAV** — recommended; prepares only formats outside the direct Adobe compatibility list.
- **Always convert imported audio to WAV** — creates a project-scoped WAV for every sound.
- **Never convert automatically** — passes the original file to Adobe, which may reject unsupported audio.
- **Preserve original level** — keeps the decoded source level.
- **Peak normalize to −1 dBFS** — applies one consistent gain value across all channels.

Converted output is 24-bit PCM WAV with its sample rate and channel count preserved. Temporary files are finalized atomically so cancelled or failed work does not look complete.

> [!NOTE]
> SoundDesigner recognizes many common audio extensions, including WAV, AIFF, MP3, AAC/M4A, FLAC, OGG, Opus, WMA, APE, and WebM audio. Actual preview and conversion still depend on the audio decoders available in CEP 11; an uncommon codec that cannot be decoded is reported instead of being imported as an invalid file.

---

<a id="settings"></a>

## ⚙️ Settings at a Glance

| Setting | Purpose |
| --- | --- |
| **Auto-preview selection** | Starts auditioning when the selected result changes |
| **Loop previews** | Keeps playback running until stopped or another sound is chosen |
| **Playhead / selected clip** | Chooses where Adobe places inserted audio |
| **Adobe compatibility** | Controls automatic WAV conversion |
| **Normalization** | Preserves the source level or peak-normalizes prepared audio |
| **Enable Freesound library** | Adds or removes the optional cloud source |
| **License filter** | Restricts Freesound searches to the chosen license group |
| **Updates** | Checks stable GitHub Releases without installing silently |
| **Audio storage** | Chooses Beside project (Adobe) or Central folder; changes apply to new files |

---

<a id="development"></a>

## 🛠️ Development

The panel is built with **Svelte 5** and **Vite** through the **Bolt CEP** toolchain. Host integrations are compiled separately for ExtendScript/ES3 compatibility.

**Requirements:** [Bun 1.3.14](https://bun.sh/) and Node.js compatibility for CEP packaging and release utilities.

```sh
# Install the locked dependencies
bun install --frozen-lockfile

# Start the development server
bun run dev

# Type-check the Svelte application
bun run check

# Test audio effects and WAV rendering
bun run test:audio

# Test per-tab folder naming and search state
bun run test:search-tabs

# Compile the CEP extension
bun run build
```

`bun run dev` starts the browser development surface. To test Adobe host integration, build or symlink the CEP extension and open it inside a supported Premiere Pro or After Effects version.

### Project map

| Path | Responsibility |
| --- | --- |
| `src/js/main` | Svelte UI, libraries, waveform, Freesound, conversion, and processing |
| `src/js/platform` / `src/js/hosts/adobe` | Shared boundary and Adobe native adapters |
| `resolve` | Backend, preload, native material and two-file shared-UI entry/adapter; no component/style fork |
| `src/jsx/ppro` | Premiere Pro host integration |
| `src/jsx/aeft` | After Effects host integration |
| `scripts` | Smoke tests, certificate creation, release packaging, and platform installer builders |
| `cep.config.ts` | CEP hosts, runtime floor, manifest, and build configuration |
| `.github/workflows/main.yml` | Read-only, unpublished readiness checks and explicitly dispatched native candidate builds |

---

<a id="publishing"></a>

## 📦 Publishing

Production releases require a persistent publisher certificate. Keep both the certificate and its password secure; users need the same publisher identity for seamless updates.

```sh
# Optional: create a persistent local certificate before your first build
bun run certificate:create

# Test, build, sign the ZXP, and generate its SHA-256 checksum
bun run release:package
```

Local packaging automatically creates `.signing/SoundDesigner-publisher.p12` if no certificate is configured or present, prompting you to create and confirm a password. This creates a **new publisher identity**; restore your original certificate instead when retaining the existing publisher identity matters. Existing certificates are reused, never deliberately replaced. CI requires a supplied certificate, and an invalid explicit `SOUNDDESIGNER_ZXP_CERT` path fails instead of silently creating another identity. Keep the certificate and password backed up privately; neither belongs in Git.

The signed ZXP in `release/` is the input for both platform installers:

```sh
# Windows only: build the branded setup EXE
bun run installer:windows

# macOS only: build Resolve, build/sign the Adobe ZXP, then assemble a test PKG
bun run installer:macos

# Validate installer scripts, paths, and workflow wiring
bun run test:installers
```

The EXE must be built on Windows and the PKG on macOS. `installer:macos` runs the complete build chain, including Adobe ZXP signing using your existing publisher certificate and password. It creates an unsigned, unpublished test PKG, not a production-signed/notarized installer. It uses the newly generated ZXP rather than an older `SOUNDDESIGNER_ZXP` override. To assemble prebuilt inputs without signing again, set `SOUNDDESIGNER_INSTALLER_CANDIDATE=1` and run `bun run installer:macos:assemble`. Existing installer outputs are refused; choose a new path with `SOUNDDESIGNER_INSTALLER_OUTPUT`. Current native gates are documented in [compatibility](COMPATIBILITY.md).

The current workflow has read-only repository permission and no signing or publishing job. Normal runs perform shared static checks and unsigned Adobe payload builds. Native candidate dispatch uses the bundled modules under `resolve/vendor/windows` and `resolve/vendor/macos`, plus a separately supplied, already signed ZXP that matches the current build. The native modules must be included in the checkout; no module Base64 secrets are required. See [RELEASING.md](RELEASING.md) for input names, manual certification, signing/notarization gates and rollback. Phase 6 authorizes none of those production operations.

---

<a id="troubleshooting"></a>

## 🧰 Troubleshooting

<details>
<summary><strong>Cloud audio or conversion says the project must be saved</strong></summary>

Save the Premiere Pro or After Effects project and retry. Project-scoped audio needs a stable project directory.
</details>

<details>
<summary><strong>Freesound does not appear in the Library panel</strong></summary>

Enable **Freesound library** in Settings, enter a valid personal API key, save, and then enable the Freesound source in the Library panel.
</details>

<details>
<summary><strong>The API key or shared settings differ between Adobe and Resolve</strong></summary>

Open the updated host containing the old key first, then switch focus to the other updated host. Keys share the machine-local store; settings and library records share the machine-local application-data store independently of the audio folder. A credential-store read/write error is shown instead of silently overwriting it. Do not paste keys into reports or screenshots.
</details>

<details>
<summary><strong>Resolve will not open, an installer is blocked, or storage is busy</strong></summary>

Resolve needs Studio, a matching OS/CPU SDK addon and a supported native runtime. Static header checks do not prove ABI compatibility. Close selected applications before setup. Review retained installation `.previous` trees and locks before retrying; do not erase portable storage or a live manifest lock. An unavailable volume must be reconnected or explicitly changed in Settings. Follow [rollback and troubleshooting](RELEASING.md#rollback-and-troubleshooting).
</details>

<details>
<summary><strong>Only local or only cloud results appear</strong></summary>

Local and Freesound are independent switches. Enable both in the Library panel to search both sources together.
</details>

<details>
<summary><strong>A format is indexed but will not preview or convert</strong></summary>

Indexing and decoding are different steps. Keep **Convert unsupported audio to WAV** enabled. If CEP cannot decode the source, convert it externally to WAV, AIFF, MP3, AAC, or M4A and rescan the library.
</details>

<details>
<summary><strong>Inserted audio is missing from the SoundDesigner bin</strong></summary>

Confirm that an Adobe project—and, in After Effects, an active composition—is open. Retry with **Insert** so the host integration can create the bin or folder.
</details>

---

## 🔒 Respectful by Design

- Original local audio is never overwritten by conversion or effects.
- Freesound credentials are user-provided, machine-local and excluded from portable manifests and release payloads.
- Cloud downloads are limited to trusted Freesound HTTPS hosts and use bounded file sizes.
- Interrupted temporary downloads and renders are cleaned up.
- Updates are explicit: SoundDesigner never silently replaces the installed extension.

---

<a id="developers"></a>

## 👨‍💻 Developers

SoundDesigner is developed and maintained by:

- [@raselerkaj](https://t.me/raselerkaj)
- [@itsniloybhowmick](https://t.me/itsniloybhowmick)

---

<a id="license"></a>

## 📜 License

SoundDesigner is distributed under the [MIT License](LICENSE).

Freesound content is not covered by the SoundDesigner license. Each downloaded sound remains subject to its own license and attribution requirements.

<div align="center">
  <strong>Built for editors who want to spend more time designing sound—and less time managing files.</strong>
</div>
