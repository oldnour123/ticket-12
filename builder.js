// منشئ الرسائل بالكونتينر (Components V2) — أمر /create
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, MediaGalleryBuilder, MessageFlags, SeparatorSpacingSize
} = require('discord.js');
const store = require('./store');

const V2 = MessageFlags.IsComponentsV2, EPH = MessageFlags.Ephemeral;
const sessions = new Map();
const skey = i => `${i.client.user.id}:${i.user.id}`;
const get = i => sessions.get(skey(i));

const COLORS = [
  { label: 'Blurple', value: '5865F2', emoji: '🔵' }, { label: 'Red', value: 'ED4245', emoji: '🔴' },
  { label: 'Green', value: '57F287', emoji: '🟢' }, { label: 'Yellow', value: 'FEE75C', emoji: '🟡' },
  { label: 'Orange', value: 'FF7F00', emoji: '🟠' }, { label: 'Purple', value: '9B59B6', emoji: '🟣' },
  { label: 'Dark', value: '2B2D31', emoji: '⚫' }, { label: 'Cyan', value: '00BFFF', emoji: '🩵' },
  { label: 'Pink', value: 'FF69B4', emoji: '🩷' }
];
const IMG_POSITIONS = [
  { label: 'تحت (Bottom)', value: 'bottom', emoji: '⬇️' },
  { label: 'فوق (Top)', value: 'top', emoji: '⬆️' },
  { label: 'فوق وتحت (Both)', value: 'both', emoji: '↕️' }
];
const parseColor = hex => { const n = parseInt(String(hex).replace('#', ''), 16); return isNaN(n) ? 0x5865f2 : n; };
const sep = (d = false) => new SeparatorBuilder().setDivider(d).setSpacing(SeparatorSpacingSize.Small);
// يقبل ايموجي عادي أو <:name:id> وغير كذا يتجاهله (عشان ما يفشل الإرسال)
const cleanEmoji = t => { t = (t || '').trim(); return /^<a?:\w+:\d+>$/.test(t) || /\p{Extended_Pictographic}/u.test(t) ? t : null; };
const ack = i => (i.isFromMessage() ? i.deferUpdate() : i.deferReply({ flags: EPH }));

// ===== ردود الأزرار والقوائم (محفوظة لكل بوت) =====
const respGet = b => store.kv.get(b, 'responses', {});
const respSave = (b, entries) => store.kv.set(b, 'responses', { ...respGet(b), ...entries });

function buildContainer(s) {
  const c = new ContainerBuilder().setAccentColor(s.color);
  const pos = s.imagePosition || 'bottom';
  const top = s.image && (pos === 'top' || pos === 'both');
  const bottom = s.image && (pos === 'bottom' || pos === 'both');
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${s.title}`));
  if (top) { c.addSeparatorComponents(sep()); c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems({ media: { url: s.image } })); }
  if (s.description) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(s.description));
  if (bottom) { c.addSeparatorComponents(sep()); c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems({ media: { url: s.image } })); }
  if (s.footer) { c.addSeparatorComponents(sep()); c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${s.footer}`)); }
  return c;
}

function buttonsRow(s, b) {
  if (!s.buttons?.length) return null;
  const row = new ActionRowBuilder(), saved = {};
  for (const btn of s.buttons) {
    const x = new ButtonBuilder().setLabel(btn.label);
    if (btn.url) x.setStyle(ButtonStyle.Link).setURL(btn.url); // زر رابط: ما إله customId ولا رد
    else { x.setCustomId(`sent_btn_${btn.id}`).setStyle(btn.style); saved[`sent_btn_${btn.id}`] = btn.response; }
    if (btn.emoji) x.setEmoji(btn.emoji);
    row.addComponents(x);
  }
  respSave(b, saved);
  return row;
}

