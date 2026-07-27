# Local Engine setup

The Local Engine is optional. Browser image, PDF, CSV, and JSON recipes work
without it. Office and media recipes require it.

## Regular Mac users

1. Install the universal Format Forge Mac app from the latest GitHub release.
2. Move it to Applications and open it once.
3. Return to the extension and choose **Connect the app**.

The app starts the engine, registers its exact Chrome Native Messaging host,
and supplies the private loopback credential automatically. Users do not need
Node.js, Terminal, or a copied pairing code. Native Messaging carries only the
bootstrap response; files continue to stream through authenticated
`127.0.0.1` HTTP.

Signed production builds repair the absolute native-host path on every launch
and check for Mac app updates automatically. Once an update is downloaded, the
app closes the engine, installs the update, and reopens itself. Preview builds
are isolated from the production app and Chrome registration.

This MVP detects separately installed LibreOffice and FFmpeg. The app reports
which converters are ready. A consumer release should bundle or offer a
one-click managed installation for them after their binaries and licenses have
been reviewed.

## Source-development fallback

## Tool discovery

Format Forge checks explicit environment variables first and then common macOS paths:

- `FORMAT_FORGE_FFMPEG_PATH`
- `FORMAT_FORGE_FFPROBE_PATH`
- `FORMAT_FORGE_SOFFICE_PATH`
- `FORMAT_FORGE_PDFTOPPM_PATH`

Example:

```bash
FORMAT_FORGE_SOFFICE_PATH=/Applications/LibreOffice.app/Contents/MacOS/soffice npm run dev:companion
```

## Pairing

The companion creates or reuses a cryptographically random token. Reveal it only when pairing:

```bash
npm run companion:token
```

Paste it into the developer section of the extension's Local Engine dialog.
The extension keeps it in `chrome.storage.local`; it is sent only to the
loopback companion in an `Authorization` header.

To rotate the token, stop the companion, remove its token file as documented in its startup output, and restart. You will need to pair the extension again.

## Origin restriction

Developer companion runs allow Chrome extension origins and local Vite origins.
The packaged Mac app sets `FORMAT_FORGE_ALLOWED_ORIGINS` to the exact stable
extension origin stored in `desktop/assets/extension-id.txt`. The extension's
manifest public key and that ID are checked during every production build.

## External tools and licensing

The companion discovers and invokes separately installed FFmpeg, LibreOffice,
and Poppler executables. This repository and its extension ZIP do not bundle
or redistribute those programs. Each tool retains its own license.

Before distributing a companion installer that includes any conversion tool,
audit the exact version, binary, codecs, and build configuration. In
particular, FFmpeg terms vary with build flags and enabled codecs, LibreOffice
ships an extensive third-party inventory, and Poppler is GPL-family software.
The project's JavaScript notices are documented in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Troubleshooting

- **Companion offline:** ensure the server is running and listening on `127.0.0.1:43123`.
- **Chrome starts an old app:** open the production app from Applications. It rewrites Chrome's saved native-host path; if an older process is still running, quit it once and reopen Format Forge. Future signed updates perform this restart automatically.
- **Update mismatch:** update the Mac app when Chrome says it is below the supported minimum. Different patch versions are accepted when their Local Engine API is compatible.
- **Not paired:** paste the current token again; tokens from another machine or rotated configuration do not work.
- **LibreOffice unavailable:** install LibreOffice or set `FORMAT_FORGE_SOFFICE_PATH`.
- **FFmpeg unavailable:** install FFmpeg or set `FORMAT_FORGE_FFMPEG_PATH` and `FORMAT_FORGE_FFPROBE_PATH`.
- **A tool was installed while Format Forge was open:** return to Format Forge
  or Chrome. Both surfaces refresh automatically, and **Check again** performs
  an immediate scan. Restarting the app is not required.
- **Conversion failed:** confirm the input is not encrypted, macro-enabled, DRM-protected, corrupt, or outside the supported matrix.
- **PDF to DOCX is missing:** LibreOffice does not provide a reliable PDF-to-DOCX export. Keep this route disabled until a dedicated local converter has been licensed and fidelity-tested.
