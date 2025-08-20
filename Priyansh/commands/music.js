const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

module.exports.config = {
  name: "music",
  version: "3.0.1",
  hasPermssion: 0,
  credits: "Your Name (Fixed by ChatGPT)",
  description: "Search & download YouTube music",
  commandCategory: "media",
  usages: ".music [song name]",
  cooldowns: 5
};

async function testApi(query) {
  const testUrl = `https://api.princetechn.com/api/search/yts?apikey=prince&query=${encodeURIComponent(query)}`;
  try {
    const response = await axios.get(testUrl, { timeout: 10000 });
    console.log("API Test Full Response:", JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (e) {
    console.error("API Test Failed:", e.message);
    return null;
  }
}

module.exports.run = async function({ api, event, args }) {
  try {
    const query = args.join(" ");
    if (!query) return api.sendMessage("🎵 Please enter a song name", event.threadID);

    // React and notify  
    api.setMessageReaction("🔍", event.messageID, () => {}, true);  
    api.sendMessage(`🔎 Searching music for: "${query}"`, event.threadID);  

    const apiTest = await testApi(query);  
    if (!apiTest?.results?.length) {  
      return api.sendMessage(  
        `🔴 API Error but works manually?\n\nTry:\n1. Wait 5 mins\n2. Use VPN\n3. Contact admin\n\nDebug: ${apiTest ? "Empty results" : "API failed"}`,  
        event.threadID  
      );  
    }  

    const res = await axios.get(  
      `https://api.princetechn.com/api/search/yts?apikey=prince&query=${encodeURIComponent(query)}`,  
      {  
        headers: {  
          "User-Agent": "Mozilla/5.0",  
          "Accept": "application/json"  
        },  
        timeout: 15000  
      }  
    );  

    if (!res.data?.results?.length) {  
      return api.sendMessage(`❌ No results for "${query}"`, event.threadID);  
    }  

    const list = res.data.results.slice(0, 6);  
    let msg = "🎧 Results:\n\n";  
    list.forEach((item, i) => {  
      msg += `${i + 1}. ${item.title} (${item.duration?.timestamp || "?"})\n`;  
    });  
    msg += "\nReply 1-6 to download";  

    global.musicCache = { ...global.musicCache, [event.senderID]: list };  

    // ✅ Add final reaction  
    api.setMessageReaction("✅", event.messageID, () => {}, true);  

    return api.sendMessage(msg, event.threadID, (err, info) => {  
      if (err) return console.error(err);  
      global.client.handleReply.push({  
        name: this.config.name,  
        messageID: info.messageID,  
        author: event.senderID,  
        type: "music_select"  
      });  
    });

  } catch (err) {
    console.error("Run Error:", err);
    return api.sendMessage(
      `⚠️ Error:\n\n• Status: ${err.response?.status || "Unknown"}\n• Message: ${err.message}`,
      event.threadID
    );
  }
};

module.exports.handleReply = async function({ api, event, handleReply }) {
  try {
    if (handleReply.author !== event.senderID) return;

    const choice = parseInt(event.body);  
    if (isNaN(choice) || choice < 1 || choice > 6) {  
      return api.sendMessage("❌ Invalid choice. Reply with 1-6", event.threadID);  
    }  

    const cache = global.musicCache?.[event.senderID];  
    if (!cache) return api.sendMessage("⌛ Session expired. Search again", event.threadID);  

    const video = cache[choice - 1];  
    const downloadRes = await axios.get(  
      `https://api.princetechn.com/api/download/yta?apikey=prince&url=${encodeURIComponent(video.url)}`,  
      { timeout: 20000 }  
    );  

    if (!downloadRes.data?.result?.download_url) {  
      return api.sendMessage("❌ Download failed. Try another song.", event.threadID);  
    }  

    const song = downloadRes.data.result;  
    const time = Date.now();  
    const paths = {  
      audio: path.join(__dirname, `cache/music_${time}.mp3`),  
      thumb: path.join(__dirname, `cache/thumb_${time}.jpg`)  
    };  

    const [audio, thumb] = await Promise.all([  
      axios.get(song.download_url, { responseType: "arraybuffer", timeout: 30000 }),  
      axios.get(song.thumbnail, { responseType: "arraybuffer" })  
    ]);  

    await Promise.all([  
      fs.writeFile(paths.audio, audio.data),  
      fs.writeFile(paths.thumb, thumb.data)  
    ]);  

    // Send thumbnail with title first
    await api.sendMessage({ 
      body: `🎶 ${song.title}\n⏱ ${song.duration}`,
      attachment: fs.createReadStream(paths.thumb)
    }, event.threadID);

    // Then send the audio
    await api.sendMessage({
      attachment: fs.createReadStream(paths.audio)
    }, event.threadID);

    // Cleanup
    Object.values(paths).forEach(p => fs.unlink(p, () => {}));

  } catch (err) {
    console.error("Download Error:", err);
    api.sendMessage(`⚠️ Download failed:\n\n${err.message}`, event.threadID);
  }
};
