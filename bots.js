const { Client, GatewayIntentBits, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const store = require('./store'), { buildPanel, buildTicket } = require('./ui');

const V2 = MessageFlags.IsComponentsV2, EPH = MessageFlags.Ephemeral;
const clients = new Map(); // id -> { client, status, name, error, avatar, invite }
const isStaff = (m, p) => (p.supportRoleId && m.roles.cache.has(p.supportRoleId)) || m.permissions.has(PermissionFlagsBits.Administrator);

// نفس الأوامر والتفاعلات تشتغل على أي بوت جديد
function attach(client, botId) {
  client.on('interactionCreate', async i => {
    try {
      if (i.isStringSelectMenu() && i.customId.startsWith('tsel:')) {
        const p = store.get(botId, i.customId.split(':')[1]);
        if (!p || p.guildId !== i.guildId) return i.reply({ content: '❌ هذه اللوحة لم تعد موجودة', flags: EPH });
        await i.update({ components: [buildPanel(p)], flags: V2 }); // يرجّع القائمة بدون اختيار
        const val = i.values[0];
        if (val === 'reset') return;
        const type = p.types.find(t => t.id === val);
        if (!type) return;

        const topic = `${i.user.id}:${p.id}:${type.id}`;
        const old = i.guild.channels.cache.find(c => c.topic === topic);
        if (old) return i.followUp({ content: `❌ عندك تذكرة مفتوحة: ${old}`, flags: EPH });

        const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory];
        const ow = [{ id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: i.user.id, allow }];
        if (p.supportRoleId) ow.push({ id: p.supportRoleId, allow });
        const ch = await i.guild.channels.create({
          name: `${type.label}-${i.user.username}`.slice(0, 90), type: ChannelType.GuildText,
          parent: p.categoryId || null, topic, permissionOverwrites: ow
        });
        await ch.send({ components: [buildTicket(p, type, i.user.id)], flags: V2 });
        return i.followUp({ content: `✅ تم فتح تذكرتك: ${ch}`, flags: EPH });
      }

      if (i.isButton() && (i.customId === 't_claim' || i.customId === 't_close')) {
        const [ownerId, panelId, typeId] = (i.channel.topic || '').split(':');
        const p = store.get(botId, panelId);
        if (!p) return i.reply({ content: '❌ بيانات اللوحة غير موجودة', flags: EPH });
        if (i.customId === 't_claim') {
          if (!isStaff(i.member, p)) return i.reply({ content: '❌ للستاف فقط', flags: EPH });
          const type = p.types.find(t => t.id === typeId) || { label: 'تذكرة' };
          return i.update({ components: [buildTicket(p, type, ownerId, i.user.id)], flags: V2 });
        }
        if (!isStaff(i.member, p) && i.user.id !== ownerId)
          return i.reply({ content: '❌ ما عندك صلاحية', flags: EPH });
        await i.reply({ content: '🔒 سيتم حذف التذكرة خلال 5 ثواني...' });
        if (p.logChannelId)
          i.guild.channels.cache.get(p.logChannelId)?.send(`🔒 أُغلقت \`${i.channel.name}\` بواسطة <@${i.user.id}> (صاحبها <@${ownerId}>)`);
        setTimeout(() => i.channel.delete().catch(() => {}), 5000);
      }
    } catch (e) {
      console.error(e);
      if (!i.replied && !i.deferred) i.reply({ content: '❌ صار خطأ', flags: EPH }).catch(() => {});
    }
  });
}

async function start(rec) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const entry = { client, status: 'connecting', name: 'جاري الاتصال...' };
  clients.set(rec.id, entry);
  attach(client, rec.id);
  client.once('clientReady', () => {
    entry.status = 'online'; entry.name = client.user.username; entry.avatar = client.user.displayAvatarURL();
    entry.invite = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=101392&scope=bot%20applications.commands`;
    console.log(`بوت جاهز: ${client.user.tag}`);
  });
  try {
    await client.login(rec.token);
    if (!client.isReady()) await new Promise(r => { client.once('clientReady', r); setTimeout(r, 8000); });
  } catch { entry.error = 'التوكن غير صالح'; }
  if (!client.isReady()) { entry.status = 'error'; entry.error ||= 'تعذر تشغيل البوت'; }
  return entry;
}

async function stop(id) { const e = clients.get(id); if (e) { await e.client.destroy(); clients.delete(id); } }
const get = id => clients.get(id);
const firstOnline = () => [...clients.values()].find(e => e.status === 'online');
const hasToken = t => process.env.TOKEN === t || store.bots.all().some(b => b.token === t);
const list = () => [...clients.entries()].map(([id, e]) => ({
  id, name: e.name, status: e.status, error: e.error, avatar: e.avatar, invite: e.invite, main: id === 'main', guilds: e.client.guilds.cache.size
}));

module.exports = { start, stop, get, firstOnline, hasToken, list };
