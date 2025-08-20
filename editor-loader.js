
const fs = require('fs-extra');
const path = require('path');
const logger = require("./utils/log");

// User-specific file management for code editor
class EditorLoader {
    constructor(app) {
        this.app = app;
        this.setupRoutes();
    }

    // Get user-specific files directory
    getUserCodeDir(userEmail) {
        return path.join(__dirname, 'bots', userEmail);
    }

    // Ensure user directory exists
    ensureUserDirectory(userEmail) {
        const userCodeDir = path.join(__dirname, 'user_code', userEmail);
        const commandsDir = path.join(userCodeDir, 'commands');
        const eventsDir = path.join(userCodeDir, 'events');
        
        fs.mkdirSync(commandsDir, { recursive: true });
        fs.mkdirSync(eventsDir, { recursive: true });
        
        return { userDir: userCodeDir, commandsDir, eventsDir };
    }

    // Get user's imported files
    getUserFiles(userEmail) {
        try {
            // First check user_code directory for personal edited files
            const userCodeDir = path.join(__dirname, 'user_code', userEmail);
            let commands = new Set();
            let events = new Set();

            // Get user's personal edited files
            if (fs.existsSync(userCodeDir)) {
                const userCommandsDir = path.join(userCodeDir, 'commands');
                const userEventsDir = path.join(userCodeDir, 'events');

                if (fs.existsSync(userCommandsDir)) {
                    const userCommands = fs.readdirSync(userCommandsDir)
                        .filter(file => file.endsWith('.js'));
                    userCommands.forEach(cmd => commands.add(cmd));
                }

                if (fs.existsSync(userEventsDir)) {
                    const userEvents = fs.readdirSync(userEventsDir)
                        .filter(file => file.endsWith('.js'));
                    userEvents.forEach(evt => events.add(evt));
                }
            }

            // Also check user's bot directories for imported files
            const userBotsDir = this.getUserCodeDir(userEmail);
            if (fs.existsSync(userBotsDir)) {
                const botDirs = fs.readdirSync(userBotsDir)
                    .filter(dir => fs.statSync(path.join(userBotsDir, dir)).isDirectory());

                for (const botId of botDirs) {
                    const botDir = path.join(userBotsDir, botId);
                    const botCommandsDir = path.join(botDir, 'commands');
                    const botEventsDir = path.join(botDir, 'events');

                    // Get commands from this bot
                    if (fs.existsSync(botCommandsDir)) {
                        const botCommands = fs.readdirSync(botCommandsDir)
                            .filter(file => file.endsWith('.js'));
                        botCommands.forEach(cmd => commands.add(cmd));
                    }

                    // Get events from this bot
                    if (fs.existsSync(botEventsDir)) {
                        const botEvents = fs.readdirSync(botEventsDir)
                            .filter(file => file.endsWith('.js'));
                        botEvents.forEach(evt => events.add(evt));
                    }
                }
            }

            const commandsArray = Array.from(commands).sort();
            const eventsArray = Array.from(events).sort();

            logger(`Loaded ${commandsArray.length} commands and ${eventsArray.length} events for user ${userEmail}`, "[EDITOR LOADER]");
            return { commands: commandsArray, events: eventsArray };
        } catch (error) {
            logger(`Error getting user files for ${userEmail}: ${error.message}`, "[EDITOR LOADER ERROR]");
            return { commands: [], events: [] };
        }
    }

