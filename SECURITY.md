# Security

## Reporting a vulnerability

Please report vulnerabilities privately to the repository owner. Do not include private documents, pairing tokens, or other secrets in an issue.

## Security model

- Conversion recipes are allowlisted; clients cannot supply arbitrary process arguments.
- The companion binds only to `127.0.0.1` and requires a bearer pairing token for jobs and output.
- The packaged Mac app registers a Native Messaging host for one exact extension ID. That channel returns only the loopback URL, service version, and local credential; files remain on authenticated loopback HTTP.
- Child processes are launched with argument arrays and without a shell.
- Every job receives a private temporary directory, resource limits, a timeout, and cleanup.
- Extension JavaScript and workers are packaged locally under Manifest V3 CSP rules.
- Input formats are treated as untrusted. Keep Chrome, Format Forge, FFmpeg, LibreOffice, and Poppler current.

## Secret hygiene

Never commit a GitHub token, companion token, `.env` file, or converted user file. Rotate a token immediately if it appears in chat, logs, terminal history, or source control.
