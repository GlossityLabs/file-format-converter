# Format Forge

Format Forge is a privacy-first Chrome extension for converting documents, images, audio, video, PDFs, and tabular data. Common conversions run in the extension tab. High-fidelity Office and media conversions use an optional companion process on the same Mac, backed by LibreOffice and FFmpeg.

**No cloud uploads, no analytics, no remote conversion API.**

> Status: developer preview. The extension and companion are functional, but the macOS companion is currently a Node application rather than a signed/notarized installer.

## Supported conversions

| Input | Output | Runs in |
| --- | --- | --- |
| PNG, JPEG, WebP | PNG, JPEG, WebP, PDF | Chrome |
| PDF | PNG or JPEG pages in a ZIP | Chrome |
| CSV | JSON | Chrome |
| JSON table data | CSV | Chrome |
| DOC, DOCX, ODT, RTF, TXT | PDF | Local companion + LibreOffice |
| XLS, XLSX, ODS, CSV | PDF | Local companion + LibreOffice |
| PPT, PPTX, ODP | PDF | Local companion + LibreOffice |
| DOCX ↔ ODT, XLSX ↔ ODS/CSV, PPTX ↔ ODP | Matching Office format | Local companion + LibreOffice |
| MP3, WAV, FLAC, M4A, AAC, OGG, Opus | Common audio formats | Local companion + FFmpeg |
| MP4, MOV, MKV, WebM, AVI, M4V | MP4, WebM, MOV, MKV, GIF, MP3, WAV | Local companion + FFmpeg |

Format Forge intentionally does not claim reliable PDF-to-Word, raster-to-vector, DRM removal, macro preservation, or password-protected document conversion. Office fidelity depends on installed fonts and LibreOffice's compatibility with the source document.

## Run locally

Requirements:

- Node.js 20 or newer
- Chrome or Chromium
- FFmpeg for audio/video recipes
- LibreOffice for Office document recipes
- Poppler only for future/optional native PDF utilities

Install and validate:

```bash
npm install
npm run verify
```

Build the extension:

```bash
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist-extension`.

Start the local companion in another terminal:

```bash
npm run dev:companion
```

On first run it creates a long random pairing token in a user-private configuration directory. Reveal it explicitly when you are ready to pair:

```bash
npm run companion:token
```

Open **Local engine** in the extension, paste the token once, and connect. Do not share or commit it.

For extension UI development:

```bash
npm run dev
```

The Vite page can exercise browser recipes. Chrome APIs and the packaged CSP must still be verified in the unpacked production build.

## Build outputs

- `dist-extension/` — unpacked Manifest V3 extension
- `dist-companion/` — compiled companion server
- `release/format-forge-<version>.zip` — Chrome upload artifact after `npm run package:extension`

## Architecture

```text
Chrome action
  └─ full extension tab
      ├─ browser engine: image, PDF, CSV/JSON
      └─ authenticated 127.0.0.1 companion
          ├─ LibreOffice: document/spreadsheet/presentation recipes
          └─ FFmpeg: audio/video recipes
```

The toolbar action opens a durable full tab because Manifest V3 service workers and action popups are not suitable owners for long conversions. Browser work stays in the page. Companion transfers stream over authenticated loopback into private per-job temporary directories, and outputs expire automatically.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for more detail.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the development workflow, privacy constraints, and release checks.

## Development commands

```bash
npm run dev                 # Vite UI
npm run dev:companion       # local conversion companion
npm run companion:token     # reveal the local pairing token
npm run smoke:companion -- path/to/file.docx docx pdf
npm run typecheck           # browser + companion TypeScript
npm test                    # unit tests
npm run build               # production extension + companion
npm run package:extension   # versioned Chrome ZIP
```

## Licensing

Format Forge is open source under the [Apache License 2.0](LICENSE). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled dependency
licenses and the separate obligations that apply if you distribute FFmpeg,
LibreOffice, Poppler, codecs, or other external conversion tools.