    // Get user file content
    getUserFileContent(userEmail, type, fileName) {
        try {
            // First check user's personal edited files
            const userCodeDir = path.join(__dirname, 'user_code', userEmail);
            const userTargetDir = path.join(userCodeDir, type === 'command' ? 'commands' : 'events');
            const userFilePath = path.join(userTargetDir, fileName);

            if (fs.existsSync(userFilePath)) {
                const content = fs.readFileSync(userFilePath, 'utf8');
                logger(`Loaded user's personal file ${type}/${fileName} (${content.length} chars)`, "[EDITOR LOADER]");
                return content;
            }

            // Check user's bot directories for imported files
            const userBotsDir = this.getUserCodeDir(userEmail);
            if (fs.existsSync(userBotsDir)) {
                const botDirs = fs.readdirSync(userBotsDir)
                    .filter(dir => fs.statSync(path.join(userBotsDir, dir)).isDirectory());

                for (const botId of botDirs) {
                    const botDir = path.join(userBotsDir, botId);
                    const targetDir = path.join(botDir, type === 'command' ? 'commands' : 'events');
                    const filePath = path.join(targetDir, fileName);

                    if (fs.existsSync(filePath)) {
                        const content = fs.readFileSync(filePath, 'utf8');
                        logger(`Loaded content for user file ${type}/${fileName} from bot ${botId} (${content.length} chars)`, "[EDITOR LOADER]");
                        return content;
                    }
                }
            }

            // If user file doesn't exist, try to load from original system files for import
            const originalDir = path.join(__dirname, 'Priyansh', type === 'command' ? 'commands' : 'events');
            const originalPath = path.join(originalDir, fileName);
            
            if (fs.existsSync(originalPath)) {
                const originalContent = fs.readFileSync(originalPath, 'utf8');
                logger(`Loaded original system file ${type}/${fileName} for user ${userEmail}`, "[EDITOR LOADER]");
                return originalContent;
            }
            
            // Return template content for completely new files
            return this.getTemplateContent(type, fileName);
        } catch (error) {
            logger(`Error reading user file ${type}/${fileName} for ${userEmail}: ${error.message}`, "[EDITOR LOADER ERROR]");
            return this.getTemplateContent(type, fileName);
        }
    }

    // Save user file content
    saveUserFileContent(userEmail, type, fileName, content) {
        try {
            // Save to user_code directory (master copy)
            const userCodeDir = path.join(__dirname, 'user_code', userEmail);
            const userCodeTargetDir = path.join(userCodeDir, type === 'command' ? 'commands' : 'events');
            fs.mkdirSync(userCodeTargetDir, { recursive: true });
            const userCodeFilePath = path.join(userCodeTargetDir, fileName);
            fs.writeFileSync(userCodeFilePath, content, 'utf8');

            // Also sync to all existing bot directories for this user
            const userBotsDir = this.getUserCodeDir(userEmail);
            if (fs.existsSync(userBotsDir)) {
                const botDirs = fs.readdirSync(userBotsDir)
                    .filter(dir => fs.statSync(path.join(userBotsDir, dir)).isDirectory());

                for (const botId of botDirs) {
                    const botDir = path.join(userBotsDir, botId);
                    const botTargetDir = path.join(botDir, type === 'command' ? 'commands' : 'events');
                    
                    if (fs.existsSync(botTargetDir)) {
                        const botFilePath = path.join(botTargetDir, fileName);
                        // Only update if file exists in this bot directory
                        if (fs.existsSync(botFilePath)) {
                            fs.writeFileSync(botFilePath, content, 'utf8');
                            logger(`Synced ${type}/${fileName} to bot ${botId}`, "[EDITOR LOADER]");
                        }
                    }
                }
            }

            logger(`User ${userEmail} saved ${type}: ${fileName}`, "[EDITOR LOADER]");
            return true;
        } catch (error) {
            logger(`Error saving user file ${type}/${fileName} for ${userEmail}: ${error.message}`, "[EDITOR LOADER ERROR]");
            return false;
        }
    }