function selectRow(s, b) {
  if (!s.selectOptions?.length) return null;
  if (!s.selectMenuId) s.selectMenuId = `sent_sel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const menu = new StringSelectMenuBuilder().setCustomId(s.selectMenuId).setPlaceholder('Select an option...')
    .addOptions(s.selectOptions.map(o => {
      const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.id);
      if (o.description) opt.setDescription(o.description);
      if (o.emoji) opt.setEmoji(o.emoji);
      return opt;
    }));
  const saved = {};
  for (const o of s.selectOptions) saved[`${s.selectMenuId}::${o.id}`] = o.response;
  respSave(b, saved);
  return new ActionRowBuilder().addComponents(menu);
}

function buildSentContainer(s, b) {
  const c = buildContainer(s);
  const br = buttonsRow(s, b);
  if (br && !s.buttonsOutside) { c.addSeparatorComponents(sep(true)); c.addActionRowComponents(br); }
  const sr = selectRow(s, b);
  if (sr && !s.selectOutside) { c.addSeparatorComponents(sep(true)); c.addActionRowComponents(sr); }
  return c;
}

function outsideRows(s, b) {
  const rows = [];
  if (s.buttonsOutside) { const r = buttonsRow(s, b); if (r) rows.push(r); }
  if (s.selectOutside) { const r = selectRow(s, b); if (r) rows.push(r); }
  return rows;
}

// ===== المعاينة =====
async function showPreview(i, s) {
  const c = buildContainer(s);
  const type = s.componentType;
  const row1 = new ActionRowBuilder();
  if (!type) {
    row1.addComponents(new ButtonBuilder().setCustomId('bld_choose_type').setLabel('🔧 Choose Components').setStyle(ButtonStyle.Primary));
  } else {
    if (type === 'buttons' || type === 'both')
      row1.addComponents(new ButtonBuilder().setCustomId('bld_add_btn').setLabel('➕ Add Button').setStyle(ButtonStyle.Primary).setDisabled(s.buttons.length >= 5));
    if (type === 'select' || type === 'both')
      row1.addComponents(new ButtonBuilder().setCustomId('bld_add_opt').setLabel('➕ Add Option').setStyle(ButtonStyle.Primary).setDisabled(s.selectOptions.length >= 25));
    row1.addComponents(new ButtonBuilder().setCustomId('bld_change_type').setLabel('🔄 Change').setStyle(ButtonStyle.Secondary));
  }
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bld_edit_embed').setLabel('✏️ Edit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bld_pick_color').setLabel('🎨 Color').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bld_pick_imgpos').setLabel('📍 Image Pos').setStyle(ButtonStyle.Secondary).setDisabled(!s.image),
    new ButtonBuilder().setCustomId('bld_send').setLabel(s.editId ? '💾 Save changes' : '✅ Send').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bld_cancel').setLabel('🗑️').setStyle(ButtonStyle.Danger)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bld_toggle_btn_outside')
      .setLabel(s.buttonsOutside ? '🔘 Buttons: separate message' : '🔘 Buttons: attached to embed')
      .setStyle(s.buttonsOutside ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!s.buttons?.length),
    new ButtonBuilder().setCustomId('bld_toggle_sel_outside')
      .setLabel(s.selectOutside ? '📋 Select: separate message' : '📋 Select: attached to embed')
      .setStyle(s.selectOutside ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!s.selectOptions?.length)
  );
  c.addSeparatorComponents(sep(true));
  c.addActionRowComponents(row1); c.addActionRowComponents(row2); c.addActionRowComponents(row3);

  if (s.buttons.length > 0) {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# 👆 Click a button to remove it'));
    const row = new ActionRowBuilder();
    for (const btn of s.buttons) {
      const x = new ButtonBuilder().setCustomId(`bld_rm_btn_${btn.id}`).setLabel(btn.url ? `🔗 ${btn.label}`.slice(0, 80) : btn.label)
        .setStyle(btn.url ? ButtonStyle.Secondary : btn.style);
      if (btn.emoji) x.setEmoji(btn.emoji);
      row.addComponents(x);
    }
    c.addActionRowComponents(row);
  }
  if (s.selectOptions.length > 0) {
    const menu = new StringSelectMenuBuilder().setCustomId('bld_rm_opt').setPlaceholder('👆 Pick an option to remove it')
      .addOptions(s.selectOptions.map(o => {
        const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.id)
          .setDescription(o.description?.slice(0, 100) ?? 'Click to remove this option');
        if (o.emoji) opt.setEmoji(o.emoji);
        return opt;
      }));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  }
  const hint = !type
    ? '-# Press **🔧 Choose Components** to add buttons or a select menu.'
    : `-# Preview${s.buttons.length ? ` • ${s.buttons.length} button(s)` : ''}${s.selectOptions.length ? ` • ${s.selectOptions.length} option(s)` : ''} — press **${s.editId ? '💾 Save changes' : '✅ Send'}** to ${s.editId ? 'update the sent message' : 'post'}.`;
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(hint));

  const payload = { components: [c], flags: V2 };
  try {
    if (i.isModalSubmit() || i.deferred) await i.editReply(payload);
    else await i.update(payload);
  } catch { await i.reply({ ...payload, flags: V2 | EPH }).catch(() => {}); }
}

