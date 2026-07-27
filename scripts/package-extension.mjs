import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import packageJson from '../package.json' with { type: 'json' };

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = join(projectRoot, 'dist-extension');
const releaseDir = join(projectRoot, 'release');
const outputPath = join(releaseDir, `format-forge-${packageJson.version}.zip`);

function collectFiles(directory, files = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absolutePath, files);
    } else {
      files[relative(sourceDir, absolutePath)] = new Uint8Array(readFileSync(absolutePath));
    }
  }
  return files;
}

function createWebStoreFiles() {
  const files = collectFiles(sourceDir);
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));

  // Keep the public key in dist-extension so unpacked development builds retain
  // their stable ID. Chrome Web Store assigns the production ID and rejects a
  // new upload when the package manifest contains this field.
  delete manifest.key;
  files['manifest.json'] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

  return files;
}

mkdirSync(releaseDir, { recursive: true });
writeFileSync(outputPath, zipSync(createWebStoreFiles(), { level: 9 }));
console.log(`Created Chrome Web Store package ${basename(outputPath)}`);
