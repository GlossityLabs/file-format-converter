# Local companion setup

The companion is optional. Browser image, PDF, CSV, and JSON recipes work without it. Office and media recipes require it.

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

Paste it into the extension's Local engine dialog. The extension keeps it in `chrome.storage.local`; it is sent only to the loopback companion in an `Authorization` header.

To rotate the token, stop the companion, remove its token file as documented in its startup output, and restart. You will need to pair the extension again.

## Origin restriction

Developer builds allow Chrome extension origins and local Vite origins. Production packaging should set `FORMAT_FORGE_ALLOWED_ORIGINS` to the exact stable Chrome Web Store extension origin.

## Troubleshooting

- **Companion offline:** ensure the server is running and listening on `127.0.0.1:43123`.
- **Not paired:** paste the current token again; tokens from another machine or rotated configuration do not work.
- **LibreOffice unavailable:** install LibreOffice or set `FORMAT_FORGE_SOFFICE_PATH`.
- **FFmpeg unavailable:** install FFmpeg or set `FORMAT_FORGE_FFMPEG_PATH` and `FORMAT_FORGE_FFPROBE_PATH`.
- **Conversion failed:** confirm the input is not encrypted, macro-enabled, DRM-protected, corrupt, or outside the supported matrix.
