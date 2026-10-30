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

test('index.html: 自前の JS・CSS はすべて ?v=dev 付き(公開時にコミットのハッシュへ置き換える)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
  assert.ok(local.length >= 9);
  for (const u of local) assert.match(u, /\?v=dev$/, u);
  // 読み込むファイルが実在する
  for (const u of local) assert.ok(fs.existsSync(path.join(root, u.split('?')[0])), u);
});
