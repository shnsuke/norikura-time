const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('manifest: アプリとしてインストールできる項目とアイコンがそろっている', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name && m.start_url && m.id);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.ok(fs.existsSync(path.join(root, 'icons/apple-touch-icon.png')));
});
