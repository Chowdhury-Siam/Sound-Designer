# macOS native module

Place the macOS `WorkflowIntegration.node` supplied with the target Resolve SDK here. The Windows native module is not compatible with macOS.

Release packaging must fail until this file is supplied and the artifact has passed a clean-install test on a supported macOS Resolve Studio host.

Use the SDK addon matching the target Resolve/Electron runtime, not a Windows binary or an arbitrary Node addon. Assembly, artifact auditing, and development installation now check Mach-O/universal headers and CPU compatibility. Header checks do not establish Electron ABI compatibility, signing, or successful native loading.

On the target Mac, set `RESOLVE_WORKFLOW_NODE` to the absolute SDK addon path (or place it in this directory). Set `RESOLVE_TARGET_ARCH=x64` or `arm64` to the actual Resolve runtime architecture if it differs from the Bun build process. Do not infer the runtime architecture solely from the physical Mac: Intel applications can run under Rosetta on Apple Silicon. A universal addon must contain the required slice; support for both slices must come from the SDK, not filename changes.

See [the macOS verification checklist](../../../COMPATIBILITY.md#macos-verification). `ALLOW_MISSING_NATIVE=1` permits structural CI builds only; such artifacts cannot be installed or claimed as native-ready.
