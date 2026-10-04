# Resolve backend origin

- Source: `M:\Projects\SoundDesigner-Resolve`
- Commit: `d9aa3051d86efd9b2f20dca50b83c909762adb3f`
- Branch observed at import: `main`
- Imported: 2026-10-03

Only the Resolve-native main process, preload, IPC, services, Resolve-specific shared types/contracts, manifest, backend tests, native-smoke documents, and vendor input documentation were imported.

The historical `src/renderer` tree, source `package.json`, `bun.lock`, build output, caches, dependencies, and ignored native binaries were not copied. The target repository's `src/js/main` remains the only UI and product-feature source. The native assembly script may use `RESOLVE_WORKFLOW_NODE`, a platform vendor input, or the installed Windows SDK sample module.
