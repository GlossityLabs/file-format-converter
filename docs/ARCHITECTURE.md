# Architecture

## Why Format Forge is hybrid

Chrome can safely convert common images, render PDF pages, assemble PDFs, and transform structured text. It cannot execute a user's installed FFmpeg or LibreOffice binary, and browser-WASM media conversion carries substantial download, memory, performance, and codec-licensing costs.

Format Forge therefore has two explicit engines:

1. The browser engine runs lightweight recipes inside the extension tab.
2. The optional Mac app starts the companion and streams jobs over authenticated loopback HTTP, invoking only fixed LibreOffice or FFmpeg recipes.

The UI exposes the selected engine on every job. If a required local tool is unavailable, the recipe is disabled with installation guidance.

## Extension boundaries

- `src/background.ts` opens or focuses the full converter tab. It does not process files.
- `src/core` owns formats, recipes, validation, safe filenames, and queue state.
- `src/converters` owns browser recipes and the companion API client.
- `src/ui` contains presentation components and accessible dialogs.
- Files remain in page memory. Object URLs are revoked when a job is removed or the page unloads.

The manifest has no content scripts and no access to web pages. Its only host
access is the fixed companion origin, `http://127.0.0.1:43123/*`. Its
`nativeMessaging` permission is used only to start and authorize the installed
Mac app; conversion file bytes do not cross that channel.

## Desktop bootstrap

The signed Mac app registers `com.glossitylabs.formatforge` for the exact stable
extension ID. Chrome sends a small versioned bootstrap request to the dedicated
native-host wrapper. The wrapper starts the app in engine-only mode if needed
and returns the loopback URL and private token. The extension validates both,
stores them locally, then verifies the service over HTTP before enabling native
recipes.

Production registration is accepted only from the canonical
`/Applications/Format Forge.app` or `~/Applications/Format Forge.app` path and
is rewritten atomically on every launch. Unsigned QA packages use the separate
**Format Forge Preview** identity and port and cannot overwrite production
registration.

Chrome and the Mac app negotiate a Local Engine API version plus a minimum
supported desktop version. They do not require identical patch versions, so
compatible staged releases may update in either order. The native host and
engine inside one Mac app bundle must still report the exact same build version;
that narrower check detects an older process left running after replacement.

The native host never accepts filenames, file bytes, converter arguments, or
arbitrary URLs. The existing HTTP boundary remains responsible for upload size
limits, recipe validation, job isolation, cancellation, and output cleanup.

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

## Release requirements

The repository now includes an Electron desktop shell, native host, stable
direct-distribution extension identity, isolated Preview identity, universal
DMG and updater ZIP configuration, in-app update/restart controls, and CI steps
for signing/notarization. Before publishing a release:

- Configure the Apple Developer ID and notarization secrets required by the release workflow.
- Verify Gatekeeper acceptance, the stapled notarization ticket, first-launch registration, update, and uninstall flows.
- Bundle or provide a one-click managed installation for LibreOffice/FFmpeg only after a binary and license audit.
- Perform golden-file fidelity tests with representative Office documents and fonts.
- Fuzz or corpus-test file sniffers and conversion error handling.
- Preserve the generated third-party notices and review the exact FFmpeg build's LGPL/GPL/codecs obligations.
- Keep PDF-to-DOCX disabled until a dedicated converter passes fidelity and licensing review; LibreOffice is not a valid implementation for that route.
- Complete Chrome Web Store privacy disclosures using the public [privacy policy](../PRIVACY.md).
