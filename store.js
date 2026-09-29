const fs = require('fs'), path = require('path');
const ROOT = process.env.DATA_DIR || __dirname; // على Railway وجّهه لمسار الـ Volume
const safe = b => { if (!/^[a-z0-9]+$/i.test(b)) throw new Error('bad id'); return b; };
const f = n => path.join(ROOT, 'data', n + '.json');
const read = n => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')); } catch { return []; } };
const write = (n, l) => { fs.mkdirSync(path.dirname(f(n)), { recursive: true }); fs.writeFileSync(f(n), JSON.stringify(l, null, 2)); };

// لكل بوت (توكن) ملف بيانات مستقل
const all = b => read('panels-' + safe(b));
const get = (b, id) => all(b).find(p => p.id === id);
const upsert = (b, p) => { const l = all(b); const i = l.findIndex(x => x.id === p.id); i >= 0 ? (l[i] = p) : l.push(p); write('panels-' + b, l); };
const remove = (b, id) => write('panels-' + safe(b), all(b).filter(p => p.id !== id));
const dropBot = b => { try { fs.unlinkSync(f('panels-' + safe(b))); } catch {} };

const bots = {
  all: () => read('bots'),
  add: b => write('bots', [...read('bots'), b]),
  remove: id => write('bots', read('bots').filter(b => b.id !== id))
};
module.exports = { all, get, upsert, remove, dropBot, bots, ROOT };
