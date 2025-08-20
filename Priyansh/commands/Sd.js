const axios = require("axios");

module.exports.config = {
  name: "sd",
  version: "1.0.1",
  hasPermission: 0,
  credits: "raj",
  description: "Generate AI image using Stable Diffusion",
  commandCategory: "AI",
  usages: "[prompt]",
  cooldowns: 5
};

module.exports.run = async function ({ api, event, args }) {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    return api.sendMessage("⚠️ Prompt missing.\nUsage: sd <your prompt>", event.threadID, event.messageID);
  }

  try {
    const response = await axios.get("https://api.princetechn.com/api/ai/sd", {
      params: {
        apikey: "prince",
        prompt: prompt
      },
      responseType: "stream"
    });

    return api.sendMessage({
      body: `🧠 Prompt: ${prompt}`,
      attachment: response.data
    }, event.threadID, event.messageID);
  } catch (err) {
    console.error("❌ API Error:", err.message);
    return api.sendMessage("❌ Image generate नहीं हो पाई. Please try again later or use another prompt.", event.threadID, event.messageID);
  }
};
