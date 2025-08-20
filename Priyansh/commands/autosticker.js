module.exports.config = {
  name: "autostickerBotReply",
  version: "1.0.0",
  hasPermssion: 0,
  credits: "Ayan Ali",
  description: "Auto sticker reply when someone says 'bot'",
  commandCategory: "auto",
  usages: "No prefix needed",
  cooldowns: 1
};

module.exports.handleEvent = async function ({ api, event }) {
  const { threadID, messageID, body } = event;
  if (!body) return;

  const content = body.toLowerCase().trim();
  if (content !== "bot") return;

  // Array of Messenger sticker IDs
  const stickers = [
    "1217082052973160",
    "1237286347479032",
    "1237285754145758",
    "1237285517479115",
    "1237286490812351",
    "1237285960812404",
    "1241305557077111",
    "1237286164145717",
    "1237285867479080",
    "1237285344145799",
    "2523887771219456",
    "2523887571219476",
    "2523886944552872",
    "2523887371219496",
    "2523889681219265",
    "2523888784552688",
    "2523890051219228",
    "2523889851219248",
    "2523893081218925",
    "2523892964552270",
    "2523891461219087",
    "456541050089007",
    "456538860089226",
    "2523891204552446"
  ];

  // Pick random sticker ID
  const randomSticker = stickers[Math.floor(Math.random() * stickers.length)];

  // Send the sticker
  return api.sendMessage({ sticker: randomSticker }, threadID, messageID);
};

module.exports.run = () => {};
