#!/usr/bin/env node
/*
 * menus.json の全メニューを Zwift 用 .zwo に書き出す。
 *   node tools/export-zwo.js [出力先 (既定: zwo)]
 * 出力: zwo/<番号>-<期id>/<テンプレート>-<曜日>.zwo
 * このフォルダごと Zwift の Workouts/<ZwiftID>/ に置くと、期ごとのフォルダで表示される。
 */
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../calc.js');
const Zwo = require('../zwo.js');

const root = path.join(__dirname, '..');
const outDir = path.resolve(root, process.argv[2] || 'zwo');
const menus = JSON.parse(fs.readFileSync(path.join(root, 'menus.json'), 'utf8'));

function templateLabel(key) {
  let m;
  if (key === 'load') return '負荷週';
  if (key === 'recovery') return '回復週';
  if ((m = key.match(/^load(\d+)$/))) return `負荷週${m[1]}`;
  if ((m = key.match(/^block(\d+)Recovery$/))) return `B${m[1]}回復週`;
  if ((m = key.match(/^block(\d+)$/))) return `B${m[1]}負荷週`;
  if ((m = key.match(/^week(\d+)$/))) return `${m[1]}週目`;
  return key;
}

fs.rmSync(outDir, { recursive: true, force: true });
let count = 0;
menus.phases.forEach((phase, i) => {
  const dir = path.join(outDir, `${i + 1}-${phase.id}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [key, days] of Object.entries(phase.templates || {})) {
    for (const day of Calc.WEEK_ORDER) {
      const menu = days[day];
      if (!menu) continue;
      const name = `${phase.name} ${templateLabel(key)} ${Calc.DAY_LABELS[day]} ${menu.title}`;
      const xml = Zwo.menuToZwo(menu, { name, description: `${phase.name}（${phase.focus || ''}）` });
      fs.writeFileSync(path.join(dir, `${key}-${Calc.WEEK_ORDER.indexOf(day) + 1}${day}.zwo`), xml);
      count++;
    }
  }
});
console.log(`${count} 件を ${path.relative(process.cwd(), outDir) || '.'} に書き出しました`);