// ===== المودالات =====
async function openEmbedModal(i) {
  const s = get(i);
  const input = (id, label, style, req, max, ph, val) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(req).setMaxLength(max).setPlaceholder(ph).setValue(val ?? ''));
  await i.showModal(new ModalBuilder().setCustomId('bld_modal_embed').setTitle('📋 Create Embed').addComponents(
    input('f_title', 'Title *', TextInputStyle.Short, true, 256, 'e.g. Welcome!', s?.title),
    input('f_desc', 'Description (optional)', TextInputStyle.Paragraph, false, 4000, 'Embed body text...', s?.description),
    input('f_footer', 'Footer text (optional)', TextInputStyle.Short, false, 2048, 'Small text at the bottom', s?.footer),
    input('f_image', 'Image URL (optional)', TextInputStyle.Short, false, 500, 'https://...', s?.image)
  ));
}

async function handleEmbedModal(i) {
  const old = get(i);
  const image = i.fields.getTextInputValue('f_image').trim();
  sessions.set(skey(i), {
    title: i.fields.getTextInputValue('f_title'),
    description: i.fields.getTextInputValue('f_desc') || null,
    color: old?.color ?? 0x5865f2,
    image: /^https?:\/\//.test(image) ? image : null,
    imagePosition: old?.imagePosition ?? 'bottom',
    footer: i.fields.getTextInputValue('f_footer') || null,
    componentType: old?.componentType ?? null,
    buttons: old?.buttons ?? [], selectOptions: old?.selectOptions ?? [],
    buttonsOutside: old?.buttonsOutside, selectOutside: old?.selectOutside, selectMenuId: old?.selectMenuId,
    editId: old?.editId
  });
  await ack(i);
  await showPreview(i, get(i));
}

async function screen(i, title, menu, color) {
  const c = new ContainerBuilder().setAccentColor(color);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  await i.update({ components: [c], flags: V2 });
}

const handlePickColor = i => { const s = get(i); const cur = s.color.toString(16).toUpperCase().padStart(6, '0');
  return screen(i, '## 🎨 اختر لون الإمبد', new StringSelectMenuBuilder().setCustomId('bld_apply_color').setPlaceholder('اختر لون...')
    .addOptions(COLORS.map(c => new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.value).setEmoji(c.emoji).setDefault(c.value === cur))), s.color); };
const handleApplyColor = i => { const s = get(i); s.color = parseColor(i.values[0]); return showPreview(i, s); };

const handlePickImgPos = i => { const s = get(i);
  return screen(i, '## 📍 موضع الصورة', new StringSelectMenuBuilder().setCustomId('bld_apply_imgpos').setPlaceholder('اختر موضع...')
    .addOptions(IMG_POSITIONS.map(p => new StringSelectMenuOptionBuilder().setLabel(p.label).setValue(p.value).setEmoji(p.emoji).setDefault(p.value === (s.imagePosition ?? 'bottom')))), s.color); };
