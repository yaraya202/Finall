const fs = require("fs-extra");
const request = require("request");
const { tikdown } = require("shaon-videos-downloader");

module.exports.config = {
    name: "autotiktok",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "𝐏𝐫𝐢𝐲𝐚𝐧𝐬𝐡 𝐑𝐚𝐣𝐩𝐮𝐭 & Grok",
    description: "Automatically download TikTok video when a URL is sent (no prefix required)",
    commandCategory: "For user",
    usages: "Send a TikTok URL directly",
    cooldowns: 5
};

module.exports.onLoad = function() {
    console.log("===AUTO TIKTOK VIDEO DOWNLOADER (NO PREFIX REQUIRED)===");
};

module.exports.run = async function({ event, api }) {
    const { messageID, threadID, body } = event;
    console.log("Message received:", body); // Debug log

    // Send a confirmation message
    api.sendMessage("Processing your TikTok URL...", threadID, messageID);

    // Check if the message contains a TikTok URL
    const urlPattern = /https:\/\/(vt\.tiktok\.com|www\.tiktok\.com)\/[^\s]*/g;
    const urls = body.match(urlPattern);

    if (!urls || urls.length === 0) {
        console.log("No TikTok URL detected in:", body); // Debug log
        return; // Do nothing if no TikTok URL is found
    }

    console.log("Detected TikTok URL:", urls[0]); // Debug log
    const tiktokUrl = urls[0];

    try {
        console.log('Attempting tikdown for URL:', tiktokUrl);
        const result = await tikdown(tiktokUrl);
        console.log('tikdown Result:', result);

        if (!result || !result.data || !result.data.play) {
            console.log('Invalid tikdown response:', result);
            return api.sendMessage("Failed to download the TikTok video. The URL might be invalid or unavailable.", threadID, messageID);
        }

        const videoUrl = result.data.play;
        const videoTitle = result.data.title || "TikTok Video";
        const author = result.data.author?.nickname || "Unknown";

        console.log('Downloading video from:', videoUrl);
        const videoPath = __dirname + "/cache/tiktokvideo.mp4";
        const callback = () => {
            api.sendMessage(
                {
                    body: `🎥 TikTok Video\nTitle: ${videoTitle}\nAuthor: ${author}`,
                    attachment: fs.createReadStream(videoPath)
                },
                threadID,
                () => fs.unlinkSync(videoPath), // Delete the file after sending
                messageID
            );
        };

        request(encodeURI(videoUrl))
            .pipe(fs.createWriteStream(videoPath))
            .on('close', callback)
            .on('error', (err) => {
                console.error('Error downloading video:', err);
                api.sendMessage("An error occurred while downloading the video.", threadID, messageID);
            });

    } catch (error) {
        console.error('tikdown Error:', error);
        api.sendMessage("An error occurred while processing the TikTok URL.", threadID, messageID);
    }
};