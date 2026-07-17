# Architecture

## Why Format Forge is hybrid

Chrome can safely convert common images, render PDF pages, assemble PDFs, and transform structured text. It cannot execute a user's installed FFmpeg or LibreOffice binary, and browser-WASM media conversion carries substantial download, memory, performance, and codec-licensing costs.

Format Forge therefore has two explicit engines:

1. The browser engine runs lightweight recipes inside the extension tab.
2. The optional companion streams jobs over authenticated loopback HTTP and invokes only fixed LibreOffice or FFmpeg recipes.

The UI exposes the selected engine on every job. If a required local tool is unavailable, the recipe is disabled with installation guidance.

## Extension boundaries

- `src/background.ts` opens or focuses the full converter tab. It does not process files.
- `src/core` owns formats, recipes, validation, safe filenames, and queue state.
- `src/converters` owns browser recipes and the companion API client.
- `src/ui` contains presentation components and accessible dialogs.
- Files remain in page memory. Object URLs are revoked when a job is removed or the page unloads.

The manifest has no content scripts and no access to web pages. Its only host access is the fixed companion origin, `http://127.0.0.1:43123/*`.

## Companion boundaries

- Binds to IPv4 loopback only.
- Requires a random bearer token for conversion, polling, cancellation, and output.
- Validates Chrome-extension or configured development origins.
- Accepts only known input/output pairs and quality presets.
- Streams request bodies into private job directories with byte limits.
- Starts child programs without a shell and never accepts raw arguments or filesystem paths from the client.
- Cancels child processes on request or timeout.
- Removes job data after its time-to-live expires.

The unauthenticated health/capability response contains no filenames, paths, tokens, or job information.

## Job lifecycle

```text
ready → uploading → converting → finalizing → complete
                  ↘ failed
                  ↘ canceled
```

The extension processes a queue sequentially to avoid multiplying memory pressure. A failed job does not stop later jobs. Media progress comes from FFmpeg's machine-readable progress channel; Office conversion is indeterminate until LibreOffice completes.

## Conversion limits

Limits exist for browser stability and denial-of-service resistance. The source of truth is exported constants in the core and companion. The UI rejects excessive queue counts or aggregate bytes before conversion. The companion independently enforces its own request and timeout limits.

## Release hardening still required

Before a Chrome Web Store/macOS release:

- Package the companion as a signed and notarized universal or arm64 application.
- Provide a stable install/uninstall flow and exact Chrome extension-origin allowlist.
- Perform golden-file fidelity tests with representative Office documents and fonts.
- Fuzz or corpus-test file sniffers and conversion error handling.
- Preserve the generated third-party notices and review the exact FFmpeg build's LGPL/GPL/codecs obligations.
- Complete Chrome Web Store privacy disclosures and a public privacy-policy URL.
