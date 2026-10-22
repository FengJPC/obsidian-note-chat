import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist', 'note-chat-sidebar');
await fs.mkdir(out, {recursive: true});
const assets = {};
for (const folder of ['cmaps', 'standard_fonts']) {
  const directory = path.join(root, 'src/ui/vendor/pdfjs', folder);
  for (const file of await fs.readdir(directory)) if (!file.endsWith('.txt')) assets[folder + '/' + file] = (await fs.readFile(path.join(directory, file))).toString('base64');
}
await fs.writeFile(path.join(root, 'src/ui/pdf-assets.json'), JSON.stringify(assets));
await build({entryPoints: [path.join(root, 'src/main.js')], outfile: path.join(out, 'main.js'), bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['obsidian', 'electron'], legalComments: 'eof'});
await build({entryPoints: [path.join(root, 'src/ui/entry.js')], outfile: path.join(out, 'ui.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome110', define: {'process': 'undefined', 'import.meta.url': '"about:blank"'}, legalComments: 'eof', plugins: [{name: 'raw-worker', setup(build) {
  build.onResolve({filter: /\?raw$/}, args => ({path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw'}));
  build.onLoad({filter: /.*/, namespace: 'raw'}, async args => ({contents: await fs.readFile(args.path, 'utf8'), loader: 'text'}));
}}]});
let html = await fs.readFile(path.join(root, 'src/ui/sidepanel.html'), 'utf8');
html = html.replace('<button id="logout"', '<button id="cancelLogin" class="subtle">取消登录</button><button id="logout"');
// No API network access from the embedded UI; all official requests use the host.
html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob:; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; worker-src blob:; connect-src blob:; base-uri *;">');
await fs.writeFile(path.join(out, 'ui.html'), html);
await fs.copyFile(path.join(root, 'src/ui/style.css'), path.join(out, 'ui.css'));
let katex = await fs.readFile(path.join(root, 'src/ui/vendor/katex/katex.min.css'), 'utf8');
const references = [...katex.matchAll(/url\((fonts\/[^)]+)\)/g)].map(m => m[1]);
for (const file of new Set(references)) {
  const bytes = await fs.readFile(path.join(root, 'src/ui/vendor/katex', file));
  const type = file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : 'font/ttf';
  katex = katex.replaceAll('url(' + file + ')', 'url(data:' + type + ';base64,' + bytes.toString('base64') + ')');
}
await fs.writeFile(path.join(out, 'katex.css'), katex);
for (const file of ['manifest.json', 'styles.css', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'PRIVACY.md']) await fs.copyFile(path.join(root, file), path.join(out, file));
for (const file of ['marked-LICENSE.md', 'katex/LICENSE', 'katex/source.json', 'pdfjs/LICENSE', 'pdfjs/cmaps/LICENSE', 'pdfjs/standard_fonts/LICENSE_FOXIT', 'pdfjs/standard_fonts/LICENSE_LIBERATION']) {
  const dest = path.join(out, 'vendor', file);
  await fs.mkdir(path.dirname(dest), {recursive: true});
  await fs.copyFile(path.join(root, 'src/ui/vendor', file), dest);
}
console.log('Built desktop plugin:', path.relative(root, out));
