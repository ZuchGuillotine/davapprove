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
console.log('Bid workspace navigation tests passed.');
