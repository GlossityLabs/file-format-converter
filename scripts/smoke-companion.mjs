import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

const [inputPath, inputFormat, outputFormat] = process.argv.slice(2);
if (!inputPath || !inputFormat || !outputFormat) {
  throw new Error('Usage: npm run smoke:companion -- <input-path> <input-format> <output-format>');
}

const baseUrl = process.env.FORMAT_FORGE_URL ?? 'http://127.0.0.1:43123';
const tokenFile =
  process.env.FORMAT_FORGE_TOKEN_FILE ??
  join(process.env.FORMAT_FORGE_CONFIG_DIR ?? join(homedir(), '.config', 'format-forge'), 'pairing-token');
const token = process.env.FORMAT_FORGE_TOKEN ?? (await readFile(tokenFile, 'utf8')).trim();
const input = await readFile(inputPath);
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/octet-stream',
  'X-File-Name': encodeURIComponent(basename(inputPath)),
  'X-Input-Format': inputFormat,
  'X-Output-Format': outputFormat,
  'X-Quality-Preset': 'balanced',
};

const createdResponse = await fetch(`${baseUrl}/v1/jobs`, { method: 'POST', headers, body: input });
if (!createdResponse.ok) throw new Error(`Job creation failed: ${createdResponse.status} ${await createdResponse.text()}`);
let { job } = await createdResponse.json();

const deadline = Date.now() + 180_000;
while (!['complete', 'failed', 'canceled'].includes(job.state)) {
  if (Date.now() > deadline) throw new Error('Smoke conversion timed out.');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const response = await fetch(`${baseUrl}/v1/jobs/${job.id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Job polling failed: ${response.status}`);
  ({ job } = await response.json());
}

if (job.state !== 'complete') throw new Error(`Smoke conversion ended in ${job.state}: ${job.error ?? 'unknown error'}`);
const outputResponse = await fetch(`${baseUrl}/v1/jobs/${job.id}/output`, { headers: { Authorization: `Bearer ${token}` } });
if (!outputResponse.ok) throw new Error(`Output download failed: ${outputResponse.status}`);
const bytes = new Uint8Array(await outputResponse.arrayBuffer());
if (bytes.length === 0) throw new Error('Smoke conversion produced an empty file.');

const suffix = extname(job.outputName ?? '') || `.${outputFormat}`;
const outputPath = join(tmpdir(), `format-forge-smoke-${randomUUID()}${suffix}`);
await writeFile(outputPath, bytes, { mode: 0o600 });
console.log(JSON.stringify({ inputFormat, outputFormat, outputBytes: bytes.length, outputPath }));
