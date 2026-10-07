// مساعد موحّد: كل رسائل البوت بالكونتينر الجديد (Components V2)
// اللون يتحدد تلقائياً من أول ايموجي: ❌ أحمر • ✅ أخضر • غير كذا أزرق
const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, MessageFlags } = require('discord.js');

const V2 = MessageFlags.IsComponentsV2, EPH = MessageFlags.Ephemeral;
const colorOf = t => /^\s*❌/.test(t) ? 0xed4245 : /^\s*(✅|🎉)/.test(t) ? 0x57f287 : /^\s*(⚠️|⌛)/.test(t) ? 0xfee75c : 0x5865f2;

// كونتينر جاهز: نص + (اختياري) صفوف أزرار/قوائم داخله
const box = (text, { color, rows } = {}) => {
  const c = new ContainerBuilder().setAccentColor(color ?? colorOf(text))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(String(text).slice(0, 3900)));
  for (const r of rows || []) c.addActionRowComponents(r instanceof ActionRowBuilder ? r : new ActionRowBuilder().addComponents(r));
  return c;
};
// payload عام (للإرسال / reply / update / editReply)
const msg = (text, o = {}) => ({ components: [box(text, o)], flags: V2, ...(o.allowedMentions ? { allowedMentions: o.allowedMentions } : {}) });
// payload مخفي (ephemeral)
const eph = (text, o = {}) => ({ ...msg(text, o), flags: V2 | EPH });
// بدون أي منشن
const quiet = (text, o = {}) => msg(text, { ...o, allowedMentions: { parse: [] } });

module.exports = { box, msg, eph, quiet, V2, EPH };
