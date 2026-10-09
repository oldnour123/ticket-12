const {
  Client, GatewayIntentBits, MessageFlags, ChannelType, PermissionFlagsBits, ActionRowBuilder,
  UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const store = require('./store'), extras = require('./extras'), prefix = require('./prefix');
const { buildPanel, buildTicketMain, buildClaim, claimRow, buildAfter, buildItemResponse } = require('./ui');

const V2 = MessageFlags.IsComponentsV2, EPH = MessageFlags.Ephemeral, P = PermissionFlagsBits;
const clients = new Map();
const isStaff = (m, p, type) => [p.supportRoleId, type?.roleId].some(r => r && m.roles.cache.has(r)) || m.permissions.has(P.Administrator);
const slug = s => String(s).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40) || 'ticket';
const nextNumber = (b, pid) => { const c = store.kv.get(b, 'counters', {}); c[pid] = (c[pid] || 0) + 1; store.kv.set(b, 'counters', c); return c[pid]; };

function attach(client, botId) {
  // بيانات التذكرة من توبك الروم: owner:panel:type:number:timestamp
  const info = i => {
    const [ownerId, panelId, typeId, number, ts] = (i.channel?.topic || '').split(':');
    const p = store.get(botId, panelId);
    const type = p?.types.find(t => t.id === typeId);
    return { p, type, ownerId, ctx: { ownerId, channelId: i.channel?.id, number, ts } };
  };
  const bad = i => i.reply({ content: 'Ticket data not found', flags: EPH });

  client.on('interactionCreate', async i => {
    try {
      if (await extras.handle(i)) return;
      if (await prefix.interaction(i)) return;

      // ===== فتح تذكرة من البانل =====
      if (i.isStringSelectMenu() && i.customId.startsWith('tsel:')) {
        const p = store.get(botId, i.customId.split(':')[1]);
        if (!p || p.guildId !== i.guildId) return i.reply({ content: 'This panel no longer exists', flags: EPH });
        await i.update({ components: [buildPanel(p)], flags: V2 });
        const type = p.types.find(t => t.id === i.values[0]);
        if (!type) return;
        const prefix = `${i.user.id}:${p.id}:${type.id}:`;
        const old = i.guild.channels.cache.find(c => c.topic?.startsWith(prefix));
        if (old) return i.followUp({ content: `You already have an open ticket: ${old}`, flags: EPH });

        const number = nextNumber(botId, p.id), ts = Math.floor(Date.now() / 1000);
        const role = type.roleId || p.supportRoleId;
        const allow = [P.ViewChannel, P.SendMessages, P.AttachFiles, P.ReadMessageHistory];
        const ow = [
          { id: i.guild.id, deny: [P.ViewChannel] },
          { id: client.user.id, allow: [...allow, P.ManageChannels] },
          { id: i.user.id, allow }
        ];
        if (role) ow.push({ id: role, allow });
        const ch = await i.guild.channels.create({
          name: `${slug(type.label)}-${number}`, type: ChannelType.GuildText, parent: p.categoryId || null,
          topic: `${prefix}${number}:${ts}`, permissionOverwrites: ow
        });
        const am = { users: [i.user.id], roles: role ? [role] : [] };
        await ch.send({ components: [buildTicketMain(p, type, { ownerId: i.user.id, channelId: ch.id, number, ts })], flags: V2, allowedMentions: am });
        await ch.send({ ...buildClaim(p, type, i.user.id), allowedMentions: am });
        const after = buildAfter(p); if (after) await ch.send(after);
        return i.followUp({ content: `Ticket opened: ${ch}`, flags: EPH });
      }

      // ===== أقسام إضافية (قوائم/أزرار طرق الدفع...) =====
      if ((i.isStringSelectMenu() && i.customId.startsWith('t_x:')) || (i.isButton() && i.customId.startsWith('t_xb:'))) {
        const { p, type, ownerId, ctx } = info(i); if (!p || !type) return bad(i);
        if (i.user.id !== ownerId && !isStaff(i.member, p, type)) return i.reply({ content: 'Only the ticket owner or staff can use this', flags: EPH });
        const [xid, itemId] = i.isButton() ? i.customId.split(':').slice(1) : [i.customId.slice(4), i.values[0]];
        const it = type.extras?.find(e => e.id === xid)?.items.find(t => t.id === itemId);
        await i.update({ components: [buildTicketMain(p, type, ctx)], flags: V2 }); // يرجّع القائمة فاضية
        if (!it) return;
        if (it.response) await i.channel.send({ components: [buildItemResponse(p, type, it, ownerId)], flags: V2, allowedMentions: { users: [ownerId] } });
        i.channel.setName(`${slug(type.label)}-${slug(it.label)}`).catch(() => {}); // اسم الروم: القسم-الخيار
        return;
      }

      // ===== أدوات التذكرة =====
      if (i.isStringSelectMenu() && i.customId === 't_tools') {
        const { p, type, ownerId, ctx } = info(i); if (!p || !type) return bad(i);
        const reset = () => i.message.edit({ components: [buildTicketMain(p, type, ctx)], flags: V2 }).catch(() => {});
        if (!isStaff(i.member, p, type)) { await reset(); return i.reply({ content: 'Ticket tools are for staff only', flags: EPH }); }
        const v = i.values[0];
        if (v === 'rename') {
          await i.showModal(new ModalBuilder().setCustomId('t_rename').setTitle('Rename Ticket').addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('New name')
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80))));
          return reset();
        }
        await reset();
        if (v === 'add' || v === 'rm')
          return i.reply({ content: v === 'add' ? 'Select the user to add:' : 'Select the user to remove:', flags: EPH,
            components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(v === 'add' ? 't_add' : 't_rm').setPlaceholder('Select a user').setMaxValues(1))] });
        if (v === 'lock') {
          const locked = i.channel.permissionOverwrites.cache.get(ownerId)?.deny.has(P.SendMessages);
          await i.channel.permissionOverwrites.edit(ownerId, { SendMessages: !!locked });
          return i.reply({ content: locked ? 'Ticket unlocked, the owner can write again.' : 'Ticket locked, the owner can no longer write.' });
        }
      }
      if (i.isUserSelectMenu() && (i.customId === 't_add' || i.customId === 't_rm')) {
        const { p, type, ownerId } = info(i); if (!p || !type || !isStaff(i.member, p, type)) return i.update({ content: 'Staff only', components: [] });
        const uid = i.values[0];
        if (i.customId === 't_add') {
          await i.channel.permissionOverwrites.edit(uid, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
          await i.update({ content: 'User added', components: [] });
          return i.channel.send({ content: `<@${uid}> was added to the ticket by <@${i.user.id}>`, allowedMentions: { users: [uid] } });
        }
        if (uid === ownerId) return i.update({ content: 'You cannot remove the ticket owner', components: [] });
        await i.channel.permissionOverwrites.delete(uid);
        await i.update({ content: 'User removed', components: [] });
        return i.channel.send({ content: `<@${uid}> was removed from the ticket by <@${i.user.id}>`, allowedMentions: { parse: [] } });
      }
      if (i.isModalSubmit() && i.customId === 't_rename') {
        const { p, type } = info(i); if (!p || !type || !isStaff(i.member, p, type)) return i.reply({ content: 'Staff only', flags: EPH });
        await i.channel.setName(slug(i.fields.getTextInputValue('name')));
        return i.reply({ content: `Ticket renamed by <@${i.user.id}>`, allowedMentions: { parse: [] } });
      }

      // ===== استلام وإغلاق =====
      if (i.isButton() && (i.customId === 't_claim' || i.customId === 't_close')) {
        const { p, type, ownerId } = info(i); if (!p) return bad(i);
        if (i.customId === 't_claim') {
          if (!isStaff(i.member, p, type)) return i.reply({ content: 'Staff only', flags: EPH });
          await i.update({ content: `${i.message.content}\n\nClaimed by <@${i.user.id}>`, components: [claimRow(true)], allowedMentions: { parse: [] } });
          return prefix.addPoint(botId, i.guildId, i.user.id); // نقطة للستاف عند الاستلام
        }
        if (!isStaff(i.member, p, type) && i.user.id !== ownerId) return i.reply({ content: 'You do not have permission', flags: EPH });
        await i.reply({ content: 'This ticket will be deleted in 5 seconds...' });
        if (p.logChannelId) i.guild.channels.cache.get(p.logChannelId)?.send({ content: `Ticket \`${i.channel.name}\` was closed by <@${i.user.id}> (owner: <@${ownerId}>)`, allowedMentions: { parse: [] } });
        setTimeout(() => i.channel.delete().catch(() => {}), 5000);
      }
    } catch (e) {
      console.error(e);
      const msg = { content: 'Something went wrong. Make sure the bot has the Manage Channels permission and the category is valid.', flags: EPH };
      (i.replied || i.deferred ? i.followUp(msg) : i.reply(msg)).catch(() => {});
    }
  });
}

