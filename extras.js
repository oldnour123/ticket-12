// الأوامر: /create  /say  /tax  /tax-setup  + حاسبة الضريبة بالرسائل
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder } = require('discord.js');
const store = require('./store'), B = require('./builder'), prefix = require('./prefix');

const EPH = MessageFlags.Ephemeral;
const ADMIN = PermissionFlagsBits.Administrator;
const isAdmin = i => i.memberPermissions?.has(ADMIN);
const deny = i => i.reply({ content: '❌ ما عندك صلاحية تستخدم هالأمر.', flags: EPH });

const commands = [
  new SlashCommandBuilder().setName('create').setDescription('بناء رسالة كونتينر مخصصة بأزرار أو قائمة اختيار (أدمن فقط)')
    .setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('say').setDescription('يخلي البوت يرسل رسالة نيابة عنك (أدمن فقط)')
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(o => o.setName('message').setDescription('نص الرسالة (استخدم \\n لسطر جديد)').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('الروم (افتراضي: نفس الروم الحالي)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  new SlashCommandBuilder().setName('tax').setDescription('احسب الضريبة (المبلغ المطلوب تحويله)')
    .addStringOption(o => o.setName('amount').setDescription('المبلغ مثل 60m أو 200k أو 1500').setRequired(true)),
  new SlashCommandBuilder().setName('tax-setup').setDescription('إعداد روم الضريبة التلقائي (أدمن فقط)')
    .setDefaultMemberPermissions(ADMIN)
    .addChannelOption(o => o.setName('channel').setDescription('روم الضريبة: أي مبلغ يُكتب فيه يرد البوت بالضريبة').addChannelTypes(ChannelType.GuildText))
    .addNumberOption(o => o.setName('percent').setDescription('نسبة الضريبة (افتراضي 5)').setMinValue(0).setMaxValue(99))
    .addBooleanOption(o => o.setName('enabled').setDescription('تشغيل أو إيقاف'))
].map(c => c.toJSON());

const register = g => g.commands.set(commands).catch(e => console.error('تسجيل الأوامر:', e.message));
const registerAll = client => client.guilds.cache.forEach(register);

// ===== الضريبة =====
const UNITS = { k: 1e3, m: 1e6, b: 1e9 };
function parseAmount(raw) {
  const m = String(raw).trim().toLowerCase().replace(/,/g, '').match(/^(\d+(\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return !n || n <= 0 ? null : (m[3] ? n * UNITS[m[3]] : n);
}
const calcTax = (amount, fee) => Math.ceil(amount / (1 - Math.min(Math.max(Number(fee) || 0, 0), 99) / 100));
const getTax = (b, g) => ({ enabled: false, channelId: '', feePercent: 5, ...(store.kv.get(b, 'tax', {})[g] || {}) });
const setTax = (b, g, cfg) => store.kv.set(b, 'tax', { ...store.kv.get(b, 'tax', {}), [g]: cfg });
const taxText = tax => `💰 **Your Tax Is : ${tax}**`;

async function taxMessage(m, botId) {
  const cfg = getTax(botId, m.guild.id);
  if (!cfg.enabled || !cfg.channelId || m.channelId !== cfg.channelId) return;
  const amount = parseAmount(m.content);
  if (amount === null) return;
  await m.reply(taxText(calcTax(amount, cfg.feePercent))).catch(() => {});
}

// ===== الرد التلقائي: أي رسالة (أو كلمة محددة) في روم يرد عليها البوت بكونتينر =====
function arContainer(r, m) {
  const f = t => String(t || '').replace(/\{user\}/g, `<@${m.author.id}>`).replace(/\{channel\}/g, `<#${m.channelId}>`).replace(/\{username\}/g, m.author.username);
  const c = new ContainerBuilder().setAccentColor(parseInt(String(r.color || '#5b6cf0').replace('#', ''), 16) || 0x5b6cf0);
  const gal = () => new MediaGalleryBuilder().addItems({ media: { url: r.imageUrl } });
  const text = [r.title && `## ${f(r.title)}`, r.description && f(r.description)].filter(Boolean).join('\n');
  if (!text && !r.imageUrl) return null;
  if (r.imageUrl && r.imagePosition !== 'bottom') c.addMediaGalleryComponents(gal());
  if (text) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  if (r.imageUrl && r.imagePosition === 'bottom') c.addMediaGalleryComponents(gal());
  return c;
}

async function autoReply(m, botId) {
  const rules = store.kv.get(botId, 'autoreplies', []).filter(r => r.guildId === m.guild.id && r.enabled !== false);
  const txt = (m.content || '').trim().toLowerCase();
  let n = 0;
  for (const r of rules) {
    if (n >= 3) break;
    if (r.watchChannelId && r.watchChannelId !== m.channelId) continue;
    if (r.match !== 'any') {
      const words = (r.keyword || '').toLowerCase().split(/[,،]/).map(w => w.trim()).filter(Boolean);
      if (!words.length) continue;
      if (!(r.match === 'exact' ? words.includes(txt) : words.some(w => txt.includes(w)))) continue;
    }
    const box = arContainer(r, m); if (!box) continue;
    n++;
    try {
      const ch = r.replyChannelId ? await m.guild.channels.fetch(r.replyChannelId) : m.channel;
      const payload = { components: [box], flags: MessageFlags.IsComponentsV2, allowedMentions: { users: [m.author.id], repliedUser: false } };
      if (r.replyToMessage && ch.id === m.channelId) await m.reply(payload); else await ch.send(payload);
      if (r.deleteTrigger) m.delete().catch(() => {});
    } catch (e) { console.error('autoreply:', e.message); }
  }
}

async function onMessage(m, botId) {
  if (m.author.bot || !m.guild) return;
  await taxMessage(m, botId).catch(() => {});
  await autoReply(m, botId);
  await prefix.handle(m, botId).catch(e => console.error('prefix:', e.message));
}

// ===== التوجيه: يرجّع true لو هو عالج التفاعل =====
async function handle(i) {
  const botId = i.client.botId;
  if (i.isChatInputCommand()) {
    if (i.commandName === 'create') { if (!isAdmin(i)) return deny(i), true; await B.openEmbedModal(i); return true; }
    if (i.commandName === 'say') {
      if (!isAdmin(i)) return deny(i), true;
      const ch = i.options.getChannel('channel') || i.channel;
      try {
        await ch.send(i.options.getString('message').replaceAll('\\n', '\n'));
        await i.reply({ content: `✅ تم إرسال الرسالة في <#${ch.id}>`, flags: EPH });
      } catch { await i.reply({ content: '❌ تعذر الإرسال (تأكد من صلاحيات البوت في الروم).', flags: EPH }); }
      return true;
    }
    if (i.commandName === 'tax') {
      const amount = parseAmount(i.options.getString('amount'));
      if (amount === null) { await i.reply({ content: '❌ اكتب مبلغ صحيح مثل `60m` أو `200k` أو `1500`', flags: EPH }); return true; }
      await i.reply(taxText(calcTax(amount, getTax(botId, i.guildId).feePercent)));
      return true;
    }
    if (i.commandName === 'tax-setup') {
      if (!isAdmin(i)) return deny(i), true;
      const cfg = getTax(botId, i.guildId);
      const ch = i.options.getChannel('channel'), pct = i.options.getNumber('percent'), en = i.options.getBoolean('enabled');
      if (ch) { cfg.channelId = ch.id; if (en === null) cfg.enabled = true; }
      if (pct !== null) cfg.feePercent = pct;
      if (en !== null) cfg.enabled = en;
      if (cfg.enabled && !cfg.channelId) { await i.reply({ content: '❌ حدد الروم أولاً: `/tax-setup channel:#الروم`', flags: EPH }); return true; }
      setTax(botId, i.guildId, cfg);
      await i.reply({ content: `✅ الضريبة: ${cfg.enabled ? 'مفعّلة' : 'متوقفة'} • الروم: ${cfg.channelId ? `<#${cfg.channelId}>` : '—'} • النسبة: ${cfg.feePercent}%`, flags: EPH });
      return true;
    }
    return false;
  }

  const id = i.customId || '';
  if (!id.startsWith('bld_') && !id.startsWith('sent_')) return false;
  if (id.startsWith('bld_') && !B.get(i)) { await i.reply({ content: '⌛ انتهت الجلسة، استخدم `/create` من جديد.', flags: EPH }).catch(() => {}); return true; }

  if (i.isButton()) {
    const map = {
      bld_choose_type: B.handleChooseType, bld_change_type: B.handleChooseType, bld_add_btn: B.handleAddButton,
      bld_add_opt: B.handleAddOption, bld_edit_embed: B.openEmbedModal, bld_pick_color: B.handlePickColor,
      bld_pick_imgpos: B.handlePickImgPos, bld_send: B.handleSend, bld_cancel: B.handleCancel,
      bld_toggle_btn_outside: B.handleToggleButtonsOutside, bld_toggle_sel_outside: B.handleToggleSelectOutside
    };
    if (map[id]) { await map[id](i); return true; }
    if (id.startsWith('bld_rm_btn_')) { await B.handleRemoveButton(i, id.replace('bld_rm_btn_', '')); return true; }
    if (id.startsWith('sent_btn_')) { await B.handleSentButton(i); return true; }
  }
  if (i.isStringSelectMenu()) {
    const map = { bld_set_type: B.handleSetType, bld_rm_opt: B.handleRemoveOption, bld_apply_color: B.handleApplyColor, bld_apply_imgpos: B.handleApplyImgPos };
    if (map[id]) { await map[id](i); return true; }
    if (id.startsWith('sent_sel_')) { await B.handleSentSelect(i); return true; }
  }
  if (i.isModalSubmit()) {
    const map = { bld_modal_embed: B.handleEmbedModal, bld_modal_btn: B.handleButtonModal, bld_modal_opt: B.handleOptionModal };
    if (map[id]) { await map[id](i); return true; }
  }
  return false;
}

module.exports = { handle, onMessage, register, registerAll, parseAmount, calcTax, getTax, taxText };
