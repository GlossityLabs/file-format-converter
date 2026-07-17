# Format Forge — Privacy Policy

_Last updated: July 16, 2026_

## The short version

Format Forge collects **nothing**. Glossity Labs receives no files, filenames,
settings, usage information, or personal information from the extension or its
optional local companion.

Conversions run on your device. There are no analytics, telemetry, ads,
trackers, accounts, cookies, cloud uploads, or developer-operated conversion
servers. We do not sell, rent, or share user data because we do not receive it.

## What the extension does with data

- **Files converted in Chrome** are processed inside the extension tab. Selected
  files, queue details, and converted output blobs remain in that tab's local
  browser context and are not placed in Chrome extension storage. Chrome saves
  an output only when you choose to download it. Queue data remains until you
  remove or clear the job or close the extension tab.
- **Files converted by the optional companion** are sent over an authenticated
  loopback connection to `127.0.0.1:43123` on the same computer. This local
  transfer includes the file bytes, a sanitized filename, the requested formats,
  and the selected quality preset. It is not sent to Glossity Labs, the Internet,
  or a third-party conversion service.
- **Temporary companion files** are stored by default in private per-job
  directories in the operating system's temporary area. Upload failures, failed
  conversions, and canceled jobs are removed when processing settles. Successful
  jobs remain available for an idle period of 30 minutes by default, which the
  person running the companion can configure, and are then removed. A clean
  companion shutdown removes all tracked jobs. If the computer or process stops
  unexpectedly, temporary files can remain until the operating system or user
  removes them.
- **Local settings** may include the companion loopback address and optional
  pairing token in `chrome.storage.local`. A temporary tab identifier is kept in
  `chrome.storage.session` so the toolbar button can refocus the converter tab.
  Files, filenames, jobs, and outputs are not stored in either Chrome storage
  area. The developer has no access to these local values. Disconnecting removes
  the extension's saved pairing token; the companion's local token file remains
  until the user removes or rotates it.
- **Companion diagnostics** do not log file contents, filenames, pairing tokens,
  or native-tool diagnostic output. The companion pairing token is stored locally
  in a user-private configuration file unless the user supplies it through an
  environment variable.

Downloaded files are retained wherever Chrome saves them and are controlled by
the user's browser and operating-system settings.

## What we collect

Nothing. Format Forge has no developer-operated backend, user database, account
system, analytics endpoint, or crash-reporting service. Glossity Labs cannot see
which files you convert, which formats you use, or whether you use the extension.

## Network activity

The packaged extension loads its code, icons, and conversion libraries from the
extension itself. Its only runtime network permission is the fixed loopback
companion address. It does not inject scripts into websites or read browsing
history or page content.

The browser, operating system, Chrome download system, and separately installed
tools such as LibreOffice and FFmpeg have their own behavior and privacy terms.
Format Forge does not enforce an operating-system network sandbox around those
external tools.

## Permissions, explained

| Permission | Why it is needed |
| --- | --- |
| `storage` | Stores the optional local companion address and pairing token, plus a session-only identifier for the extension's own tab. It is never used for file contents. |
| Access to `http://127.0.0.1:43123/*` | Checks, pairs with, and sends user-requested conversion jobs to the optional companion running on the same computer. |

Format Forge requests no website access, browsing-history, cookies, downloads,
camera, microphone, geolocation, or clipboard permission.

## Changes

Any change to this policy will be published in this file with an updated date:
https://github.com/GlossityLabs/file-format-converter/blob/main/PRIVACY.md

## Contact

Open an issue at:
https://github.com/GlossityLabs/file-format-converter/issues

Do not attach private documents, converted files, or pairing tokens to a public
issue.