const handleApplyImgPos = i => { const s = get(i); s.imagePosition = i.values[0]; return showPreview(i, s); };

async function handleChooseType(i) {
  const c = new ContainerBuilder().setAccentColor(0x5865f2);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent('## ⚙️ Choose Component Type'));
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent('What do you want to add below the embed?'));
  c.addSeparatorComponents(sep(true));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('bld_set_type').setPlaceholder('Select type...').addOptions(
    new StringSelectMenuOptionBuilder().setLabel('Buttons only').setDescription('Add custom clickable buttons').setValue('buttons').setEmoji('🔘'),
    new StringSelectMenuOptionBuilder().setLabel('Select menu only').setDescription('Add a dropdown with options').setValue('select').setEmoji('📋'),
    new StringSelectMenuOptionBuilder().setLabel('Buttons + Select menu').setDescription('Add both').setValue('both').setEmoji('⚙️'),
    new StringSelectMenuOptionBuilder().setLabel('No components').setDescription('Just send the embed as-is').setValue('none').setEmoji('🚫'))));
  await i.update({ components: [c], flags: V2 });
}

async function handleSetType(i) {
  const s = get(i), t = i.values[0];
  s.componentType = t === 'none' ? null : t;
  if (t === 'buttons' || t === 'none') s.selectOptions = [];
  if (t === 'select' || t === 'none') s.buttons = [];
  await showPreview(i, s);
}

const field = (id, label, style, req, max, ph) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(req).setMaxLength(max).setPlaceholder(ph));

// مودال الزر: رابط (لو انكتب URL) أو زر عادي برد مخفي. نفس المودال بالـ builder وبالداشبورد
const BTN_STYLES = {
  blue: ButtonStyle.Primary, primary: ButtonStyle.Primary, أزرق: ButtonStyle.Primary,
  gray: ButtonStyle.Secondary, grey: ButtonStyle.Secondary, secondary: ButtonStyle.Secondary, رمادي: ButtonStyle.Secondary,
  green: ButtonStyle.Success, success: ButtonStyle.Success, أخضر: ButtonStyle.Success,
  red: ButtonStyle.Danger, danger: ButtonStyle.Danger, أحمر: ButtonStyle.Danger
};
const btnModal = customId => new ModalBuilder().setCustomId(customId).setTitle('➕ Add Button').addComponents(
  field('b_label', 'Button label *', TextInputStyle.Short, true, 80, 'e.g. Contact us'),
  field('b_url', 'Link URL (empty = normal button)', TextInputStyle.Short, false, 500, 'https://...  (للزر الرابط فقط)'),
  field('b_response', 'Reply when clicked (normal button)', TextInputStyle.Paragraph, false, 2000, 'Text shown only to the person who clicks'),
  field('b_emoji', 'Emoji (optional)', TextInputStyle.Short, false, 100, 'e.g. 🔥  or  <:name:123456789>'),
  field('b_style', 'Color (normal button)', TextInputStyle.Short, false, 10, 'blue / gray / green / red'));
