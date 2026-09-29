require('dotenv').config();
const store = require('./store'), bots = require('./bots');

(async () => {
  if (process.env.TOKEN) await bots.start({ id: 'main', token: process.env.TOKEN }); // اختياري
  for (const b of store.bots.all()) bots.start(b);                                    // البوتات المضافة من الداشبورد
  require('./server')();
})();
