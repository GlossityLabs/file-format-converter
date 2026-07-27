# Contributing to Format Forge

Issues and pull requests are welcome. Keep contributions focused on local,
privacy-preserving conversion and avoid adding analytics, remote executable
code, or file-upload services.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install Node.js 20 or newer and run `npm install`.
3. Make the change with tests and documentation where applicable.
4. Run `npm run verify` before opening a pull request.

Desktop changes also require `npm ci --prefix desktop` and
`npm run verify:desktop`. Use `npm --prefix desktop run package:mac:dir` for an
unsigned local universal-app smoke test; never publish that artifact. Tagged
releases require the Apple signing/notarization secrets documented in
`desktop/README.md`.

Never commit converted user files, pairing tokens, GitHub credentials, `.env`
files, or generated build directories. New bundled dependencies must have a
compatible open-source license and be added to the production artifact's
third-party notice inventory.

By submitting a contribution, you agree that it may be distributed under the
project's [Apache License 2.0](LICENSE).
