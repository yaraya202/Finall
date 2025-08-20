const fs = require("fs");
module.exports.config = {
  name: "ownerinfo",
  version: "1.0.3",
  hasPermssion: 0,
  credits: "𝗞𝗮𝘀𝗵𝗶𝗳 𝗥𝗮𝘇𝗮 (𝗔𝘆𝗮𝗻 𝗔𝗹𝗶)",
  description: "Sends stylish owner info when someone says 'owner'",
  commandCategory: "auto-response",
  usages: "auto owner info",
  cooldowns: 2,
};

module.exports.handleEvent = async function ({ api, event }) {
  const { body, threadID, messageID } = event;
  if (!body) return;

  const text = body.toLowerCase();
  if (text.includes("Owner")) {
    const message = `📘✨ *OWNER INFO* ✨📘

(◕‿◕)➤ ★彡[ᴋᴀꜱʜɪꜰ ʀᴀᴢᴀ]彡★ (💀 𝑩𝒂𝒅 𝑩𝒐𝒚 𝑽𝒊𝒃𝒆𝒔 😎)
👑 𝑨𝒈𝒆 : 22
💘 𝑹𝒆𝒍𝒂𝒕𝒊𝒐𝒏𝒔𝒉𝒊𝒑 : 𝑵𝒐𝒏𝒆, 𝑩𝒆𝒄𝒂𝒖𝒔𝒆 𝑰 𝑨𝒎 𝑬𝒏𝒐𝒖𝒈𝒉 😌
🏡 𝑭𝒓𝒐𝒎 : 𝑾𝒂𝒅𝒊𝒆 𝑳𝒐𝒗𝒆𝒓𝒔 ✨
🎓 𝑺𝒕𝒖𝒅𝒚 : 𝑪𝒐𝒎𝒑𝒖𝒕𝒆𝒓 𝑷𝒓𝒐𝒈𝒓𝒂𝒎𝒎𝒊𝒏𝒈 👨‍💻
📘 𝑭𝒂𝒄𝒆𝒃𝒐𝒐𝒌 : https://www.facebook.com/100001854531633

📞 𝑾𝒉𝒂𝒕𝒔𝒂𝒑𝒑 : https://wa.me/447354208303
𝒕𝒂𝒎𝒊𝒛 𝒔𝒆 𝒃𝒂𝒂𝒕 𝒌𝒓, 𝒄𝒉𝒂𝒍 𝒏𝒆𝒌𝒂𝒍 ⚠️

🖤 
"𝑻𝒖 𝒘𝒂𝒇𝒂 𝒌𝒊 𝒃𝒂𝒂𝒕 𝒌𝒂𝒓𝒕𝒂 𝒉𝒂𝒊,  
𝑯𝒂𝒎 𝒕𝒐 𝒕𝒂𝒒𝒅𝒊𝒓𝒐𝒏 𝒌𝒐 𝒃𝒉𝒊 𝒄𝒉𝒉𝒐𝒓 𝒅𝒆𝒕𝒆 𝒉𝒂𝒊𝒏!" 😈💔🔥`;

    return api.sendMessage(
      {
        body: message,
        attachment: fs.createReadStream(__dirname + `/noprefix/kashif.png`)
      },
      threadID,
      messageID
    );
  }
};

module.exports.run = () => {};