function parseButton(get) {
  const url = get('b_url').trim(), style = BTN_STYLES[get('b_style').trim().toLowerCase()] ?? ButtonStyle.Primary;
  if (url && !/^https?:\/\/\S+\.\S+$/i.test(url)) return { error: '❌ الرابط لازم يبدأ بـ `http://` أو `https://`.' };
  return { btn: {
    id: `cb_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, label: get('b_label').trim(), emoji: cleanEmoji(get('b_emoji')),
    url: url || null, response: get('b_response').trim(), style: url ? ButtonStyle.Link : style
  } };
}

async function handleAddButton(i) {
  if (get(i).buttons.length >= 5) return;
  await i.showModal(btnModal('bld_modal_btn'));
}
async function handleButtonModal(i) {
  const s = get(i), r = parseButton(k => i.fields.getTextInputValue(k));
  if (r.error) return i.reply({ content: r.error, flags: EPH });
  s.buttons.push(r.btn);
  await ack(i); await showPreview(i, s);
}

async function handleAddOption(i) {
  if (get(i).selectOptions.length >= 25) return;
  await i.showModal(new ModalBuilder().setCustomId('bld_modal_opt').setTitle('➕ Add Menu Option').addComponents(
    field('o_label', 'Option label *', TextInputStyle.Short, true, 100, 'e.g. Gold Plan'),
    field('o_desc', 'Option description (optional)', TextInputStyle.Short, false, 100, 'e.g. Best plan for professionals'),
    field('o_emoji', 'Emoji (optional)', TextInputStyle.Short, false, 100, 'e.g. ⭐  or  <:name:123456789>'),
    field('o_response', 'Reply when selected * (hidden to others)', TextInputStyle.Paragraph, true, 2000, 'Text shown only to the person who selects')));
}
async function handleOptionModal(i) {
  const s = get(i);
  s.selectOptions.push({
    id: `co_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    label: i.fields.getTextInputValue('o_label'), description: i.fields.getTextInputValue('o_desc').trim() || null,
    emoji: cleanEmoji(i.fields.getTextInputValue('o_emoji')), response: i.fields.getTextInputValue('o_response').trim()
  });
  await ack(i); await showPreview(i, s);
}

const handleRemoveOption = i => { const s = get(i); s.selectOptions = s.selectOptions.filter(o => o.id !== i.values[0]); return showPreview(i, s); };
const handleRemoveButton = (i, id) => { const s = get(i); s.buttons = s.buttons.filter(b => b.id !== id); return showPreview(i, s); };
const handleToggleButtonsOutside = i => { const s = get(i); s.buttonsOutside = !s.buttonsOutside; return showPreview(i, s); };
const handleToggleSelectOutside = i => { const s = get(i); s.selectOutside = !s.selectOutside; return showPreview(i, s); };

// ===== الداشبورد: كل إمبد انرسل بيتخزّن وبيطلع له كارد تحكم في روم الداشبورد =====
const embedsGet = b => store.kv.get(b, 'embeds', []);
const embedsPut = (b, rec) => {
  const l = embedsGet(b), k = l.findIndex(x => x.id === rec.id);
  if (k >= 0) l[k] = rec; else l.push(rec);
  store.kv.set(b, 'embeds', l);
};
const dashChannelOf = (b, g) => store.kv.get(b, 'embedcfg', {})[g]?.channelId;
const snap = s => structuredClone({
  title: s.title, description: s.description, color: s.color, image: s.image, imagePosition: s.imagePosition, footer: s.footer,
  componentType: s.componentType, buttons: s.buttons || [], selectOptions: s.selectOptions || [],
  buttonsOutside: !!s.buttonsOutside, selectOutside: !!s.selectOutside, selectMenuId: s.selectMenuId || null
});
const msgUrl = rec => `https://discord.com/channels/${rec.guildId}/${rec.channelId}/${rec.messageId}`;
const noPing = { parse: [] };
const card = (color, ...lines) => {
  const c = new ContainerBuilder().setAccentColor(color);
  for (const t of lines) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(t));
  return c;
};

function dashCard(rec) {
  const s = rec.state;
  const c = new ContainerBuilder().setAccentColor(s.color);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎛️ ${s.title}`));
  if (s.description) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(s.description.length > 160 ? s.description.slice(0, 160) + '…' : s.description));
  c.addSeparatorComponents(sep(true));
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `📍 <#${rec.channelId}> • 🔘 ${s.buttons.length} • 📋 ${s.selectOptions.length}\n-# <@${rec.createdBy}> • <t:${Math.floor(rec.createdAt / 1000)}:R>`));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('🔗 فتح').setStyle(ButtonStyle.Link).setURL(msgUrl(rec)),
    new ButtonBuilder().setCustomId(`dash_edit_${rec.id}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`dash_addbtn_${rec.id}`).setLabel('➕ زر').setStyle(ButtonStyle.Success).setDisabled(s.buttons.length >= 5),
    new ButtonBuilder().setCustomId(`dash_resend_${rec.id}`).setLabel('🔁 إعادة إرسال').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dash_del_${rec.id}`).setLabel('🗑️').setStyle(ButtonStyle.Danger)));
  return c;
}

