const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder,
  MediaGalleryItemBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const store = require('./store');

const parseEmoji = s => {
  const m = /^<(a?):(\w+):(\d+)>$/.exec((s || '').trim());
  return m ? { id: m[3], name: m[2], animated: !!m[1] } : ((s || '').trim() || undefined);
};
const color = c => parseInt(String(c || '#2b3a67').replace('#', ''), 16) || 0x2b3a67;

function buildPanel(p) {
  const opts = p.types.map(t => ({
    label: t.label.slice(0, 100), description: (t.description || '').slice(0, 100) || undefined,
    value: t.id, emoji: parseEmoji(t.emoji)
  }));
  if (p.showReset !== false)
    opts.push({ label: 'Reset Menu', description: 'إعادة ضبط القائمة', value: 'reset', emoji: '🔄' });

  const select = new StringSelectMenuBuilder().setCustomId(`tsel:${p.id}`)
    .setPlaceholder(p.placeholder || 'اختر نوع التذكرة').addOptions(opts);

  const c = new ContainerBuilder().setAccentColor(color(p.color));
  const gallery = () => new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(p.bannerUrl));
  const hasImg = !!p.bannerUrl;

  if (hasImg && p.imagePosition !== 'bottom') c.addMediaGalleryComponents(gallery());
  if (p.title) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(p.title));
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  if (p.description) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(p.description));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  if (hasImg && p.imagePosition === 'bottom') c.addMediaGalleryComponents(gallery());
  return c;
}

const DEFAULT_WELCOME = 'تم فتح تذكرتك بنجاح 🎫\nاكتب طلبك وسيرد عليك الفريق قريباً.';
const fill = (t, v) => String(t)
  .replace(/\{user\}/g, `<@${v.ownerId}>`)
  .replace(/\{role\}/g, v.role ? `<@&${v.role}>` : 'الفريق')
  .replace(/\{type\}/g, v.type);

// الرسالة الأولى: ترحيب + منشن + أزرار الاستلام والإغلاق
function buildTicket(p, type, ownerId, claimedBy) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('t_claim').setLabel(claimedBy ? 'تم الاستلام' : 'استلام التذكرة')
      .setEmoji('🙋').setStyle(ButtonStyle.Success).setDisabled(!!claimedBy),
    new ButtonBuilder().setCustomId('t_close').setLabel('إغلاق التذكرة').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  const role = type.roleId || p.supportRoleId;
  const head = `<@${ownerId}>` + (role ? ` <@&${role}>` : '');
  const text = fill(p.ticketWelcome || DEFAULT_WELCOME, { ownerId, role, type: type.label });
  return new ContainerBuilder().setAccentColor(color(p.color))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## 🎫 ${type.label}\n${text}` + (claimedBy ? `\n\n✅ المستلم: <@${claimedBy}>` : '')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(row);
}

// الرسالة الثانية: الكلام اللي حددته لهذا النوع (تنرسل بعد الترحيب)
function buildTypeMessage(p, type, ownerId) {
  if (!type.welcome) return null;
  const role = type.roleId || p.supportRoleId;
  return new ContainerBuilder().setAccentColor(color(p.color))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(fill(type.welcome, { ownerId, role, type: type.label })));
}

// يرسل اللوحة أو يحدّث الرسالة الموجودة
async function sendPanel(client, botId, p) {
  if (!p.channelId) throw new Error('اختر روم الإرسال أولاً');
  if (!p.types.length) throw new Error('أضف نوع تذكرة واحد على الأقل');
  const ch = await client.channels.fetch(p.channelId);
  if (ch.guildId !== p.guildId) throw new Error('الروم ليس في هذا السيرفر');
  const payload = { components: [buildPanel(p)], flags: MessageFlags.IsComponentsV2 };
  if (p.messageId) {
    try { const m = await ch.messages.fetch(p.messageId); await m.edit(payload); return; } catch {}
  }
  const m = await ch.send(payload);
  p.messageId = m.id;
  store.upsert(botId, p);
}

module.exports = { buildPanel, buildTicket, buildTypeMessage, sendPanel };
