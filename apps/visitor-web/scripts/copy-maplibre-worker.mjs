import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const packageDirectory = path.dirname(
  require.resolve('maplibre-gl/package.json'),
);
const sourceDirectory = path.join(packageDirectory, 'dist');
const destinationDirectory = fileURLToPath(
  new URL('../public/maplibre/', import.meta.url),
);

mkdirSync(destinationDirectory, { recursive: true });
for (const filename of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(
    path.join(sourceDirectory, filename),
    path.join(destinationDirectory, filename),
  );
}