async function postDashboard(client, rec) {
  const chId = dashChannelOf(client.botId, rec.guildId);
  if (!chId) return false;
  try {
    const ch = await client.channels.fetch(chId);
    const m = await ch.send({ components: [dashCard(rec)], flags: V2, allowedMentions: noPing });
    rec.dashChannelId = ch.id; rec.dashMessageId = m.id;
    return true;
  } catch (e) { console.error('dashboard:', e.message); return false; }
}
async function refreshDashboard(client, rec) {
  try {
    const ch = await client.channels.fetch(rec.dashChannelId);
    const m = await ch.messages.fetch(rec.dashMessageId);
    await m.edit({ components: [dashCard(rec)], flags: V2, allowedMentions: noPing });
    return true;
  } catch { return postDashboard(client, rec); } // الكارد انحذف أو ما كان موجود: ننشره من جديد
}

// يبعث الإمبد (والصفوف الخارجية) للروم ويسجّل أرقام الرسائل في rec
async function publish(client, ch, rec) {
  const s = rec.state, b = client.botId;
  const main = await ch.send({ components: [buildSentContainer(s, b)], flags: V2 });
  const rows = outsideRows(s, b);
  const out = rows.length ? await ch.send({ components: rows }) : null;
  rec.channelId = ch.id; rec.messageId = main.id; rec.outsideId = out?.id || null;
  rec.state.selectMenuId = s.selectMenuId || null;
}

// يطبّق rec.state على الرسالة المنشورة (والصفوف الخارجية)
async function applyToMessage(client, rec) {
  const b = client.botId, s = rec.state;
  const ch = await client.channels.fetch(rec.channelId);
  const msg = await ch.messages.fetch(rec.messageId);
  await msg.edit({ components: [buildSentContainer(s, b)], flags: V2 });
  const rows = outsideRows(s, b);
  const om = rec.outsideId ? await ch.messages.fetch(rec.outsideId).catch(() => null) : null;
  if (om && rows.length) await om.edit({ components: rows });
  else if (om) { await om.delete().catch(() => {}); rec.outsideId = null; }
  else rec.outsideId = rows.length ? (await ch.send({ components: rows })).id : null;
}

async function handleSend(i) {
  const s = get(i);
  if (s.editId) return saveEdit(i);
  const b = i.client.botId;
  const rec = { id: `e${Date.now().toString(36)}`, guildId: i.guildId, createdBy: i.user.id, createdAt: Date.now(), state: snap(s) };
  await publish(i.client, i.channel, rec);
  const posted = await postDashboard(i.client, rec);
  embedsPut(b, rec);
  sessions.delete(skey(i));
  await i.update({ components: [card(0x57f287, '## ✅ Embed sent!',
    posted ? `🎛️ لوحة التحكم: <#${rec.dashChannelId}>`
      : '-# ما في روم داشبورد محدد (أو البوت ما يقدر يرسل فيه). استخدم `/dashboard` عشان تتحكم بالإمبدات من روم خاص.',
    '-# Use `/create` again to create a new one.')], flags: V2 });
}

