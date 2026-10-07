const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const store = require('./store');

const parseEmoji = s => {
  const m = /^<(a?):(\w+):(\d+)>$/.exec((s || '').trim());
  return m ? { id: m[3], name: m[2], animated: !!m[1] } : ((s || '').trim() || undefined);
};
const color = c => parseInt(String(c || '#2b3a67').replace('#', ''), 16) || 0x2b3a67;
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const txt = t => new TextDisplayBuilder().setContent(String(t).slice(0, 3900));
const gal = u => new MediaGalleryBuilder().addItems({ media: { url: u } });
const fill = (t, v) => String(t)
  .replace(/\{user\}/g, `<@${v.ownerId}>`).replace(/\{role\}/g, v.role ? `<@&${v.role}>` : 'الفريق')
  .replace(/\{type\}/g, v.type || '').replace(/\{number\}/g, v.number || '');

// ===== بانل الاختيار (قائمة + أزرار روابط) =====
function buildPanel(p) {
  const opts = p.types.map(t => ({
    label: t.label.slice(0, 100), description: (t.description || '').slice(0, 100) || undefined,
    value: t.id, emoji: parseEmoji(t.emoji)
  }));
  if (p.showReset !== false) opts.push({ label: 'Reset Menu', description: 'Reset the menu', value: 'reset', emoji: '🔄' });
  const select = new StringSelectMenuBuilder().setCustomId(`tsel:${p.id}`)
    .setPlaceholder(p.placeholder || 'Select a ticket category...').addOptions(opts);
  const c = new ContainerBuilder().setAccentColor(color(p.color));
  const hasImg = !!p.bannerUrl;
  if (hasImg && p.imagePosition !== 'bottom') c.addMediaGalleryComponents(gal(p.bannerUrl));
  if (p.title) c.addTextDisplayComponents(txt(p.title));
  if (p.description) c.addTextDisplayComponents(txt(p.description));
  c.addSeparatorComponents(sep());
  c.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  if (hasImg && p.imagePosition === 'bottom') c.addMediaGalleryComponents(gal(p.bannerUrl));
  if (p.links?.length) {
    c.addSeparatorComponents(sep());
    c.addActionRowComponents(new ActionRowBuilder().addComponents(p.links.slice(0, 5).map(l => {
      const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(l.url).setLabel(l.label);
      if (l.emoji) b.setEmoji(parseEmoji(l.emoji));
      return b;
    })));
  }
  return c;
}

