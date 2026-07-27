# Format Forge for Mac

This directory packages the existing Node companion as a normal macOS app. The app starts and stops the local HTTP engine, displays detected conversion tools, manages start-at-login, and provides a manual pairing-code fallback without requiring Terminal.

## User flow

1. Move **Format Forge.app** to Applications and open it once. The app does not register a temporary path from a mounted DMG or build folder.
2. The app starts the conversion engine on `127.0.0.1` and registers its Chrome native-messaging host.
3. When the extension needs an Office, audio, video, or advanced PDF conversion, it sends a small `bootstrap` message.
4. The native host starts the app in the background if necessary and returns the loopback URL and pairing token.
5. File bytes continue to stream over authenticated loopback HTTP. They are never sent through native messaging or uploaded to a server.

```text
Chrome extension
    │  native bootstrap only
    ▼
format-forge-native-host
    │  starts app / returns URL + token
    ▼
Format Forge.app ── 127.0.0.1 HTTP ── LibreOffice / FFmpeg
```

## Build and run

The desktop app has its own package boundary so the extension's dependencies and scripts remain unchanged.

```bash
cd desktop
npm install
npm test
npm run dev
```

Create an unpacked macOS app for local testing:

```bash
npm run package:mac:dir
```

Create an isolated universal QA DMG:

```bash
npm run package:mac:qa
```

The QA app is named **Format Forge Preview**, uses a separate bundle ID,
configuration directory, temporary directory, and loopback port, and cannot
register or replace the production Chrome native host. It is deliberately
unsigned. `npm run package:mac` is the signed and notarized public-release
command.

Public builds must be signed with a Developer ID certificate and notarized.
The release workflow requires `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` GitHub secrets.
Electron Builder signs, notarizes, and staples the universal app; release
credentials are intentionally not stored in this repository. The `--dir` build
is an unsigned local smoke-test artifact and must not be published.

Stable builds also produce a signed ZIP, blockmaps, and `latest-mac.yml`.
Those assets are uploaded with the DMG. The app checks the GitHub release
channel on launch and every six hours, downloads an available update, then
offers **Restart and install**. Updates are disabled for Preview builds and for
copies that have not been moved to Applications.

## Native host and extension identity

The native host is `com.glossitylabs.formatforge`. Chrome registers it at:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.glossitylabs.formatforge.json
```

The manifest points to a dedicated executable wrapper in the app's
`Contents/Resources/native-host` directory. The wrapper discovers the bundle's
declared executable and runs `native-host.mjs` using Electron's Node mode. It
does **not** point Chrome at the GUI entrypoint. The app rewrites the host
manifest atomically on every stable launch, so moving or replacing the app
repairs the absolute path automatically. Registration failures remain visible
in the app instead of being silently discarded.

The direct-distribution extension ID is stored in `assets/extension-id.txt`. It is derived from the public `key` in `public/manifest.json`; the smoke test verifies they match. Chrome native-host manifests require an exact extension origin and do not allow wildcards. A future Chrome Web Store release must update the public key/ID and `extension-id.txt` together.

The desktop app also sets `FORMAT_FORGE_ALLOWED_ORIGINS` to that exact origin before starting the companion. When Chrome starts the dedicated native host, the validated source origin is forwarded to the engine-only app process. Permissive origins remain available only for explicit development runs outside the packaged app.

Protocol version 1:

```json
{ "type": "bootstrap", "protocolVersion": 1 }
```

```json
{
  "type": "bootstrapResult",
  "protocolVersion": 1,
  "baseUrl": "http://127.0.0.1:43123",
  "token": "…",
  "service": "format-forge-companion",
  "version": "0.1.2",
  "apiVersion": 1
}
```

Errors use `bootstrapError` with a stable `code` and user-readable `message`.
The extension checks the API version and a minimum supported Mac app version,
not exact patch-version equality. Compatible updates can therefore reach Chrome
and the Mac app in either order. The native host still requires the engine
running from its own app bundle to have the exact same build version, which
detects a stale process after an app replacement.

## Bundled conversion tools

This MVP detects FFmpeg, LibreOffice, and Poppler installed on the Mac. When
LibreOffice or FFmpeg is missing, the app offers an allowlisted **Get it** link
to the official download page; no shell command is shown. Tool detection is
live: the app rechecks when it regains focus, while its tool setup screen is
visible, when the user chooses **Check again**, and before the engine rejects a
conversion. Installing a tool therefore does not require restarting Format
Forge. A consumer-ready
release should bundle or provide a one-click managed installation for those
tools after reviewing the exact binaries and licenses. Hiding Terminal alone is
not sufficient if users must install converters manually.

PDF-to-DOCX requires a dedicated fidelity-tested converter. LibreOffice is suitable for Office-to-PDF conversions but is not, by itself, a reliable general PDF-to-DOCX engine. Keep the recipe capability-gated until the companion's PDF-to-DOCX implementation reports it as available.
