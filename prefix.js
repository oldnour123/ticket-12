// أوامر البريفكس ($) + قائمة $help بالكونتينر
const {
  ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  MessageFlags, PermissionFlagsBits: P
} = require('discord.js');
const store = require('./store');

const V2 = MessageFlags.IsComponentsV2, EPH = MessageFlags.Ephemeral;
const PREFIX = process.env.PREFIX || '$';
const OWNERS = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const db = (b, n, d = {}) => store.kv.get(b, n, d), put = (b, n, v) => store.kv.set(b, n, v);
const box = (t, c = 0x5865f2) => new ContainerBuilder().setAccentColor(c).addTextDisplayComponents(new TextDisplayBuilder().setContent(String(t).slice(0, 3900)));
const reply = (m, t, c) => m.reply({ components: [box(t, c)], flags: V2, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
const ok = (m, t) => reply(m, '✅ ' + t, 0x57f287), no = (m, t) => reply(m, '❌ ' + t, 0xed4245);
const uid = s => (String(s || '').match(/\d{15,20}/) || [])[0];
const mem = (m, s) => { const i = uid(s); return i ? m.guild.members.fetch(i).catch(() => null) : Promise.resolve(null); };
const dur = s => { const x = /^(\d+)([smhd])$/i.exec(s || ''); return x ? +x[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[x[2].toLowerCase()] : null; };
const mlog = (m, t) => m.guild.channels.cache.get(db(m.client.botId, 'logch')[m.guild.id])?.send({ content: t, allowedMentions: { parse: [] } }).catch(() => {});
const top = (obj, n = 10) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

// ===== تسجيل الأوامر =====
const CATS = {
  owner: ['👑', 'Owner Commands'], system: ['⚙️', 'System Commands'], mod: ['🛠️', 'Moderation'], general: ['🌐', 'General Commands'],
  admin: ['🧰', 'Admin Commands'], greet: ['✅', 'Greet System'], staff: ['👮', 'Staff Commands']
};
const C = new Map();
const add = (name, cat, desc, o, run) => C.set(name, { name, cat, desc, ...o, run });

// --- Owner ---
add('setname', 'owner', 'Change the bot name', { owner: 1 }, async ({ m, rest }) => { if (!rest) return no(m, 'Usage: setname <name>'); await m.client.user.setUsername(rest.slice(0, 32)); ok(m, 'Bot name updated'); });
add('setavatar', 'owner', 'Change the bot avatar (link or attachment)', { owner: 1 }, async ({ m, args }) => { const u = args[0] || m.attachments.first()?.url; if (!u) return no(m, 'Send an image link or attach an image'); await m.client.user.setAvatar(u); ok(m, 'Bot avatar updated'); });
add('setbanner', 'owner', 'Change the bot banner (link or attachment)', { owner: 1 }, async ({ m, args }) => { const u = args[0] || m.attachments.first()?.url; if (!u) return no(m, 'Send an image link or attach an image'); await m.client.user.setBanner(u); ok(m, 'Bot banner updated'); });
add('setbio', 'owner', 'Change the bot description', { owner: 1 }, async ({ m, rest }) => { await m.client.application.edit({ description: rest.slice(0, 400) }); ok(m, 'Bot description updated'); });

// --- System ---
const bl = (name, desc, on) => add(name, 'system', desc, { perm: P.Administrator }, async ({ m, args, botId }) => {
  const id = uid(args[0]); if (!id) return no(m, `Usage: ${name} @user`);
  const l = db(botId, 'blacklist'); const a = new Set(l[m.guild.id] || []); on ? a.add(id) : a.delete(id);
  l[m.guild.id] = [...a]; put(botId, 'blacklist', l); ok(m, `<@${id}> ${on ? 'can no longer use the bot commands' : 'can use the bot commands again'}`);
});
bl('blacklist', 'Block a member from using bot commands', true); bl('unblacklist', 'Unblock a member', false);
add('log', 'system', 'Set the moderation log channel (or `log off`)', { perm: P.Administrator }, async ({ m, args, botId }) => {
  const l = db(botId, 'logch'); const id = args[0] === 'off' ? null : uid(args[0]) || m.channel.id;
  id ? (l[m.guild.id] = id) : delete l[m.guild.id]; put(botId, 'logch', l); ok(m, id ? `Log channel set to <#${id}>` : 'Log disabled');
});
add('aliases', 'system', 'Add a command shortcut: aliases <alias> <command> (no args = list)', { perm: P.Administrator }, async ({ m, args, botId }) => {
  const a = db(botId, 'aliases'); const g = a[m.guild.id] || {};
  if (!args[0]) return reply(m, '**Aliases**\n' + (Object.entries(g).map(([k, v]) => `\`${PREFIX}${k}\` → \`${PREFIX}${v}\``).join('\n') || 'None'));
  if (!C.has((args[1] || '').toLowerCase())) return no(m, 'Unknown command');
  g[args[0].toLowerCase()] = args[1].toLowerCase(); a[m.guild.id] = g; put(botId, 'aliases', a); ok(m, `Alias \`${args[0]}\` added`);
});
add('remove-aliases', 'system', 'Remove a command shortcut', { perm: P.Administrator }, async ({ m, args, botId }) => {
  const a = db(botId, 'aliases'); if (!a[m.guild.id]?.[args[0]]) return no(m, 'Alias not found');
  delete a[m.guild.id][args[0]]; put(botId, 'aliases', a); ok(m, 'Alias removed');
});

// --- Moderation ---
add('warn', 'mod', 'Warn a user', { perm: P.ModerateMembers }, async ({ m, args, botId }) => {
  const mb = await mem(m, args[0]); if (!mb) return no(m, 'Usage: warn @user [reason]');
  const w = db(botId, 'warns'); const e = { id: Math.random().toString(36).slice(2, 8), reason: args.slice(1).join(' ') || 'No reason', by: m.author.id, ts: Math.floor(Date.now() / 1000) };
  ((w[m.guild.id] ??= {})[mb.id] ??= []).push(e); put(botId, 'warns', w);
  ok(m, `<@${mb.id}> was warned (ID \`${e.id}\`): ${e.reason}`); mlog(m, `⚠️ <@${m.author.id}> warned <@${mb.id}>: ${e.reason}`);
});
add('warns', 'mod', 'View warnings for a user or list all warned users', { perm: P.ModerateMembers }, async ({ m, args, botId }) => {
  const g = db(botId, 'warns')[m.guild.id] || {}; const id = uid(args[0]);
  if (id) return reply(m, `**Warnings for <@${id}>**\n` + ((g[id] || []).map(e => `\`${e.id}\` • ${e.reason} • <t:${e.ts}:R> • by <@${e.by}>`).join('\n') || 'No warnings'));
  reply(m, '**Warned users**\n' + (Object.entries(g).filter(([, v]) => v.length).map(([k, v]) => `<@${k}> • ${v.length}`).join('\n') || 'Nobody has warnings'));
});
add('removewarn', 'mod', 'Remove a warning by ID', { perm: P.ModerateMembers }, async ({ m, args, botId }) => {
  const w = db(botId, 'warns'); const g = w[m.guild.id] || {};
  for (const k of Object.keys(g)) { const n = g[k].filter(e => e.id !== args[0]); if (n.length !== g[k].length) { g[k] = n; put(botId, 'warns', w); return ok(m, 'Warning removed'); } }
  no(m, 'Warning ID not found');
});
add('resetwarns', 'mod', 'Delete ALL warnings in the server (Admin only)', { perm: P.Administrator }, async ({ m, botId }) => { const w = db(botId, 'warns'); delete w[m.guild.id]; put(botId, 'warns', w); ok(m, 'All warnings deleted'); });
add('mute', 'mod', 'Timeout a user: mute @user [10m] [reason]', { perm: P.ModerateMembers }, async ({ m, args }) => {
  const mb = await mem(m, args[0]); if (!mb) return no(m, 'Usage: mute @user [10m] [reason]');
  const ms = Math.min(dur(args[1]) || 6e5, 28 * 864e5); await mb.timeout(ms, args.slice(dur(args[1]) ? 2 : 1).join(' ') || undefined);
  ok(m, `<@${mb.id}> muted until <t:${Math.floor((Date.now() + ms) / 1000)}:R>`); mlog(m, `🔇 <@${m.author.id}> muted <@${mb.id}>`);
});
add('unmute', 'mod', 'Remove a timeout', { perm: P.ModerateMembers }, async ({ m, args }) => { const mb = await mem(m, args[0]); if (!mb) return no(m, 'Usage: unmute @user'); await mb.timeout(null); ok(m, `<@${mb.id}> unmuted`); });
add('slowmode', 'mod', 'Set slowmode (e.g. 5s, 1m, 1h, 6h, or off)', { perm: P.ManageChannels }, async ({ m, args }) => {
  const ms = args[0] === 'off' ? 0 : dur(args[0]); if (ms === null) return no(m, 'Usage: slowmode 5s | 1m | 1h | off');
  await m.channel.setRateLimitPerUser(Math.min(ms / 1e3, 21600)); ok(m, ms ? `Slowmode set to ${args[0]}` : 'Slowmode disabled');
});
const ow = (name, desc, flag, on) => add(name, 'mod', desc, { perm: P.ManageChannels }, async ({ m }) => {
  await m.channel.permissionOverwrites.edit(m.guild.id, { [flag]: on ? null : false }); ok(m, `Channel ${name}ed`.replace('showed', 'visible').replace('unlocked', 'unlocked'));
});
ow('lock', 'Lock the channel (no one can write)', 'SendMessages', false); ow('unlock', 'Unlock the channel', 'SendMessages', true);
ow('hide', 'Hide the channel from members', 'ViewChannel', false); ow('show', 'Show the channel to members again', 'ViewChannel', true);
for (const [n, on] of [['hide-all', false], ['show-all', true]])
  add(n, 'mod', on ? 'Show all channels again' : 'Hide all channels from members', { perm: P.Administrator }, async ({ m }) => {
    let c = 0; for (const ch of m.guild.channels.cache.values()) { if (ch.isThread()) continue; await ch.permissionOverwrites.edit(m.guild.id, { ViewChannel: on ? null : false }).then(() => c++).catch(() => {}); }
    ok(m, `Done (${c} channels)`);
  });

// --- Admin ---
add('ban', 'admin', 'Ban a member', { perm: P.BanMembers }, async ({ m, args }) => {
  const id = uid(args[0]); if (!id) return no(m, 'Usage: ban @user [reason]');
  await m.guild.members.ban(id, { reason: args.slice(1).join(' ') || undefined }); ok(m, `<@${id}> banned`); mlog(m, `🔨 <@${m.author.id}> banned <@${id}>`);
});
add('kick', 'admin', 'Kick a member', { perm: P.KickMembers }, async ({ m, args }) => {
  const mb = await mem(m, args[0]); if (!mb) return no(m, 'Usage: kick @user [reason]');
  await mb.kick(args.slice(1).join(' ') || undefined); ok(m, `<@${mb.id}> kicked`); mlog(m, `👢 <@${m.author.id}> kicked <@${mb.id}>`);
});
add('clear', 'admin', 'Delete a number of messages (max 100)', { perm: P.ManageMessages }, async ({ m, args }) => {
  const n = Math.min(parseInt(args[0]) || 0, 99); if (!n) return no(m, 'Usage: clear <number>');
  await m.channel.bulkDelete(n + 1, true); const r = await m.channel.send({ components: [box(`🧹 Deleted ${n} messages`, 0x57f287)], flags: V2 }); setTimeout(() => r.delete().catch(() => {}), 3000);
});
add('dm', 'admin', 'Send a private message to a member', { perm: P.Administrator }, async ({ m, args }) => {
  const u = await m.client.users.fetch(uid(args[0]) || '0').catch(() => null); const t = args.slice(1).join(' ');
  if (!u || !t) return no(m, 'Usage: dm @user <message>'); await u.send(t).then(() => ok(m, 'Message sent')).catch(() => no(m, 'The user has DMs closed'));
});
add('createrole', 'admin', 'Create a new role: createrole <name> [#color]', { perm: P.ManageRoles }, async ({ m, args }) => {
  const c = args.find(a => /^#?[0-9a-f]{6}$/i.test(a)); const name = args.filter(a => a !== c).join(' '); if (!name) return no(m, 'Usage: createrole <name> [#color]');
  const r = await m.guild.roles.create({ name, color: c ? '#' + c.replace('#', '') : undefined }); ok(m, `Role <@&${r.id}> created`);
});
add('addemoji', 'admin', 'Add an emoji to the server (emoji, link or attachment)', { perm: P.ManageGuildExpressions }, async ({ m, args }) => {
  const ce = /^<(a?):(\w+):(\d+)>$/.exec(args[0] || ''); const url = ce ? `https://cdn.discordapp.com/emojis/${ce[3]}.${ce[1] ? 'gif' : 'png'}` : (args[0]?.startsWith('http') ? args[0] : m.attachments.first()?.url);
  if (!url) return no(m, 'Usage: addemoji <emoji | link> [name]'); const e = await m.guild.emojis.create({ attachment: url, name: args[1] || ce?.[2] || 'emoji' }); ok(m, `Emoji added: ${e}`);
});
add('addsticker', 'admin', 'Add a sticker to the server (link or attachment)', { perm: P.ManageGuildExpressions }, async ({ m, args }) => {
  const url = m.attachments.first()?.url || (args[0]?.startsWith('http') ? args[0] : null); if (!url) return no(m, 'Usage: addsticker <link> [name] or attach an image');
  await m.guild.stickers.create({ file: url, name: (m.attachments.size ? args[0] : args[1]) || 'sticker', tags: 'star' }); ok(m, 'Sticker added');
});
add('bots', 'admin', 'List the bots in the server', { perm: P.ManageGuild }, async ({ m }) => {
  const all = await m.guild.members.fetch(); reply(m, '**Bots**\n' + (all.filter(x => x.user.bot).map(x => `<@${x.id}>`).join('\n') || 'None'));
});
add('inrole', 'admin', 'List all members having a specific role', { perm: P.ManageRoles }, async ({ m, args }) => {
  const r = m.guild.roles.cache.get(uid(args[0])); if (!r) return no(m, 'Usage: inrole @role'); await m.guild.members.fetch();
  const l = r.members.map(x => `<@${x.id}>`); reply(m, `**${r.name}** • ${l.length} members\n` + l.slice(0, 60).join(' '));
});
add('come', 'admin', 'Call a member to the current channel (DM)', { perm: P.Administrator }, async ({ m, args }) => {
  const mb = await mem(m, args[0]); if (!mb) return no(m, 'Usage: come @user');
  await mb.send(`📢 <@${m.author.id}> is calling you in ${m.channel.url}`).then(() => ok(m, `<@${mb.id}> was called`)).catch(() => no(m, 'The user has DMs closed'));
});
add('move', 'admin', 'Pull a member to your voice channel', { perm: P.MoveMembers }, async ({ m, args }) => {
  const mb = await mem(m, args[0]), vc = m.member.voice.channel; if (!mb || !vc) return no(m, 'Join a voice channel first, then: move @user');
  if (!mb.voice.channel) return no(m, 'That member is not in a voice channel'); await mb.voice.setChannel(vc); ok(m, `<@${mb.id}> moved to ${vc}`);
});
add('managepoints', 'admin', 'Add or remove staff points: managepoints add|remove @user <n>', { perm: P.Administrator }, async ({ m, args, botId }) => {
  const id = uid(args[1]), n = parseInt(args[2]); if (!['add', 'remove'].includes(args[0]) || !id || !n) return no(m, 'Usage: managepoints add|remove @user <number>');
  const p = db(botId, 'points'); const g = (p[m.guild.id] ??= {}); g[id] = Math.max(0, (g[id] || 0) + (args[0] === 'add' ? n : -n)); put(botId, 'points', p); ok(m, `<@${id}> now has **${g[id]}** points`);
});

// --- General ---
const afk = new Map(), snipes = new Map();
add('help', 'general', 'Show the commands list', {}, async ({ m }) => m.reply({ components: [helpBox({ uid: m.author.id, bot: m.client.user, guild: m.guild.name, name: m.member.displayName })], flags: V2, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {}));
add('afk', 'general', 'Set your AFK status', {}, async ({ m, rest }) => { afk.set(`${m.guild.id}:${m.author.id}`, { r: rest || 'AFK', ts: Math.floor(Date.now() / 1000) }); ok(m, `You are now AFK: ${rest || 'AFK'}`); });
const target = async (m, a) => (await m.client.users.fetch(uid(a) || m.author.id).catch(() => null)) || m.author;
add('avatar', 'general', 'Show the avatar of a user', {}, async ({ m, args }) => { const u = await target(m, args[0]);
  m.reply({ components: [box(`## ${u.username}'s Avatar`).addMediaGalleryComponents(new MediaGalleryBuilder().addItems({ media: { url: u.displayAvatarURL({ size: 1024 }) } }))], flags: V2, allowedMentions: { repliedUser: false } }).catch(() => {}); });
add('banner', 'general', 'Show the banner of a user', {}, async ({ m, args }) => { const u = await (await target(m, args[0])).fetch(true); const b = u.bannerURL({ size: 1024 }); if (!b) return no(m, 'This user has no banner');
  m.reply({ components: [box(`## ${u.username}'s Banner`).addMediaGalleryComponents(new MediaGalleryBuilder().addItems({ media: { url: b } }))], flags: V2, allowedMentions: { repliedUser: false } }).catch(() => {}); });
add('calc', 'general', 'Simple math: calc 5*(3+2)', {}, async ({ m, rest }) => {
  const e = rest.replace(/\^/g, '**'); if (!e || !/^[\d\s+\-*/().%]+$/.test(e) || e.length > 80) return no(m, 'Usage: calc 5*(3+2)');
  let r; try { r = Function(`"use strict";return (${e})`)(); } catch { return no(m, 'Invalid expression'); } if (!Number.isFinite(r)) return no(m, 'Invalid expression'); reply(m, `🧮 \`${rest}\` = **${r}**`);
});
add('font', 'general', 'Convert text to bold font', {}, async ({ m, rest }) => { if (!rest) return no(m, 'Usage: font <text>');
  reply(m, [...rest].map(c => { const k = c.codePointAt(0); return k >= 65 && k <= 90 ? String.fromCodePoint(0x1d5d4 + k - 65) : k >= 97 && k <= 122 ? String.fromCodePoint(0x1d5ee + k - 97) : k >= 48 && k <= 57 ? String.fromCodePoint(0x1d7ec + k - 48) : c; }).join('')); });
add('id', 'general', 'Check user statistics', {}, async ({ m, args }) => { const u = await target(m, args[0]), mb = await m.guild.members.fetch(u.id).catch(() => null);
  reply(m, `## ${u.username}\n**ID:** \`${u.id}\`\n**Created:** <t:${Math.floor(u.createdTimestamp / 1e3)}:R>` + (mb ? `\n**Joined:** <t:${Math.floor(mb.joinedTimestamp / 1e3)}:R>` : '')); });
add('roles', 'general', 'Show all server roles (without bot roles)', {}, async ({ m }) => reply(m, '**Roles**\n' + m.guild.roles.cache.filter(r => !r.managed && r.id !== m.guild.id).sort((a, b) => b.position - a.position).map(r => `<@&${r.id}>`).join(' ').slice(0, 3500)));
add('say', 'general', 'Send a message as the bot (admins only)', { perm: P.Administrator }, async ({ m, rest }) => { if (!rest) return no(m, 'Usage: say <message>'); m.delete().catch(() => {}); m.channel.send({ content: rest, allowedMentions: { parse: [] } }); });
add('snipe', 'general', 'Show the last deleted message in the channel', {}, async ({ m }) => { const s = snipes.get(m.channelId); if (!s) return no(m, 'Nothing to snipe'); reply(m, `**Last deleted message**\n<@${s.by}> • <t:${s.ts}:R>\n> ${s.text.slice(0, 1500)}`); });
add('tax', 'general', 'ProBot tax calculator: tax 60m', {}, async ({ m, args, botId }) => { const E = require('./extras'), a = E.parseAmount(args[0]); if (a === null) return no(m, 'Usage: tax 60m | 200k | 1500'); reply(m, E.taxText(E.calcTax(a, E.getTax(botId, m.guild.id).feePercent))); });
add('top', 'general', 'Display the server text leaderboard', {}, async ({ m, botId }) => reply(m, '**🏆 Text Leaderboard**\n' + (top(db(botId, 'stats')[m.guild.id]).map(([k, v], i) => `**${i + 1}.** <@${k}> • ${v} messages`).join('\n') || 'No data yet')));

// --- Greet ---
const gcfg = (b, g) => db(b, 'greet')[g] || {}, gset = (b, g, f) => { const a = db(b, 'greet'); a[g] = { ...(a[g] || {}), ...f }; put(b, 'greet', a); return a[g]; };
add('greet', 'greet', 'Toggle the welcome message in this channel', { perm: P.ManageGuild }, async ({ m, botId }) => {
  const c = gcfg(botId, m.guild.id), on = !(c.enabled && c.channelId === m.channel.id); gset(botId, m.guild.id, { enabled: on, channelId: m.channel.id }); ok(m, on ? `Welcome messages enabled in ${m.channel}` : 'Welcome messages disabled');
});
add('greetmsg', 'greet', 'Set the welcome message ({user} {server} {count})', { perm: P.ManageGuild }, async ({ m, rest, botId }) => { if (!rest) return no(m, 'Usage: greetmsg Welcome {user} to {server}!'); gset(botId, m.guild.id, { message: rest.slice(0, 1500) }); ok(m, 'Welcome message saved'); });
add('greetdel', 'greet', 'Set auto-delete time for welcome messages (e.g. 10s or off)', { perm: P.ManageGuild }, async ({ m, args, botId }) => {
  const ms = args[0] === 'off' ? 0 : dur(args[0]); if (ms === null) return no(m, 'Usage: greetdel 10s | off'); gset(botId, m.guild.id, { delSec: ms / 1e3 }); ok(m, ms ? `Auto-delete set to ${args[0]}` : 'Auto-delete disabled');
});
add('greetshow', 'greet', 'Show greet settings', { perm: P.ManageGuild }, async ({ m, botId }) => { const c = gcfg(botId, m.guild.id);
  reply(m, `**Greet settings**\n**Status:** ${c.enabled ? 'On' : 'Off'}\n**Channel:** ${c.channelId ? `<#${c.channelId}>` : '—'}\n**Auto-delete:** ${c.delSec ? c.delSec + 's' : 'Off'}\n**Message:** ${c.message || 'Welcome {user} to **{server}**!'}`); });

// --- Staff (النقاط تزيد تلقائياً لما الستاف يستلم تذكرة بزر Claim) ---
add('points', 'staff', 'Display your points or another user\'s points', {}, async ({ m, args, botId }) => { const id = uid(args[0]) || m.author.id; reply(m, `⭐ <@${id}> has **${db(botId, 'points')[m.guild.id]?.[id] || 0}** points`); });
add('top-points', 'staff', 'Display top 10 users with points', {}, async ({ m, botId }) => reply(m, '**🏅 Top Staff Points**\n' + (top(db(botId, 'points')[m.guild.id]).map(([k, v], i) => `**${i + 1}.** <@${k}> • ${v}`).join('\n') || 'No points yet')));

// ===== قائمة المساعدة =====
function helpBox(c, k) {
  const cont = new ContainerBuilder().setAccentColor(0x2b2d31);
  if (!k) cont.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Hello, <@${c.uid}>!\n> I am <@${c.bot.id}>, a powerful bot made for **${c.guild}** with advanced features.\n\nℹ️ **Select a category below to explore my commands!**`));
  else {
    const list = [...C.values()].filter(x => x.cat === k).map(x => `🔵 \`${PREFIX}${x.name}\`\n💎 ${x.desc}`).join('\n\n');
    cont.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${CATS[k][0]} ${CATS[k][1]}\n\n${list}`.slice(0, 3600)));
    cont.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Requested By ${c.name}**`));
  }
  const used = [...new Set([...C.values()].map(x => x.cat))];
  return cont.addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`hlp:${c.uid}`)
    .setPlaceholder('Select a category to view commands').addOptions(Object.keys(CATS).filter(x => used.includes(x)).map(x => ({ label: CATS[x][1], value: x, emoji: CATS[x][0] })))));
}
async function interaction(i) {
  if (!(i.isStringSelectMenu() && i.customId.startsWith('hlp:'))) return false;
  if (i.customId.slice(4) !== i.user.id) { await i.reply({ content: '❌ This menu is not for you.', flags: EPH }); return true; }
  await i.update({ components: [helpBox({ uid: i.user.id, bot: i.client.user, guild: i.guild.name, name: i.member.displayName }, i.values[0])], flags: V2 });
  return true;
}

// ===== معالجة الرسائل =====
const sc = new Map(), dirty = new Set();
setInterval(() => { for (const b of dirty) put(b, 'stats', sc.get(b)); dirty.clear(); }, 60000).unref();
const bump = (b, g, u) => { let s = sc.get(b); if (!s) sc.set(b, s = db(b, 'stats')); ((s[g] ??= {})[u] = (s[g][u] || 0) + 1); dirty.add(b); };

async function handle(m, botId) {
  if (m.author.bot || !m.guild) return;
  bump(botId, m.guild.id, m.author.id);
  const key = `${m.guild.id}:${m.author.id}`;
  if (afk.has(key) && !m.content.toLowerCase().startsWith(`${PREFIX}afk`)) { afk.delete(key); reply(m, `👋 Welcome back <@${m.author.id}>, I removed your AFK.`); }
  for (const u of m.mentions.users.values()) { const a = afk.get(`${m.guild.id}:${u.id}`); if (a) reply(m, `💤 <@${u.id}> is AFK: ${a.r} • <t:${a.ts}:R>`); }
  if (!m.content.startsWith(PREFIX)) return;
  const [raw, ...args] = m.content.slice(PREFIX.length).trim().split(/\s+/);
  const name = ((db(botId, 'aliases')[m.guild.id] || {})[raw.toLowerCase()]) || raw.toLowerCase();
  const cmd = C.get(name); if (!cmd) return;
  const isAdmin = m.member.permissions.has(P.Administrator);
  if (!isAdmin && (db(botId, 'blacklist')[m.guild.id] || []).includes(m.author.id)) return;
  if (cmd.owner && !OWNERS.includes(m.author.id)) return no(m, 'This command is for the bot owner only.');
  if (cmd.perm && !m.member.permissions.has(cmd.perm)) return no(m, 'You do not have permission to use this command.');
  try { await cmd.run({ m, args, rest: args.join(' '), botId }); }
  catch (e) { no(m, `Failed: ${String(e.message).slice(0, 120)}`); }
}
const onDelete = msg => { if (msg.guild && msg.content && !msg.author?.bot) snipes.set(msg.channelId, { text: msg.content, by: msg.author.id, ts: Math.floor(Date.now() / 1000) }); };
async function greet(mb, botId) {
  const c = gcfg(botId, mb.guild.id); if (!c.enabled || !c.channelId) return;
  const ch = mb.guild.channels.cache.get(c.channelId); if (!ch) return;
  const text = (c.message || 'Welcome {user} to **{server}**!').replace(/\{user\}/g, `<@${mb.id}>`).replace(/\{server\}/g, mb.guild.name).replace(/\{count\}/g, mb.guild.memberCount);
  const r = await ch.send({ content: text, allowedMentions: { users: [mb.id] } }).catch(() => null);
  if (r && c.delSec) setTimeout(() => r.delete().catch(() => {}), c.delSec * 1000);
}
const addPoint = (b, g, u) => { const p = db(b, 'points'); ((p[g] ??= {})[u] = (p[g][u] || 0) + 1); put(b, 'points', p); };

module.exports = { handle, interaction, onDelete, greet, addPoint };