// ===== رسالة التذكرة 1: كونتينر V3 (ترحيب + معلومات + أقسام إضافية + أدوات + إغلاق) =====
function buildTicketMain(p, type, ctx) {
  const role = type.roleId || p.supportRoleId;
  const v = { ownerId: ctx.ownerId, role, type: type.label, number: ctx.number };
  const c = new ContainerBuilder().setAccentColor(color(p.color));
  c.addTextDisplayComponents(txt(fill(p.ticketTop || 'Hello {user}', v)));
  c.addSeparatorComponents(sep());
  if (p.ticketBanner) c.addMediaGalleryComponents(gal(p.ticketBanner));
  c.addTextDisplayComponents(txt(`## ${fill(p.ticketTitle || '✅ Your {type} ticket has been successfully opened', v)}\n${fill(p.ticketDesc || p.ticketWelcome || 'Please wait for the team to assist you.', v)}`));
  c.addTextDisplayComponents(txt(
    `<:Members:1463352151769354352> **Client:** <@${ctx.ownerId}>\n` +
    `<:info:1485270153259258036> **Section:** ${type.label}\n` +
    `<:ticket:1407298316135432193> **Ticket Number:** <#${ctx.channelId}>\n` +
    `<a:timer:1487799753944207490> **Creation Time:** <t:${ctx.ts}:F>` +
    (role ? `\n<:6316iconmoderator:1512471981151485961> **Assigned Team:** <@&${role}>` : '')));

  for (const x of type.extras || []) {
    if (!x.items?.length) continue;
    c.addSeparatorComponents(sep());
    c.addTextDisplayComponents(txt(`## ${x.title || 'Options'}${x.description ? `\n${x.description}` : ''}`));
    if (x.kind === 'buttons') {
      c.addActionRowComponents(new ActionRowBuilder().addComponents(x.items.slice(0, 5).map(it => {
        const b = new ButtonBuilder().setCustomId(`t_xb:${x.id}:${it.id}`).setLabel(it.label).setStyle(ButtonStyle.Secondary);
        if (it.emoji) b.setEmoji(parseEmoji(it.emoji));
        return b;
      })));
    } else {
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`t_x:${x.id}`).setPlaceholder(x.placeholder || 'Select an option')
          .addOptions(x.items.slice(0, 25).map(it => ({
            label: it.label.slice(0, 100), description: (it.description || '').slice(0, 100) || undefined,
            value: it.id, emoji: parseEmoji(it.emoji)
          })))));
    }
  }
  if (p.showTools !== false) {
    c.addSeparatorComponents(sep());
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('t_tools').setPlaceholder('Ticket Tools').addOptions(
        { label: 'Add User', value: 'add', emoji: '➕', description: 'Give someone access to this ticket' },
        { label: 'Remove User', value: 'rm', emoji: '➖', description: 'Remove someone from this ticket' },
        { label: 'Rename Ticket', value: 'rename', emoji: '✏️', description: 'Change the channel name' },
        { label: 'Lock / Unlock Ticket', value: 'lock', emoji: '🔒', description: 'Stop or allow the owner from writing' })));
  }
  c.addSeparatorComponents(sep());
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('t_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)));
  return c;
}

// ===== رسالة 2: كونتينر الترحيب (النص اللي تحدده) + زر الاستلام =====
const claimRow = done => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('t_claim').setLabel(done ? 'Claimed' : 'Claim')
    .setStyle(ButtonStyle.Success).setDisabled(!!done));
function buildClaim(p, type, ownerId, claimedBy) {
  const role = type.roleId || p.supportRoleId;
  const content = fill(type.welcome || 'A staff member will claim this ticket shortly.', { ownerId, role, type: type.label });
  const c = new ContainerBuilder().setAccentColor(claimedBy ? 0x57f287 : color(p.color))
    .addTextDisplayComponents(txt(claimedBy ? `${content}\n\n✅ Claimed by <@${claimedBy}>` : content));
  c.addSeparatorComponents(sep());
  c.addActionRowComponents(claimRow(!!claimedBy));
  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}
// ===== رسالة 3: صورة / خط فاصل بعد الزر =====
const buildAfter = p => p.afterImage ? { components: [gal(p.afterImage)], flags: MessageFlags.IsComponentsV2 } : null;

// رد الخيار (مثل بيانات التحويل لطريقة دفع)
const buildItemResponse = (p, type, it, ownerId) => new ContainerBuilder().setAccentColor(color(p.color))
  .addTextDisplayComponents(txt(`## ${it.label}\n${fill(it.response, { ownerId, role: type.roleId || p.supportRoleId, type: type.label })}`));

async function sendPanel(client, botId, p) {
  if (!p.channelId) throw new Error('اختر روم الإرسال أولاً');
  if (!p.types.length) throw new Error('أضف نوع تذكرة واحد على الأقل');
  const ch = await client.channels.fetch(p.channelId);
  if (ch.guildId !== p.guildId) throw new Error('الروم ليس في هذا السيرفر');
  const payload = { components: [buildPanel(p)], flags: MessageFlags.IsComponentsV2 };
  if (p.messageId) { try { const m = await ch.messages.fetch(p.messageId); await m.edit(payload); return; } catch {} }
  const m = await ch.send(payload);
  p.messageId = m.id;
  store.upsert(botId, p);
}

module.exports = { buildPanel, buildTicketMain, buildClaim, claimRow, buildAfter, buildItemResponse, sendPanel };
