// Publish only the static screening client, not research files or the local relay server.
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'web/public/bid-assistant');
await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, 'data'), { recursive: true });
for (const entry of ['index.html', 'app.js', 'styles.css', 'lib', 'packs', 'rules', 'vendor', 'data/data.js']) {
  await cp(path.join(root, 'bid-assistant', entry), path.join(destination, entry), { recursive: true });
}
console.log('Bid assessment assets prepared for the web workspace.');