    // Delete user file
    deleteUserFile(userEmail, type, fileName) {
        try {
            const { commandsDir, eventsDir } = this.ensureUserDirectory(userEmail);
            const targetDir = type === 'command' ? commandsDir : eventsDir;
            const filePath = path.join(targetDir, fileName);

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger(`User ${userEmail} deleted ${type}: ${fileName}`, "[EDITOR LOADER]");
                return true;
            }
            return false;
        } catch (error) {
            logger(`Error deleting user file ${type}/${fileName} for ${userEmail}: ${error.message}`, "[EDITOR LOADER ERROR]");
            return false;
        }
    }

    // Reset user file to original system version
    resetUserFileToOriginal(userEmail, type, fileName) {
        try {
            const originalDir = path.join(__dirname, 'Priyansh', type === 'command' ? 'commands' : 'events');
            const originalPath = path.join(originalDir, fileName);

            if (fs.existsSync(originalPath)) {
                const originalContent = fs.readFileSync(originalPath, 'utf8');
                this.saveUserFileContent(userEmail, type, fileName, originalContent);
                return originalContent;
            } else {
                return this.getTemplateContent(type, fileName);
            }
        } catch (error) {
            logger(`Error resetting user file ${type}/${fileName} for ${userEmail}: ${error.message}`, "[EDITOR LOADER ERROR]");
            return this.getTemplateContent(type, fileName);
        }
    }

    // Import system file to user directory
    importSystemFile(userEmail, type, fileName) {
        try {
            const originalDir = path.join(__dirname, 'Priyansh', type === 'command' ? 'commands' : 'events');
            const originalPath = path.join(originalDir, fileName);

            if (fs.existsSync(originalPath)) {
                const content = fs.readFileSync(originalPath, 'utf8');
                this.saveUserFileContent(userEmail, type, fileName, content);
                logger(`User ${userEmail} imported ${type}: ${fileName}`, "[EDITOR LOADER]");
                return true;
            }
            return false;
        } catch (error) {
            logger(`Error importing system file ${type}/${fileName} for ${userEmail}: ${error.message}`, "[EDITOR LOADER ERROR]");
            return false;
        }
    }

    // Get template content for new files
    getTemplateContent(type, fileName) {
        const name = fileName.replace('.js', '');
        
        if (type === 'command') {
            return `module.exports.config = {
    name: "${name}",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "Your Name",
    description: "Description of your command",
    commandCategory: "general",
    usages: "${name}",
    cooldowns: 5
};

module.exports.run = async ({ api, event, args }) => {
    try {
        // Your command logic here
        api.sendMessage("Hello from ${name}!", event.threadID, event.messageID);
    } catch (error) {
        api.sendMessage("An error occurred: " + error.message, event.threadID, event.messageID);
    }
};`;
        } else {
            return `module.exports.config = {
    name: "${name}",
    eventType: ["log:subscribe", "log:unsubscribe"],
    version: "1.0.0",
    credits: "Your Name",
    description: "Description of your event"
};

module.exports.run = async ({ api, event }) => {
    try {
        // Your event logic here
        console.log("Event triggered:", event.logMessageType);
    } catch (error) {
        console.error("Event error:", error.message);
    }
};`;
        }
    }

    // Get all available system files for import
    getAvailableSystemFiles() {
        try {
            const commandsPath = path.join(__dirname, 'Priyansh/commands');
            const eventsPath = path.join(__dirname, 'Priyansh/events');

            let commands = [];
            let events = [];

            if (fs.existsSync(commandsPath)) {
                commands = fs.readdirSync(commandsPath)
                    .filter(file => file.endsWith('.js') && !file.includes('example'))
                    .sort();
            }

            if (fs.existsSync(eventsPath)) {
                events = fs.readdirSync(eventsPath)
                    .filter(file => file.endsWith('.js') && !file.includes('example'))
                    .sort();
            }

            return { commands, events };
        } catch (error) {
            logger(`Error getting available system files: ${error.message}`, "[EDITOR LOADER ERROR]");
            return { commands: [], events: [] };
        }
    }

    // Setup all user-specific routes
    setupRoutes() {
        // Override the existing user code files endpoint
        this.app.get('/api/user-code-files', (req, res) => {
            if (!req.session.userId || !req.session.userEmail) {
                return res.status(401).json({ status: "error", message: "Authentication required" });
            }

            try {
                const userEmail = req.session.userEmail;
                logger(`Fetching user code files for ${userEmail}`, "[EDITOR LOADER]");
                const { commands, events } = this.getUserFiles(userEmail);
                
                res.json({
                    status: 'success',
                    commands: commands,
                    events: events,
                    userEmail: userEmail
                });
            } catch (error) {
                logger(`Error fetching user code files: ${error.message}`, "[EDITOR LOADER ERROR]");
                res.json({
                    status: 'error',
                    message: error.message,
                    commands: [],
                    events: []
                });
            }
        });

        // Override the existing user file content endpoint
        this.app.get('/api/user-code-file/:type/:fileName', (req, res) => {
            if (!req.session.userId || !req.session.userEmail) {
                return res.status(401).json({ status: "error", message: "Authentication required" });
            }

            const { type, fileName } = req.params;

            if (!['command', 'event'].includes(type)) {
                return res.json({ status: "error", message: "Invalid file type" });
            }

            try {
                const userEmail = req.session.userEmail;
                
                // Verify the file belongs to this user
                const { commands, events } = this.getUserFiles(userEmail);
                const userFiles = type === 'command' ? commands : events;
                
                if (!userFiles.includes(fileName)) {
                    return res.json({ status: "error", message: "File not found or access denied" });
                }

                const content = this.getUserFileContent(userEmail, type, fileName);
                res.json({ 
                    status: 'success', 
                    content: content,
                    userEmail: userEmail,
                    fileOwner: userEmail
                });
            } catch (error) {
                logger(`Error reading user code file: ${error.message}`, "[EDITOR LOADER ERROR]");
                res.json({ status: 'error', message: error.message });
            }
        });

        // Override the existing save user file endpoint
        this.app.post('/api/save-user-code-file', (req, res) => {
            if (!req.session.userId || !req.session.userEmail) {
                return res.status(401).json({ status: "error", message: "Authentication required" });
            }

            const { type, fileName, content } = req.body;

            if (!['command', 'event'].includes(type)) {
                return res.json({ status: "error", message: "Invalid file type" });
            }

            try {
                const userEmail = req.session.userEmail;
                
                // Verify the file belongs to this user or allow creation of new files
                const { commands, events } = this.getUserFiles(userEmail);
                const userFiles = type === 'command' ? commands : events;
                
                // Allow saving if file exists for user or if it doesn't exist (new file)
                if (userFiles.includes(fileName) || !userFiles.includes(fileName)) {
                    const success = this.saveUserFileContent(userEmail, type, fileName, content);
                    
                    if (success) {
                        logger(`User ${userEmail} saved their own file: ${type}/${fileName}`, "[EDITOR LOADER]");
                        res.json({ 
                            status: 'success', 
                            message: 'File saved successfully',
                            userEmail: userEmail
                        });
                    } else {
                        res.json({ status: 'error', message: 'Failed to save file' });
                    }
                } else {
                    res.json({ status: 'error', message: 'Access denied - file does not belong to you' });
                }
            } catch (error) {
                logger(`Error saving user code file: ${error.message}`, "[EDITOR LOADER ERROR]");
                res.json({ status: 'error', message: error.message });
            }
        });

        // Override the existing reset user file endpoint
        this.app.post('/api/reset-user-code-file', (req, res) => {
            if (!req.session.userId) {
                return res.status(401).json({ status: "error", message: "Authentication required" });
            }

            const { type, fileName } = req.body;

            if (!['command', 'event'].includes(type)) {
                return res.json({ status: "error", message: "Invalid file type" });
            }

            try {
                const userEmail = req.session.userEmail;
                const content = this.resetUserFileToOriginal(userEmail, type, fileName);
                res.json({ status: 'success', content: content });
            } catch (error) {
                logger(`Error resetting user code file: ${error.message}`, "[EDITOR LOADER ERROR]");
                res.json({ status: 'error', message: error.message });
            }
        });

        // New endpoint to delete user files
        this.app.post('/api/delete-user-code-file', (req, res) => {
            if (!req.session.userId) {
                return res.status(401).json({ status: "error", message: "Authentication required" });
            }

            const { type, fileName } = req.body;

            if (!['command', 'event'].includes(type)) {
                return res.json({ status: "error", message: "Invalid file type" });
            }

            try {
                const userEmail = req.session.userEmail;
                const success = this.deleteUserFile(userEmail, type, fileName);
                
                if (success) {
                    res.json({ status: 'success', message: 'File deleted successfully' });
                } else {
                    res.json({ status: 'error', message: 'File not found' });
                }
            } catch (error) {
                logger(`Error deleting user code file: ${error.message}`, "[EDITOR LOADER ERROR]");
                res.json({ status: 'error', message: error.message });
            }
        });

        // New endpoint to upload/create new user files
        this.app.post('/api/upload-user-code-file', (req, res) => {
            if (!req.session.userId) {
                return res.status(401).json({ status: "error", message: "Authentication required" });
            }

            const { type, fileName, content } = req.body;

            if (!['command', 'event'].includes(type)) {
                return res.json({ status: "error", message: "Invalid file type" });
            }

            if (!fileName || !fileName.endsWith('.js')) {
                return res.json({ status: "error", message: "Invalid filename" });
            }

            try {
                const userEmail = req.session.userEmail;
                const { commands, events } = this.getUserFiles(userEmail);
                const existingFiles = type === 'command' ? commands : events;

                if (existingFiles.includes(fileName)) {
                    return res.json({ status: 'error', message: 'File already exists' });
                }

                const fileContent = content || this.getTemplateContent(type, fileName);
                const success = this.saveUserFileContent(userEmail, type, fileName, fileContent);

                if (success) {
                    res.json({ status: 'success', message: 'File created successfully' });
                } else {
                    res.json({ status: 'error', message: 'Failed to create file' });
                }
            } catch (error) {
                logger(`Error creating user code file: ${error.message}`, "[EDITOR LOADER ERROR]");
                res.json({ status: 'error', message: error.message });
            }
        });

        // New endpoint to import system files to user directory
        this.app.post('/api/import-system-file', (req, res) => {
            if (!req.session.userId) {
                return res.status(401).json({ status: "error", message: "Authentication required" });
            }

            const { type, fileName } = req.body;

            if (!['command', 'event'].includes(type)) {
                return res.json({ status: "error", message: "Invalid file type" });
            }

            try {
                const userEmail = req.session.userEmail;
                const success = this.importSystemFile(userEmail, type, fileName);

                if (success) {
                    res.json({ status: 'success', message: 'File imported successfully' });
                } else {
                    res.json({ status: 'error', message: 'System file not found' });
                }
            } catch (error) {
                logger(`Error importing system file: ${error.message}`, "[EDITOR LOADER ERROR]");
                res.json({ status: 'error', message: error.message });
            }
        });

        // New endpoint to get available system files for import
        this.app.get('/api/available-system-files', (req, res) => {
            if (!req.session.userId) {
                return res.status(401).json({ status: "error", message: "Authentication required" });
            }

            try {
                const { commands, events } = this.getAvailableSystemFiles();
                res.json({
                    status: 'success',
                    commands: commands,
                    events: events
                });
            } catch (error) {
                logger(`Error fetching available system files: ${error.message}`, "[EDITOR LOADER ERROR]");
                res.json({
                    status: 'error',
                    message: error.message,
                    commands: [],
                    events: []
                });
            }
        });

        logger("User-specific file management routes loaded successfully", "[EDITOR LOADER]");
    }
}

// Export the module for use in index.js
module.exports = (app) => {
    return new EditorLoader(app);
};
