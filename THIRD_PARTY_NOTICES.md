# Third-party notices

Format Forge includes open-source software maintained by other projects. Each
project remains governed by its own license. The production extension build
includes the corresponding license texts under `licenses/`.

| Component | Locked version | License | Source |
| --- | --- | --- | --- |
| fflate | 0.8.3 | MIT | [101arrowz/fflate](https://github.com/101arrowz/fflate) |
| Lucide React, including icons derived from Feather | 1.24.0 | ISC and MIT | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| PDF-LIB | 1.17.1 | MIT | [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib) |
| @pdf-lib/standard-fonts | 1.0.0 | MIT | [Hopding/standard-fonts](https://github.com/Hopding/standard-fonts) |
| @pdf-lib/upng | 1.0.1 | MIT | [Hopding/upng](https://github.com/Hopding/upng) |
| pako | 1.0.11 | MIT and Zlib | [nodeca/pako](https://github.com/nodeca/pako) |
| tslib | 1.14.1 | 0BSD | [microsoft/tslib](https://github.com/microsoft/tslib) |
| PDF.js (`pdfjs-dist`) | 6.1.200 | Apache-2.0 | [mozilla/pdf.js](https://github.com/mozilla/pdf.js) |
| React and React DOM | 19.2.7 | MIT | [facebook/react](https://github.com/facebook/react) |
| Scheduler | 0.27.0 | MIT | [facebook/react](https://github.com/facebook/react) |
| Electron (desktop app runtime) | 37.10.3 | MIT; includes Chromium and other components under their respective licenses | [electron/electron](https://github.com/electron/electron) |
| electron-updater | 6.8.9 | MIT | [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) |

The distributed extension contains transformed and minified object-form code
from PDF.js 6.1.200. Its Apache-2.0 license is preserved in
`licenses/pdfjs-dist-Apache-2.0.txt`, and generated JavaScript points readers
back to this notice inventory.

The macOS desktop package includes Electron's MIT license under
`Contents/Resources/legal/ELECTRON-LICENSE.txt`. Electron embeds Chromium and
its third-party attributions in the distributed runtime; those components
retain their respective licenses.

The desktop update client includes its permissively licensed runtime
dependencies, including builder-util-runtime, debug, fs-extra, graceful-fs,
jsonfile, universalify, js-yaml, argparse, lazy-val, Lodash helpers, semver,
sax, ms, and tiny-typed-emitter. Their license files remain in their packaged
modules and their upstream inventories are locked in `desktop/package-lock.json`.

`pdfjs-dist` may install `@napi-rs/canvas` and platform packages for Node.js.
Those packages are not bundled into Format Forge's browser extension; their
MIT-licensed source is maintained at
[Brooooooklyn/canvas](https://github.com/Brooooooklyn/canvas).

FFmpeg, LibreOffice, and Poppler are optional external programs discovered on
the user's computer. They are not bundled or redistributed by this repository
and retain their own licenses. Anyone distributing those programs, codecs, or
a packaged companion installer must review and satisfy the corresponding
license terms for the exact binaries and build configuration they ship.
