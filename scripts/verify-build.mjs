import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const extensionDir = join(projectRoot, 'dist-extension');

function invariant(condition, message) {
  if (!condition) throw new Error(`Build verification failed: ${message}`);
}

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, output);
    else output.push(path);
  }
  return output;
}

const manifestPath = join(extensionDir, 'manifest.json');
invariant(existsSync(manifestPath), 'manifest.json is missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const packageManifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const desktopPackageManifest = JSON.parse(
  readFileSync(join(projectRoot, 'desktop', 'package.json'), 'utf8'),
);
invariant(manifest.manifest_version === 3, 'manifest_version must be 3');
invariant(manifest.version === packageManifest.version, 'extension and root package versions must match');
invariant(
  desktopPackageManifest.version === packageManifest.version,
  'desktop and root package versions must match',
);
const companionContracts = readFileSync(
  join(projectRoot, 'companion', 'contracts.ts'),
  'utf8',
);
invariant(
  companionContracts.includes(`SERVICE_VERSION = '${packageManifest.version}'`),
  'companion service and package versions must match',
);
invariant(
  desktopPackageManifest.dependencies?.['electron-updater'],
  'desktop automatic updater must be a production dependency',
);
invariant(
  desktopPackageManifest.build?.publish?.provider === 'github',
  'desktop updater must publish through the GitHub release provider',
);
invariant(
  JSON.stringify(desktopPackageManifest.build?.mac?.target?.map((target) => target.target))
    === JSON.stringify(['dmg', 'zip']),
  'desktop release must include both DMG and ZIP update targets',
);
invariant(typeof manifest.key === 'string' && manifest.key.length > 0, 'stable extension public key is missing');
const extensionId = createHash('sha256')
  .update(Buffer.from(manifest.key, 'base64'))
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));
const nativeHostExtensionId = readFileSync(
  join(projectRoot, 'desktop', 'assets', 'extension-id.txt'),
  'utf8',
).trim();
invariant(
  extensionId === nativeHostExtensionId,
  'manifest public key and native-host allowed extension ID do not match',
);
invariant(manifest.background?.service_worker === 'background.js', 'background service worker path is incorrect');
invariant(existsSync(join(extensionDir, 'background.js')), 'background.js is missing');
invariant(
  JSON.stringify(manifest.permissions) === JSON.stringify(['storage', 'nativeMessaging']),
  'extension permissions must be limited to local storage and the installed Mac app connection',
);
invariant(
  JSON.stringify(manifest.host_permissions) === JSON.stringify(['http://127.0.0.1:43123/*']),
  'host permissions must be restricted to the fixed loopback companion',
);
invariant(!manifest.content_scripts, 'content scripts are not allowed in this build');
invariant(!manifest.externally_connectable, 'externally_connectable is not allowed in this build');

const files = walk(extensionDir);
invariant(!files.some((file) => file.endsWith('.map')), 'source maps must not ship');
invariant(files.some((file) => file.endsWith('.png')), 'extension icons are missing');

const requiredLicenseFiles = [
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'licenses/fflate-MIT.txt',
  'licenses/lucide-react-ISC-and-MIT.txt',
  'licenses/pdf-lib-MIT.txt',
  'licenses/pdf-lib-standard-fonts-MIT.txt',
  'licenses/pdf-lib-upng-MIT.txt',
  'licenses/pako-MIT-and-Zlib.txt',
  'licenses/pako-zlib-notice.txt',
  'licenses/tslib-0BSD.txt',
  'licenses/tslib-copyright-notice.txt',
  'licenses/pdfjs-dist-Apache-2.0.txt',
  'licenses/react-MIT.txt',
  'licenses/react-dom-MIT.txt',
  'licenses/scheduler-MIT.txt',
];
for (const licenseFile of requiredLicenseFiles) {
  invariant(existsSync(join(extensionDir, licenseFile)), `${licenseFile} is missing`);
}

const generatedJavaScript = files.filter(
  (file) => (file.endsWith('.js') || file.endsWith('.mjs')) && !file.includes('pdf.worker.min-'),
);
invariant(
  generatedJavaScript.every((file) => readFileSync(file, 'utf8').includes('THIRD_PARTY_NOTICES.md')),
  'generated JavaScript must point to the third-party notice inventory',
);

const appHtml = readFileSync(join(extensionDir, 'app.html'), 'utf8');
const scripts = [...appHtml.matchAll(/<script\b([^>]*)>/gi)];
invariant(scripts.every((match) => /\bsrc=/.test(match[1])), 'inline scripts violate the extension CSP');
invariant(!/<script[^>]+src=["']https?:/i.test(appHtml), 'remote scripts are not allowed');

const totalBytes = files.reduce((total, file) => total + statSync(file).size, 0);
invariant(totalBytes < 100 * 1024 * 1024, 'unpacked extension exceeds the 100 MiB review limit');

console.log(`Verified ${files.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MiB) in dist-extension`);
console.log(files.map((file) => `  ${relative(extensionDir, file)}`).join('\n'));
