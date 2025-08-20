const axios = require("axios");

module.exports = {
  config: {
    name: "pakdb",
    version: "1.0.0",
    author: "Mirrykal",
    description: "Search Pakistani mobile number info using PakDatabase API",
    commandCategory: "🔍 Utilities",
    usages: "pakdb <pakistani_number>",
    cooldowns: 5,
  },

  run: async function ({ api, event, args }) {
    const input = args[0];
    if (!input) return api.sendMessage("📞 Please enter a Pakistani mobile number!\n\nExample: pakdb 03453XXXXXX", event.threadID);

    const searchNumber = input.startsWith("92") ? input : input.replace(/^0/, "92");
    const url = `https://pakdatabase.site/api/search.php?username=Kami&password=123456&search_term=${searchNumber}`;

    try {
      const res = await axios.get(url);
      const telenor = res.data.telenor;

      if (!telenor || telenor.length === 0) {
        return api.sendMessage(`❌ No record found for: ${input}`, event.threadID);
      }

      const info = telenor[0];

      const message = `
━━━━━━━━━━━━━━━
📱 𝗠𝗼𝗯𝗶𝗹𝗲 ➤ ${info.Mobile}
👤 𝗡𝗮𝗺𝗲 ➤ ${info.Name}
🪪 𝗖𝗡𝗜𝗖 ➤ ${info.CNIC}
📍 𝗔𝗱𝗱𝗿𝗲𝘀𝘀 ➤ ${info.Address?.trim()}
✅ 𝗦𝘁𝗮𝘁𝘂𝘀 ➤ ${info.Status.toUpperCase()}
━━━━━━━━━━━━━━━
🇵🇰 Data fetched from PAK DATABASE 🔍
ℹ️ Bot by: Ayan (Raza)
      `.trim();

      return api.sendMessage(message, event.threadID);
    } catch (err) {
      console.error(err);
      return api.sendMessage("⚠️ Error fetching data. Try again later!", event.threadID);
    }
  },
};
