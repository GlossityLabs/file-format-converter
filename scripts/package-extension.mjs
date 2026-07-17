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

mkdirSync(releaseDir, { recursive: true });
writeFileSync(outputPath, zipSync(collectFiles(sourceDir), { level: 9 }));
console.log(`Created ${basename(outputPath)}`);
