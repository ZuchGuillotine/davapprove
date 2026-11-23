/* Standalone and embedded entry points must both retain workspace navigation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../web/node_modules/jsdom');
const root = path.join(__dirname, '../bid-assistant');
const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'lib/workspace-navigation.js'), 'utf8');
for (const embedded of [false, true]) {
  const dom = new JSDOM(markup, { url: 'https://example.test/bid-assistant/index.html' + (embedded ? '?embedded=1' : ''), runScripts: 'outside-only' });
  dom.window.eval(navigation);
  const nav = dom.window.document.querySelector('nav[aria-label="Workspace navigation"]');
  assert.equal(nav.hidden, embedded, 'standalone exposes return navigation; embedded uses host navigation');
  const link = nav.querySelector('a');
  assert.equal(new URL(link.href).pathname, '/');
  assert.equal(new URL(link.href).searchParams.get('workspace'), 'projects');
  assert.equal(link.target, '_top', 'return never opens the app inside the assessment iframe');
  dom.window.close();
}
// The inline guard sends hosted standalone visits into the signed-in workspace on any domain.
const guard = markup.match(/<script>([\s\S]*?)<\/script>/)[1];
function visit(href) {
  const url = new URL(href);
  let replaced = null;
  const location = { search: url.search, hash: url.hash, hostname: url.hostname, replace: target => { replaced = target; } };
  new Function('location', 'URLSearchParams', guard)(location, URLSearchParams);
  return replaced;
}
assert.equal(visit('https://davapprove.com/bid-assistant/index.html#parcel=1&county=wa-king&secret=x'), '/?workspace=bids#parcel=1&county=wa-king');
assert.equal(visit('https://www.davapprove.com/bid-assistant/index.html'), '/?workspace=bids#');
assert.equal(visit('https://davapprove-preview.example.workers.dev/bid-assistant/index.html?public=1'), '/?workspace=bids#', 'the old public bypass is gone');
assert.equal(visit('https://davapprove.com/bid-assistant/index.html?embedded=1'), null, 'the workspace frame itself is not redirected');
assert.equal(visit('http://localhost:8080/index.html'), null, 'local development keeps the standalone page');
assert.equal(visit('http://127.0.0.1:8080/index.html'), null);
console.log('Bid workspace navigation tests passed.');
