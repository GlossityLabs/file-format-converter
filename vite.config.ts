import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const licenseBanner = '/*! Third-party software notices: THIRD_PARTY_NOTICES.md and licenses/. */';

const licenseArtifacts = [
  ['LICENSE', 'LICENSE'],
  ['NOTICE', 'NOTICE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['node_modules/fflate/LICENSE', 'licenses/fflate-MIT.txt'],
  ['node_modules/lucide-react/LICENSE', 'licenses/lucide-react-ISC-and-MIT.txt'],
  ['node_modules/pdf-lib/LICENSE.md', 'licenses/pdf-lib-MIT.txt'],
  ['node_modules/@pdf-lib/standard-fonts/LICENSE.md', 'licenses/pdf-lib-standard-fonts-MIT.txt'],
  ['node_modules/@pdf-lib/upng/LICENSE', 'licenses/pdf-lib-upng-MIT.txt'],
  ['node_modules/pako/LICENSE', 'licenses/pako-MIT-and-Zlib.txt'],
  ['node_modules/pako/lib/zlib/README', 'licenses/pako-zlib-notice.txt'],
  ['node_modules/tslib/LICENSE.txt', 'licenses/tslib-0BSD.txt'],
  ['node_modules/tslib/CopyrightNotice.txt', 'licenses/tslib-copyright-notice.txt'],
  ['node_modules/pdfjs-dist/LICENSE', 'licenses/pdfjs-dist-Apache-2.0.txt'],
  ['node_modules/react/LICENSE', 'licenses/react-MIT.txt'],
  ['node_modules/react-dom/LICENSE', 'licenses/react-dom-MIT.txt'],
  ['node_modules/scheduler/LICENSE', 'licenses/scheduler-MIT.txt'],
] as const;

function includeLicenseArtifacts(): Plugin {
  return {
    name: 'include-license-artifacts',
    generateBundle(_outputOptions, bundle) {
      for (const artifact of Object.values(bundle)) {
        if (artifact.type === 'chunk') artifact.code = `${licenseBanner}\n${artifact.code}`;
      }
    },
    closeBundle() {
      for (const [source, destination] of licenseArtifacts) {
        const outputPath = resolve(__dirname, 'dist-extension', destination);
        mkdirSync(dirname(outputPath), { recursive: true });
        copyFileSync(resolve(__dirname, source), outputPath);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), includeLicenseArtifacts()],
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'app.html'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
