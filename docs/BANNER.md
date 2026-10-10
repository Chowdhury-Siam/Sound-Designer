# SoundDesigner signal banner

The supplied cream wordmark pairs **SF Pro Display** for “Sound” with **Bodoni Moda** for “Designer,” as specified by the user. Its letterforms are traced into smooth SVG curves from `Sound-logo.png`. A waveform sits within the heavier “Sound” lettering and becomes a continuous ribbon sweeping beneath the intact serif lettering. Premiere Pro, After Effects, and DaVinci Resolve Studio share three equally spaced support groups, with smaller brand labels and stronger application names.

| Asset | Size | Use |
| --- | --- | --- |
| [README banner](../.github/assets/SoundDesigner-signal-banner.svg) | 1800 × 720 | Wide README header |
| [Release artwork](../.github/assets/SoundDesigner-signal-release.svg) | 1800 × 900 | Release header or announcement |
| [Supplied wordmark as vector](../.github/assets/SoundDesigner-wordmark.svg) | 3392 × 518 | Standalone transparent wordmark |

Both SVGs are self-contained: outlined typography, inline application symbols, vector gradients, and authored geometry. They contain no raster images, scripts, external resources, or font dependencies. Superseded v1.0.3 artwork is removed from the current checkout; earlier Git commits retain it.

## README

```html
<img alt="SoundDesigner — sound design for Adobe Premiere Pro, After Effects and DaVinci Resolve Studio" src=".github/assets/SoundDesigner-signal-banner.svg" width="800">
```

## Release description

Once committed and pushed, [.github/workflows/release-banner.yml](../.github/workflows/release-banner.yml) runs when a release is published (including a prerelease). It prepends the release SVG to the existing notes and attaches `SoundDesigner-signal-release.svg` as a download. The image URL is pinned to the release's commit, so later artwork changes cannot alter that header. Existing notes and installer assets are retained; reruns do not duplicate the banner or replace an existing attachment.

The workflow decorates an already published release; it does not create releases, publish drafts, build installers, or sign packages. The tagged commit must contain the workflow, helper script, and artwork. Existing historical releases are not retroactively changed. For [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases), the header is still embedded; because published assets are locked, attach the downloadable SVG to the draft before publishing if needed.

GitHub does not start another workflow for a release created with the default `GITHUB_TOKEN`. If a future automated publisher uses that token, it must call `applyReleaseBanner` from [scripts/release-banner.mjs](../scripts/release-banner.mjs) in the publishing job, or use a GitHub App token that triggers release events. See [GitHub's workflow trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

For a manual fallback, paste this at the start of the release description, replacing `RELEASE_COMMIT_SHA` with the full commit SHA containing the artwork:

```markdown
![SoundDesigner — Adobe Premiere Pro, Adobe After Effects and DaVinci Resolve Studio](https://raw.githubusercontent.com/iboyshanto/SoundDesigner/RELEASE_COMMIT_SHA/.github/assets/SoundDesigner-signal-release.svg)
```

Local verification: `node --test scripts/release-banner.test.mjs`. A live Actions run is separate evidence.

## Edit and regenerate

[scripts/design-signal-banner.ps1](../scripts/design-signal-banner.ps1) is the source. On Windows, run:

```powershell
./scripts/design-signal-banner.ps1 -FontDirectory 'C:/Users/Zan-getsu/.agents/skills/canvas-design/canvas-fonts'
```

To regenerate elsewhere, supply a directory containing `InstrumentSans-Regular.ttf`, `InstrumentSans-Bold.ttf`, `WorkSans-Regular.ttf`, and `WorkSans-Bold.ttf`. These fonts are distributed under the SIL Open Font License in the canvas-design skill and are used for supporting copy and application monograms. The generator uses Windows System.Drawing to convert this lettering into paths. Their font files are not embedded in the SVG.

The main wordmark is loaded from the standalone SVG, so SF Pro Display and Bodoni Moda do not need to be installed or embedded. To retrace the supplied PNG, use [scripts/trace-sounddesigner-wordmark.py](../scripts/trace-sounddesigner-wordmark.py), which requires Pillow and NumPy:

```powershell
python ./scripts/trace-sounddesigner-wordmark.py 'J:/Downloads/Sound-logo.png'
```

Adobe symbols are custom vector monograms. The Resolve symbol reuses the repository's existing vector reproduction, rather than an official vector master. Application names and symbols identify host compatibility; they do not imply endorsement or native certification. Version and compatibility requirements remain in [COMPATIBILITY.md](../COMPATIBILITY.md).