function make(rec, entry, intents) {
  const client = new Client({ intents });
  client.botId = rec.id; entry.client = client;
  attach(client, rec.id);
  client.once('clientReady', () => {
    entry.status = 'online'; entry.name = client.user.username; entry.avatar = client.user.displayAvatarURL();
    entry.invite = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=101392&scope=bot%20applications.commands`;
    extras.registerAll(client);
    console.log(`بوت جاهز: ${client.user.tag}`);
  });
  client.on('guildCreate', g => extras.register(g));
  client.on('messageDelete', m => prefix.onDelete(m));
  client.on('guildMemberAdd', mb => prefix.greet(mb, rec.id).catch(() => {}));
  client.on('messageCreate', m => extras.onMessage(m, rec.id).catch(() => {}));
  return client;
}
async function login(client, token) {
  await client.login(token);
  if (!client.isReady()) await new Promise(r => { client.once('clientReady', r); setTimeout(r, 8000); });
}
const G = GatewayIntentBits;
const TIERS = [
  [G.Guilds, G.GuildMessages, G.MessageContent, G.GuildMembers, G.GuildVoiceStates],
  [G.Guilds, G.GuildMessages, G.MessageContent, G.GuildVoiceStates],
  [G.Guilds, G.GuildMessages, G.GuildVoiceStates]
];
async function start(rec) {
  const entry = { status: 'connecting', name: 'جاري الاتصال...' };
  clients.set(rec.id, entry);
  let client;
  for (let t = 0; t < TIERS.length; t++) {
    client = make(rec, entry, TIERS[t]);
    try {
      await login(client, rec.token);
      entry.warn = t === 1 ? 'Server Members Intent غير مفعّل: رسالة الترحيب ($greet) والأوامر $bots و$inrole ما بتشتغل. فعّله من Developer Portal ثم Bot.'
        : t === 2 ? 'Message Content Intent غير مفعّل: أوامر $ والرد على كلمات محددة وروم الضريبة ما بتشتغل. فعّله من Developer Portal ثم Bot.' : undefined;
      break;
    } catch (e) {
      await client.destroy().catch(() => {});
      if (!/intent/i.test(`${e.code} ${e.message}`) || t === TIERS.length - 1) { entry.error = 'التوكن غير صالح'; break; }
    }
  }
  if (!client?.isReady()) { entry.status = 'error'; entry.error ||= 'تعذر تشغيل البوت'; }
  return entry;
}
async function stop(id) { const e = clients.get(id); if (e) { await e.client.destroy(); clients.delete(id); } }
const get = id => clients.get(id);
const firstOnline = () => [...clients.values()].find(e => e.status === 'online');
const hasToken = t => process.env.TOKEN === t || store.bots.all().some(b => b.token === t);
const list = () => [...clients.entries()].map(([id, e]) => ({
  id, name: e.name, status: e.status, error: e.error, avatar: e.avatar, invite: e.invite, warn: e.warn,
  main: id === 'main', guilds: e.client.guilds.cache.size
}));
module.exports = { start, stop, get, firstOnline, hasToken, list };
