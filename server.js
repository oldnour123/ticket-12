const express = require('express'), multer = require('multer'), path = require('path'), crypto = require('crypto');
const { ChannelType } = require('discord.js');
const store = require('./store'), { sendPanel } = require('./ui'), bots = require('./bots');

module.exports = () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '8mb' }));

  const PUBLIC = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const OWNERS = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const sessions = new Map(); // sid -> { admin, user, manage:Set, exp }
  const secure = PUBLIC.startsWith('https') ? '; Secure' : '';
  const cookie = (req, n) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(n + '='))?.slice(n.length + 1);
  const setCookie = (res, n, v, age = 604800) => res.append('Set-Cookie', `${n}=${v}; HttpOnly; Path=/; Max-Age=${age}; SameSite=Lax${secure}`);
  const newSession = (res, data) => { const id = crypto.randomBytes(24).toString('hex'); sessions.set(id, { ...data, exp: Date.now() + 6048e5 }); setCookie(res, 'sid', id); };

  const auth = (req, res, next) => {
    const s = sessions.get(cookie(req, 'sid'));
    if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'غير مصرح' });
    req.sess = s; next();
  };
  const adminOnly = (req, res, next) => req.sess.admin ? next() : res.status(403).json({ error: 'للمالك فقط' });

  const UP = path.join(store.ROOT, 'uploads');
  require('fs').mkdirSync(UP, { recursive: true });
  app.use('/uploads', express.static(UP));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

  // ===== تسجيل الدخول =====
  app.post('/login', (req, res) => { // دخول المالك بكلمة السر
    if (!process.env.DASH_PASSWORD || req.body.password !== process.env.DASH_PASSWORD)
      return res.status(401).json({ error: 'كلمة السر غلط' });
    newSession(res, { admin: true, user: { username: 'المالك' }, manage: new Set() });
    res.json({ ok: true });
  });
  app.get('/auth/discord', (req, res) => {
    if (!process.env.DISCORD_CLIENT_ID) return res.status(500).send('DISCORD_CLIENT_ID غير مضبوط');
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'st', state, 600);
    res.redirect('https://discord.com/oauth2/authorize?' + new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID, redirect_uri: `${PUBLIC}/auth/callback`,
      response_type: 'code', scope: 'identify guilds', state
    }));
  });
  app.get('/auth/callback', async (req, res) => {
    try {
      if (!req.query.code || req.query.state !== cookie(req, 'st')) throw new Error('state');
      const t = await (await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${PUBLIC}/auth/callback`
        })
      })).json();
      if (!t.access_token) throw new Error('token');
      const h = { Authorization: `Bearer ${t.access_token}` };
      const user = await (await fetch('https://discord.com/api/users/@me', { headers: h })).json();
      const guilds = await (await fetch('https://discord.com/api/users/@me/guilds', { headers: h })).json();
      // مالك السيرفر أو Administrator أو Manage Server
      const manage = new Set(guilds.filter(g => g.owner || (BigInt(g.permissions) & 0x28n) !== 0n).map(g => g.id));
      newSession(res, { admin: OWNERS.includes(user.id), user: { id: user.id, username: user.global_name || user.username,
        avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : '' }, manage });
      res.redirect('/');
    } catch { res.redirect('/?err=1'); }
  });
  app.post('/logout', (req, res) => { sessions.delete(cookie(req, 'sid')); res.json({ ok: true }); });
  app.get('/api/me', auth, (req, res) => res.json({ admin: req.sess.admin, user: req.sess.user }));

  // ===== الرفع =====
  const upload = multer({
    storage: multer.diskStorage({
      destination: UP,
      filename: (req, f, cb) => cb(null, crypto.randomBytes(10).toString('hex') + path.extname(f.originalname).toLowerCase())
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, f, cb) => cb(null, /^image\//.test(f.mimetype))
  });
  app.post('/api/upload', auth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'ملف الصورة غير صالح' });
    const base = PUBLIC || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base}/uploads/${req.file.filename}` });
  });

  // ===== البوتات (للمالك فقط) =====
  app.get('/api/bots', auth, adminOnly, (req, res) => res.json(bots.list()));
  app.post('/api/bots', auth, adminOnly, async (req, res) => {
    const token = String(req.body.token || '').trim();
    if (token.length < 50) return res.status(400).json({ error: 'التوكن غير صحيح' });
    if (bots.hasToken(token)) return res.status(400).json({ error: 'هذا التوكن مضاف مسبقاً' });
    const rec = { id: crypto.randomBytes(4).toString('hex'), token };
    const e = await bots.start(rec);
    if (e.status !== 'online') { const m = e.error; await bots.stop(rec.id); return res.status(400).json({ error: m || 'فشل تشغيل البوت' }); }
    store.bots.add(rec); res.json({ ok: true });
  });
  app.delete('/api/bots/:id', auth, adminOnly, async (req, res) => {
    if (req.params.id === 'main') return res.status(400).json({ error: 'البوت الأساسي يُحذف من المتغيرات' });
    await bots.stop(req.params.id); store.bots.remove(req.params.id); store.dropBot(req.params.id); res.json({ ok: true });
  });

  // ===== نقل البيانات بين الاستضافات (للمالك) =====
  const DATA = path.join(store.ROOT, 'data');
  app.get('/api/export', auth, adminOnly, (req, res) => {
    const fs = require('fs'), out = {};
    try { for (const f of fs.readdirSync(DATA)) if (/^[\w-]+\.json$/.test(f)) out[f] = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch {}
    res.setHeader('Content-Disposition', 'attachment; filename=store-bot-backup.json');
    res.json(out);
  });
  app.post('/api/import', auth, adminOnly, (req, res) => {
    const fs = require('fs'); fs.mkdirSync(DATA, { recursive: true });
    let n = 0;
    for (const [f, v] of Object.entries(req.body || {})) {
      if (!/^[\w-]+\.json$/.test(f)) continue;
      fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 2)); n++;
    }
    for (const b of store.bots.all()) if (!bots.get(b.id)) bots.start(b);
    res.json({ ok: true, files: n });
  });

  // ===== السيرفرات: اللي أنت تديرها وفيها بوت =====
  app.get('/api/servers', auth, (req, res) => {
    const out = [];
    for (const b of bots.list()) {
      const e = bots.get(b.id); if (e.status !== 'online') continue;
      for (const g of e.client.guilds.cache.values())
        if (req.sess.admin || req.sess.manage.has(g.id))
          out.push({ botId: b.id, botName: b.name, botAvatar: b.avatar, guildId: g.id, guildName: g.name, icon: g.iconURL({ size: 64 }) });
    }
    res.json(out);
  });

  // ===== كل شي تحت /api/s/:bot/:guild معزول لهذا البوت وهذا السيرفر =====
  const scope = (req, res, next) => {
    const e = bots.get(req.params.botId);
    if (!e || e.status !== 'online') return res.status(404).json({ error: 'البوت غير متصل' });
    const g = e.client.guilds.cache.get(req.params.guildId);
    if (!g) return res.status(404).json({ error: 'البوت غير موجود في هذا السيرفر' });
    if (!req.sess.admin && !req.sess.manage.has(g.id)) return res.status(403).json({ error: 'ما عندك صلاحية على هذا السيرفر' });
    req.e = e; req.g = g; next();
  };
  const S = '/api/s/:botId/:guildId';

  app.get(S + '/meta', auth, scope, async (req, res) => {
    const g = req.g; await g.roles.fetch().catch(() => {});
    res.json({
      channels: g.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name })),
      categories: g.channels.cache.filter(c => c.type === ChannelType.GuildCategory).map(c => ({ id: c.id, name: c.name })),
      roles: g.roles.cache.filter(r => r.id !== g.id && !r.managed).map(r => ({ id: r.id, name: r.name })),
      emojis: g.emojis.cache.map(x => ({ name: x.name, code: x.toString(), url: x.imageURL() }))
    });
  });

  const str = (v, n) => String(v ?? '').slice(0, n);
  const clean = (b, old, g) => ({
    id: str(b.id, 40), guildId: g.id, name: str(b.name, 60), title: str(b.title, 500), description: str(b.description, 1500),
    placeholder: str(b.placeholder, 100), bannerUrl: str(b.bannerUrl, 500),
    imagePosition: b.imagePosition === 'bottom' ? 'bottom' : 'top', color: str(b.color, 9) || '#2b3a67',
    showReset: b.showReset !== false, ticketTop: str(b.ticketTop, 500), ticketTitle: str(b.ticketTitle, 300), ticketDesc: str(b.ticketDesc ?? b.ticketWelcome, 1500),
    ticketBanner: /^https?:\/\//.test(b.ticketBanner || '') ? str(b.ticketBanner, 500) : '', afterImage: /^https?:\/\//.test(b.afterImage || '') ? str(b.afterImage, 500) : '',
    showTools: b.showTools !== false,
    links: (Array.isArray(b.links) ? b.links : []).slice(0, 5).map(l => ({ label: str(l.label, 80), url: /^https?:\/\//.test(l.url || '') ? str(l.url, 500) : '', emoji: str(l.emoji, 80) })).filter(l => l.label && l.url),
    channelId: g.channels.cache.has(b.channelId) ? b.channelId : '',
    categoryId: g.channels.cache.has(b.categoryId) ? b.categoryId : '',
    logChannelId: g.channels.cache.has(b.logChannelId) ? b.logChannelId : '',
    supportRoleId: g.roles.cache.has(b.supportRoleId) ? b.supportRoleId : '',
    messageId: old?.messageId || '',
    types: (Array.isArray(b.types) ? b.types : []).slice(0, 24).map(t => ({
      id: str(t.id, 30), label: str(t.label, 100) || 'بدون اسم', description: str(t.description, 100), emoji: str(t.emoji, 80),
      welcome: str(t.welcome, 1500), roleId: g.roles.cache.has(t.roleId) ? t.roleId : '',
      extras: (Array.isArray(t.extras) ? t.extras : []).slice(0, 3).map(x => ({
        id: str(x.id, 30) || crypto.randomBytes(4).toString('hex'), kind: x.kind === 'buttons' ? 'buttons' : 'select',
        title: str(x.title, 100), description: str(x.description, 500), placeholder: str(x.placeholder, 100),
        items: (Array.isArray(x.items) ? x.items : []).slice(0, x.kind === 'buttons' ? 5 : 25).map(it => ({
          id: str(it.id, 30) || crypto.randomBytes(4).toString('hex'), label: str(it.label, 80) || 'خيار',
          description: str(it.description, 100), emoji: str(it.emoji, 80), response: str(it.response, 1500)
        }))
      }))
    }))
  });
  const own = (req, res) => { // يتأكد أن اللوحة لنفس السيرفر
    const p = store.get(req.params.botId, req.params.id);
    if (p && p.guildId !== req.g.id) { res.status(403).json({ error: 'ممنوع' }); return null; }
    return p || false;
  };

  app.get(S + '/panels', auth, scope, (req, res) =>
    res.json(store.all(req.params.botId).filter(p => p.guildId === req.g.id)));
  app.put(S + '/panels/:id', auth, scope, (req, res) => {
    const old = own(req, res); if (old === null) return;
    const p = clean({ ...req.body, id: req.params.id }, old, req.g);
    store.upsert(req.params.botId, p); res.json(p);
  });
  app.delete(S + '/panels/:id', auth, scope, (req, res) => {
    if (own(req, res) === null) return;
    store.remove(req.params.botId, req.params.id); res.json({ ok: true });
  });
  app.post(S + '/panels/:id/send', auth, scope, async (req, res) => {
    const p = own(req, res); if (p === null) return;
    if (!p) return res.status(404).json({ error: 'اللوحة غير موجودة' });
    try { await sendPanel(req.e.client, req.params.botId, p); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ===== الردود التلقائية =====
  const arAll = b => store.kv.get(b, 'autoreplies', []);
  const cleanAr = (b, g) => ({
    id: str(b.id, 40), guildId: g.id, name: str(b.name, 60) || 'رد', enabled: b.enabled !== false,
    watchChannelId: g.channels.cache.has(b.watchChannelId) ? b.watchChannelId : '',
    match: ['any', 'contains', 'exact'].includes(b.match) ? b.match : 'any', keyword: str(b.keyword, 200),
    replyChannelId: g.channels.cache.has(b.replyChannelId) ? b.replyChannelId : '',
    replyToMessage: !!b.replyToMessage, deleteTrigger: !!b.deleteTrigger,
    title: str(b.title, 256), description: str(b.description, 3000), color: str(b.color, 9) || '#5b6cf0',
    imageUrl: /^https?:\/\//.test(b.imageUrl || '') ? str(b.imageUrl, 500) : '', imagePosition: b.imagePosition === 'bottom' ? 'bottom' : 'top'
  });
  app.get(S + '/autoreplies', auth, scope, (req, res) =>
    res.json(arAll(req.params.botId).filter(r => r.guildId === req.g.id)));
  app.put(S + '/autoreplies/:id', auth, scope, (req, res) => {
    const l = arAll(req.params.botId), i = l.findIndex(r => r.id === req.params.id);
    if (i >= 0 && l[i].guildId !== req.g.id) return res.status(403).json({ error: 'ممنوع' });
    if (i < 0 && l.filter(r => r.guildId === req.g.id).length >= 25) return res.status(400).json({ error: 'الحد الأقصى 25 رد' });
    const r = cleanAr({ ...req.body, id: req.params.id }, req.g);
    i >= 0 ? (l[i] = r) : l.push(r);
    store.kv.set(req.params.botId, 'autoreplies', l); res.json(r);
  });
  app.delete(S + '/autoreplies/:id', auth, scope, (req, res) => {
    const l = arAll(req.params.botId);
    store.kv.set(req.params.botId, 'autoreplies', l.filter(r => !(r.id === req.params.id && r.guildId === req.g.id)));
    res.json({ ok: true });
  });

  app.listen(process.env.PORT || 3000, () => console.log(`الداشبورد يعمل على المنفذ ${process.env.PORT || 3000}`));
};
