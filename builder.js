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
    const x = new ButtonBuilder().setCustomId(`sent_btn_${btn.id}`).setLabel(btn.label).setStyle(btn.style);
    if (btn.emoji) x.setEmoji(btn.emoji);
    row.addComponents(x); saved[`sent_btn_${btn.id}`] = btn.response;
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
    new ButtonBuilder().setCustomId('bld_send').setLabel('✅ Send').setStyle(ButtonStyle.Success),
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
      const x = new ButtonBuilder().setCustomId(`bld_rm_btn_${btn.id}`).setLabel(btn.label).setStyle(btn.style);
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
    : `-# Preview${s.buttons.length ? ` • ${s.buttons.length} button(s)` : ''}${s.selectOptions.length ? ` • ${s.selectOptions.length} option(s)` : ''} — press **✅ Send** to post.`;
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
    buttonsOutside: old?.buttonsOutside, selectOutside: old?.selectOutside, selectMenuId: old?.selectMenuId
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

async function handleAddButton(i) {
  if (get(i).buttons.length >= 5) return;
  await i.showModal(new ModalBuilder().setCustomId('bld_modal_btn').setTitle('➕ Add Button').addComponents(
    field('b_label', 'Button Label *', TextInputStyle.Short, true, 80, 'e.g. Contact us'),
    field('b_emoji', 'Emoji (optional)', TextInputStyle.Short, false, 100, 'e.g. 🔥  or  <:name:123456789>'),
    field('b_response', 'Reply when clicked * (hidden to others)', TextInputStyle.Paragraph, true, 2000, 'Text shown only to the person who clicks')));
}
async function handleButtonModal(i) {
  const s = get(i);
  s.buttons.push({
    id: `cb_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    label: i.fields.getTextInputValue('b_label'), emoji: cleanEmoji(i.fields.getTextInputValue('b_emoji')),
    response: i.fields.getTextInputValue('b_response').trim(), style: ButtonStyle.Primary
  });
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

async function handleSend(i) {
  const s = get(i), b = i.client.botId;
  await i.channel.send({ components: [buildSentContainer(s, b)], flags: V2 });
  const rows = outsideRows(s, b);
  if (rows.length) await i.channel.send({ components: rows });
  sessions.delete(skey(i));
  const done = new ContainerBuilder().setAccentColor(0x57f287);
  done.addTextDisplayComponents(new TextDisplayBuilder().setContent('## ✅ Embed sent!'));
  done.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Use `/create` again to create a new one.'));
  await i.update({ components: [done], flags: V2 });
}

async function handleCancel(i) {
  sessions.delete(skey(i));
  const c = new ContainerBuilder().setAccentColor(0xed4245);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🗑️ Embed cancelled.'));
  await i.update({ components: [c], flags: V2 });
}

// ===== الضغط على الأزرار/القائمة في الرسالة المنشورة =====
async function sendEph(i, text) {
  const c = new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  await i.reply({ components: [c], flags: V2 | EPH });
}
const handleSentButton = i => sendEph(i, respGet(i.client.botId)[i.customId] ?? '✅ Request received!');
async function handleSentSelect(i) {
  await sendEph(i, respGet(i.client.botId)[`${i.customId}::${i.values[0]}`] ?? '✅ Selection received!');
  try { await i.message.edit({ components: i.message.components }); } catch {} // يرجّع القائمة فاضية بعد الاختيار
}

module.exports = {
  get, openEmbedModal, handleEmbedModal, handlePickColor, handleApplyColor, handlePickImgPos, handleApplyImgPos,
  handleChooseType, handleSetType, handleAddButton, handleButtonModal, handleAddOption, handleOptionModal,
  handleRemoveOption, handleRemoveButton, handleToggleButtonsOutside, handleToggleSelectOutside,
  handleSend, handleCancel, handleSentButton, handleSentSelect
};