async function saveEdit(i) {
  const s = get(i), b = i.client.botId;
  const rec = embedsGet(b).find(r => r.id === s.editId);
  if (!rec) { sessions.delete(skey(i)); return i.update({ components: [card(0xed4245, '## ❌ ما لقيت الإمبد', '-# يمكن انحذف من الداشبورد.')], flags: V2 }); }
  try {
    rec.state = snap(s);
    await applyToMessage(i.client, rec);
  } catch (e) {
    console.error('saveEdit:', e.message);
    return i.update({ components: [card(0xed4245, '## ❌ تعذر تعديل الرسالة',
      '-# تأكد إن الرسالة الأصلية ما انحذفت وإن البوت عنده صلاحية في رومها. إذا انحذفت استخدم **🔁 إعادة إرسال** من الداشبورد.')], flags: V2 });
  }
  embedsPut(b, rec);
  await refreshDashboard(i.client, rec); embedsPut(b, rec);
  sessions.delete(skey(i));
  await i.update({ components: [card(0x57f287, '## ✅ تم حفظ التعديلات', `-# تم تحديث الرسالة في <#${rec.channelId}>.`)], flags: V2 });
}

// أزرار كارد الداشبورد: dash_edit_ / dash_resend_ / dash_del_ / dash_delok_
async function handleDash(i) {
  const m = /^dash_(edit|addbtn|btnmodal|resend|del|delok)_(.+)$/.exec(i.customId);
  if (!m) return;
  const [, act, id] = m, b = i.client.botId;
  const rec = embedsGet(b).find(r => r.id === id && r.guildId === i.guildId);
  if (!rec) return i.reply({ content: '❌ ما لقيت بيانات هالإمبد (يمكن انحذف).', flags: EPH });

  if (act === 'edit') {
    sessions.set(skey(i), { ...structuredClone(rec.state), editId: rec.id });
    await i.deferReply({ flags: EPH });
    return showPreview(i, get(i));
  }
  if (act === 'addbtn') {
    if (rec.state.buttons.length >= 5) return i.reply({ content: '❌ وصلت الحد الأقصى (5 أزرار). احذف زر من ✏️ تعديل.', flags: EPH });
    return i.showModal(btnModal(`dash_btnmodal_${rec.id}`));
  }
  if (act === 'btnmodal') { // إضافة زر (رابط أو عادي) مباشرة من الداشبورد وتطبيقه على الرسالة
    const r = parseButton(k => i.fields.getTextInputValue(k));
    if (r.error) return i.reply({ content: r.error, flags: EPH });
    if (rec.state.buttons.length >= 5) return i.reply({ content: '❌ وصلت الحد الأقصى (5 أزرار).', flags: EPH });
    await i.deferReply({ flags: EPH });
    rec.state.buttons.push(r.btn);
    const prevType = rec.state.componentType;
    rec.state.componentType = prevType === 'select' || prevType === 'both' ? 'both' : 'buttons';
    try { await applyToMessage(i.client, rec); }
    catch (e) {
      rec.state.buttons.pop(); rec.state.componentType = prevType;
      return i.editReply({ components: [card(0xed4245, '## ❌ تعذر إضافة الزر', '-# تأكد إن الرسالة الأصلية موجودة وإن البوت عنده صلاحية في رومها.')], flags: V2 });
    }
    embedsPut(b, rec); await refreshDashboard(i.client, rec); embedsPut(b, rec);
    return i.editReply({ components: [card(0x57f287, r.btn.url ? '## ✅ انضاف زر الرابط' : '## ✅ انضاف الزر', `-# ${rec.state.buttons.length}/5 أزرار`)], flags: V2 });
  }
  if (act === 'resend') {
    await i.deferReply({ flags: EPH });
    try {
      const ch = await i.client.channels.fetch(rec.channelId);
      for (const mid of [rec.messageId, rec.outsideId]) if (mid) await ch.messages.delete(mid).catch(() => {});
      await publish(i.client, ch, rec);
    } catch (e) { return i.editReply({ components: [card(0xed4245, '## ❌ تعذر إعادة الإرسال', `-# ${e.message}`)], flags: V2 }); }
    embedsPut(b, rec); await refreshDashboard(i.client, rec); embedsPut(b, rec);
    return i.editReply({ components: [card(0x57f287, '## ✅ تمت إعادة الإرسال')], flags: V2 });
  }
  if (act === 'del') {
    const c = card(0xed4245, '## 🗑️ تأكيد الحذف', `بتحذف الإمبد **${rec.state.title}** من الروم ومن الداشبورد؟`);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dash_delok_${rec.id}`).setLabel('نعم، احذف').setStyle(ButtonStyle.Danger)));
    return i.reply({ components: [c], flags: V2 | EPH });
  }
  // delok
  try {
    const ch = await i.client.channels.fetch(rec.channelId).catch(() => null);
    for (const mid of [rec.messageId, rec.outsideId]) if (mid && ch) await ch.messages.delete(mid).catch(() => {});
    const dch = rec.dashChannelId ? await i.client.channels.fetch(rec.dashChannelId).catch(() => null) : null;
    if (dch && rec.dashMessageId) await dch.messages.delete(rec.dashMessageId).catch(() => {});
  } finally { store.kv.set(b, 'embeds', embedsGet(b).filter(r => r.id !== rec.id)); }
  return i.update({ components: [card(0x57f287, '## ✅ انحذف الإمبد')], flags: V2 });
}

// /dashboard: تحديد الروم + إعادة نشر كروت كل الإمبدات المسجّلة فيه
async function setDashboard(i) {
  const ch = i.options.getChannel('channel'), b = i.client.botId;
  if (!ch.permissionsFor(i.guild.members.me)?.has(['ViewChannel', 'SendMessages']))
    return i.reply({ content: `❌ البوت ما عنده صلاحية يرسل في <#${ch.id}>.`, flags: EPH });
  await i.deferReply({ flags: EPH });
  store.kv.set(b, 'embedcfg', { ...store.kv.get(b, 'embedcfg', {}), [i.guildId]: { channelId: ch.id } });
  const list = embedsGet(b);
  let n = 0;
  for (const rec of list.filter(r => r.guildId === i.guildId)) {
    if (rec.dashChannelId && rec.dashMessageId) {
      const old = await i.client.channels.fetch(rec.dashChannelId).catch(() => null);
      if (old) await old.messages.delete(rec.dashMessageId).catch(() => {});
    }
    if (await postDashboard(i.client, rec)) n++;
  }
  store.kv.set(b, 'embeds', list);
  await i.editReply({ content: `✅ روم الداشبورد: <#${ch.id}>${n ? ` • اننشر ${n} كارد للإمبدات السابقة` : ''}\nأي إمبد بترسله بـ \`/create\` بيطلع له كارد تحكم هناك.` });
}

// /create جديد ما لازم يورث جلسة تعديل قديمة
const startNew = i => { if (get(i)?.editId) sessions.delete(skey(i)); };

async function handleCancel(i) {
  const editing = !!get(i)?.editId;
  sessions.delete(skey(i));
  const c = new ContainerBuilder().setAccentColor(0xed4245);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(editing ? '## ❌ Edit cancelled.' : '## 🗑️ Embed cancelled.'));
  await i.update({ components: [c], flags: V2 });
}

// ===== الضغط على الأزرار/القائمة في الرسالة المنشورة =====
async function sendEph(i, text) {
  const c = new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  await i.reply({ components: [c], flags: V2 | EPH });
}
const handleSentButton = i => sendEph(i, respGet(i.client.botId)[i.customId] || '✅ Request received!');
async function handleSentSelect(i) {
  await sendEph(i, respGet(i.client.botId)[`${i.customId}::${i.values[0]}`] || '✅ Selection received!');
  try { await i.message.edit({ components: i.message.components }); } catch {} // يرجّع القائمة فاضية بعد الاختيار
}

module.exports = {
  get, openEmbedModal, handleEmbedModal, handlePickColor, handleApplyColor, handlePickImgPos, handleApplyImgPos,
  handleChooseType, handleSetType, handleAddButton, handleButtonModal, handleAddOption, handleOptionModal,
  handleRemoveOption, handleRemoveButton, handleToggleButtonsOutside, handleToggleSelectOutside,
  handleSend, handleCancel, handleSentButton, handleSentSelect, handleDash, setDashboard, startNew, dashCard
};
