// The hosted workspace ships presentation code only. The standalone developer app keeps its own engine.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'bid-assistant');
const destination = path.join(root, 'web/public/bid-assistant');
const files = ['app.js', 'hosted.js', 'styles.css', 'vendor', 'lib/geo.js', 'lib/presentation.js', 'lib/guidance.js',
  'lib/workspace-navigation.css', 'lib/workspace-navigation.js', 'lib/report.js', 'lib/drafts.js', 'lib/account-storage.js', 'lib/exports.js'];
await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, 'lib'), { recursive: true });
for (const file of files) await cp(path.join(source, file), path.join(destination, file), { recursive: true });
const html = await readFile(path.join(source, 'index.html'), 'utf8');
await writeFile(path.join(destination, 'index.html'), html.replace(/<script src="([^"]+)"><\/script>\n/g, (tag, file) => {
  if (file === 'app.js') return '<script src="hosted.js"></script>\n' + tag;
  return files.includes(file) || file.startsWith('vendor/') ? tag : '';
}));

// Bundle only the current county revisions into the Worker.
const { default: manifest } = await import('../bid-assistant/data/regions.js');
const imports = Object.values(manifest.regions).map(({ url }, i) =>
  `import pack${i} from '../../bid-assistant/${url}' with { type: 'json' };`);
await writeFile(path.join(root, 'web/worker/packs.generated.mjs'),
  imports.join('\n') + '\nexport default [' + imports.map((_, i) => 'pack' + i).join(', ') + '];\n');
