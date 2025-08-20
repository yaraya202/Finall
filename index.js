const { spawn } = require("child_process");
const axios = require("axios");
const logger = require("./utils/log");
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const bcrypt = require('bcrypt');
const session = require('express-session');
const crypto = require('crypto'); // Import crypto module for key generation

const app = express();
const port = process.env.PORT || 35000; // Use hosting port or default to 5000

// Increase payload limits for better scalability
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: 'amir-bot-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
}));

// Authentication helper functions
const getUsersDB = () => {
    try {
        return JSON.parse(fs.readFileSync('./users.json', 'utf8'));
    } catch {
        return [];
    }
};

const saveUsersDB = (users) => {
    fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));
};

const getUserBotsDB = () => {
    try {
        return JSON.parse(fs.readFileSync('./user_bots.json', 'utf8'));
    } catch {
        return {};
    }
};

const saveUserBotsDB = (userBots) => {
    fs.writeFileSync('./user_bots.json', JSON.stringify(userBots, null, 2));
};

// Update bot ownership tracking
const trackBotOwnership = (userId, botId, botConfig) => {
    const userBots = getUserBotsDB();
    if (!userBots[userId]) {
        userBots[userId] = {};
    }
    userBots[userId][botId] = {
        createdAt: new Date().toISOString(),
        config: botConfig,
        lastActive: new Date().toISOString(),
        autoRestart: true // Enable auto-restart by default
    };
    saveUserBotsDB(userBots);
};

const removeBotOwnership = (userId, botId) => {
    const userBots = getUserBotsDB();
    if (userBots[userId] && userBots[userId][botId]) {
        delete userBots[userId][botId];
        saveUserBotsDB(userBots);
    }
};

// Store active bot processes with better memory management
global.activeBots = new Map();

// Bot auto-restart functionality
const shouldAutoRestart = (botId, userId) => {
    const userBots = getUserBotsDB();
    // Check if autoRestart is explicitly true or not set to false
    return userBots[userId] && userBots[userId][botId] && userBots[userId][botId].autoRestart !== false;
};

const autoRestartBot = async (botId, userId, config, delay = 3000) => {
    logger(`Auto-restarting bot ${botId} after ${delay}ms delay`, "[ BOT AUTO-RESTART ]");

    setTimeout(async () => {
        try {
            if (global.activeBots.has(botId)) {
                logger(`Bot ${botId} already running, skipping auto-restart`, "[ BOT AUTO-RESTART ]");
                return;
            }

            const configPath = path.resolve(`temp_config_${botId}.json`);
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            logger(`Auto-restarting bot ${botId} with config: ${configPath}`, "[ BOT AUTO-RESTART ]");

            const botDir = path.join(__dirname, 'bots', userId, botId);
            fs.mkdirSync(botDir, { recursive: true });

            const child = spawn("node", ["--max-old-space-size=512", "--trace-warnings", "--async-stack-traces", "Priyansh.js"], {
                cwd: __dirname,
                stdio: ["pipe", "pipe", "pipe"],
                shell: true,
                detached: true,
                env: {
                    ...process.env,
                    BOT_CONFIG: configPath,
                    BOT_ID: botId,
                    USER_ID: userId,
                    NODE_ENV: 'production'
                }
            });

            if (child.pid) {
                try {
                    process.setpgid(child.pid, child.pid);
                } catch (e) {
                    logger(`Warning: Could not set process group for auto-restarted bot ${botId}: ${e.message}`, "[ BOT WARNING ]");
                }
            }

            global.activeBots.set(botId, {
                process: child,
                startTime: new Date(),
                configPath,
                userId: userId,
                config: config
            });

            // Update last active time
            const userBots = getUserBotsDB();
            if (userBots[userId] && userBots[userId][botId]) {
                userBots[userId][botId].lastActive = new Date().toISOString();
                saveUserBotsDB(userBots);
            }

            child.stdout.on('data', (data) => {
                logger(`[BOT ${botId} OUTPUT]: ${data.toString()}`, "[INFO]");
            });

            child.stderr.on('data', (data) => {
                logger(`[BOT ${botId} ERROR]: ${data.toString()}`, "[ERROR]");
            });

            child.on("close", (codeExit) => {
                logger(`Auto-restarted Bot ${botId} closed with exit code: ${codeExit}`, "[ BOT AUTO-RESTART ]");
                global.activeBots.delete(botId);

                try {
                    if (fs.existsSync(configPath)) {
                        fs.unlinkSync(configPath);
                    }
                } catch (cleanupError) {
                    logger(`Error cleaning up config file: ${cleanupError.message}`, "[ CLEANUP ERROR ]");
                }

                // Auto-restart again if needed (and not manually stopped)
                if (shouldAutoRestart(botId, userId) && codeExit !== 0) {
                    autoRestartBot(botId, userId, config, 5000); // 5 second delay for next restart
                }
            });

            child.on("error", (error) => {
                logger(`Auto-restarted Bot ${botId} process error: ${error.message}`, "[ BOT AUTO-RESTART ERROR ]");
                global.activeBots.delete(botId);

                try {
                    if (fs.existsSync(configPath)) {
                        fs.unlinkSync(configPath);
                    }
                } catch (cleanupError) {
                    logger(`Error cleaning up config file: ${cleanupError.message}`, "[ CLEANUP ERROR ]");
                }

                // Auto-restart again if needed
                if (shouldAutoRestart(botId, userId)) {
                    autoRestartBot(botId, userId, config, 10000); // 10 second delay for error restart
                }
            });

            logger(`Bot ${botId} auto-restarted successfully with PID ${child.pid}`, "[ BOT AUTO-RESTART ]");

        } catch (error) {
            logger(`Error auto-restarting bot ${botId}: ${error.message}`, "[ BOT AUTO-RESTART ERROR ]");

            // Try again after longer delay
            if (shouldAutoRestart(botId, userId)) {
                autoRestartBot(botId, userId, config, 15000);
            }
        }
    }, delay);
};

// Auto-start previously running bots on server startup
const autoStartPreviouslyRunningBots = async () => {
    try {
        logger("Checking for previously running bots to auto-start...", "[ BOT AUTO-START ]");
        const userBots = getUserBotsDB();

        for (const [userId, bots] of Object.entries(userBots)) {
            for (const [botId, botData] of Object.entries(bots)) {
                // Check if bot was running (has recent lastActive time) and not manually stopped
                if (botData.lastActive && botData.autoRestart !== false && botData.manuallyStopped !== true) {
                    const lastActiveTime = new Date(botData.lastActive);
                    const now = new Date();
                    const timeDiff = now - lastActiveTime;

                    // If bot was active within last 30 minutes, auto-start it
                    if (timeDiff < 30 * 60 * 1000) {
                        logger(`Auto-starting previously running bot ${botId} for user ${userId}`, "[ BOT AUTO-START ]");
                        setTimeout(() => {
                            autoRestartBot(botId, userId, botData.config, 2000);
                        }, Math.random() * 5000); // Random delay to avoid overwhelming
                    }
                }
            }
        }
    } catch (error) {
        logger(`Error in auto-start process: ${error.message}`, "[ BOT AUTO-START ERROR ]");
    }
};

// Call auto-start function after server starts
setTimeout(autoStartPreviouslyRunningBots, 10000); // Wait 10 seconds after server start

// Add request logging middleware with rate limiting
const requestCounts = new Map();
app.use((req, res, next) => {
    const ip = req.ip;
    const now = Date.now();

    // Clean old entries
    for (const [key, data] of requestCounts.entries()) {
        if (now - data.lastRequest > 60000) { // Clean entries older than 1 minute
            requestCounts.delete(key);
        }
    }

    // Track requests
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, { count: 1, lastRequest: now });
    } else {
        const data = requestCounts.get(ip);
        data.count++;
        data.lastRequest = now;
    }

    // Only log if reasonable frequency (not spam)
    const data = requestCounts.get(ip);
    if (data.count <= 20 || data.count % 50 === 0) {
        logger(`${req.method} ${req.url} from ${req.ip}`, "[ REQUEST ]");
    }

    next();
});

// Set higher limits for concurrent connections
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// Serve the login page for the root route
app.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'), (err) => {
        if (err) {
            logger(`Error serving login.html: ${err.message}`, "[ERROR]");
            res.status(500).send('Unable to load the login page. Check server logs.');
        }
    });
});

// Serve the login page explicitly
app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'), (err) => {
        if (err) {
            logger(`Error serving login.html: ${err.message}`, "[ERROR]");
            res.status(500).send('Unable to load the login page. Check server logs.');
        }
    });
});

// Serve the dashboard for authenticated users
app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'), (err) => {
        if (err) {
            logger(`Error serving dashboard.html: ${err.message}`, "[ERROR]");
            res.status(500).send('Unable to load the dashboard. Check server logs.');
        }
    });
});

// Add a route for bot manager (with authentication required)
app.get('/bot-manager', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) {
            logger(`Error serving bot manager: ${err.message}`, "[ERROR]");
            res.status(500).send('Unable to load the bot manager. Check server logs.');
        }
    });
});

// Premium access helper functions for new system
const getPremiumKeysDB = () => {
    try {
        return JSON.parse(fs.readFileSync('./premium_access.json', 'utf8'));
    } catch {
        return { approved_keys: {}, pending_keys: {} };
    }
};

const savePremiumKeysDB = (data) => {
    fs.writeFileSync('./premium_access.json', JSON.stringify(data, null, 2));
};

// Function to generate a persistent unique key per user
function generatePersistentKey(userEmail) {
    // Create a consistent key based on user email
    const hash = crypto.createHash('sha256').update(userEmail + 'AMIR_BOT_PREMIUM_2024').digest('hex');
    return 'KEY-' + hash.substring(0, 12).toUpperCase();
}

// API endpoint to check if a premium key is approved
app.post('/api/check-premium-key', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { key } = req.body;
    const userEmail = req.session.userEmail;

    if (!key) {
        return res.json({ status: "error", message: "Key is required" });
    }

    try {
        const premiumData = getPremiumKeysDB();

        // Check if this key is approved for this user
        if (premiumData.approved_keys[key] && premiumData.approved_keys[key].userEmail === userEmail) {
            return res.json({ status: "approved", message: "Premium access granted" });
        } else {
            return res.json({ status: "pending", message: "Key not approved yet" });
        }
    } catch (error) {
        logger(`Error checking premium key: ${error.message}`, "[ERROR]");
        res.json({ status: "error", message: "Error checking premium key" });
    }
});

// Simple key approval endpoint (key only, no email required)
app.post('/api/approve-key', (req, res) => {
    const { key } = req.body;

    if (!key) {
        return res.json({ status: "error", message: "Key is required" });
    }

    try {
        const premiumData = getPremiumKeysDB();

        // Check if key already exists
        if (premiumData.approved_keys[key]) {
            return res.json({ status: "info", message: "Key is already approved" });
        }

        // Find the user email associated with this key
        // Since keys are generated based on email, we need to check all users
        const users = getUsersDB();
        let keyOwnerEmail = null;

        for (const user of users) {
            const expectedKey = generatePersistentKey(user.email);
            if (expectedKey === key) {
                keyOwnerEmail = user.email;
                break;
            }
        }

        if (!keyOwnerEmail) {
            return res.json({ status: "error", message: "Invalid key or user not found" });
        }

        // Add to approved keys
        premiumData.approved_keys[key] = {
            userEmail: keyOwnerEmail,
            approvedBy: "admin",
            approvedAt: new Date().toISOString()
        };

        savePremiumKeysDB(premiumData);

        logger(`Premium key ${key} approved for user ${keyOwnerEmail}`, "[PREMIUM APPROVAL]");

        res.json({
            status: "success",
            message: `Premium access approved for ${keyOwnerEmail}`,
            userEmail: keyOwnerEmail
        });
    } catch (error) {
        logger(`Error approving premium key: ${error.message}`, "[ERROR]");
        res.json({ status: "error", message: "Error approving premium key" });
    }
});

// API endpoint for admin to approve premium keys (legacy endpoint)
app.post('/api/admin/approve-premium-key', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { key, userEmail } = req.body;
    const adminEmail = req.session.userEmail;

    // Check if admin (you can add more admin emails here if needed)
    if (adminEmail !== 'mahiamir452@gmail.com') {
        return res.json({ status: "error", message: "Only admin can approve premium keys" });
    }

    if (!key || !userEmail) {
        return res.json({ status: "error", message: "Key and user email are required" });
    }

    try {
        const premiumData = getPremiumKeysDB();

        // Add to approved keys
        premiumData.approved_keys[key] = {
            userEmail: userEmail,
            approvedBy: adminEmail,
            approvedAt: new Date().toISOString()
        };

        // Remove from pending if exists
        if (premiumData.pending_keys[key]) {
            delete premiumData.pending_keys[key];
        }

        savePremiumKeysDB(premiumData);

        logger(`Premium key ${key} approved for user ${userEmail} by admin ${adminEmail}`, "[PREMIUM APPROVAL]");

        res.json({
            status: "success",
            message: `Premium access approved for ${userEmail}`
        });
    } catch (error) {
        logger(`Error approving premium key: ${error.message}`, "[ERROR]");
        res.json({ status: "error", message: "Error approving premium key" });
    }
});

// Authentication Routes
app.post('/signup', async (req, res) => {
    const { email, password, confirmPassword } = req.body;

    if (!email || !password || !confirmPassword) {
        return res.json({ status: "error", message: "All fields are required" });
    }

    if (password !== confirmPassword) {
        return res.json({ status: "error", message: "Passwords do not match" });
    }

    if (password.length < 8) {
        return res.json({ status: "error", message: "Password must be at least 8 characters long" });
    }

    const users = getUsersDB();

    if (users.find(user => user.email === email)) {
        return res.json({ status: "error", message: "Email already exists" });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: Date.now().toString(),
            email,
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        saveUsersDB(users);

        req.session.userId = newUser.id;
        req.session.userEmail = newUser.email;

        logger(`New user registered: ${email}`, "[AUTH]");
        res.json({ status: "success", message: "Account created successfully" });
    } catch (error) {
        logger(`Signup error: ${error.message}`, "[ERROR]");
        res.json({ status: "error", message: "Error creating account" });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.json({ status: "error", message: "Email and password are required" });
    }

    const users = getUsersDB();
    const user = users.find(u => u.email === email);

    if (!user) {
        return res.json({ status: "error", message: "Invalid email or password" });
    }

    try {
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.json({ status: "error", message: "Invalid email or password" });
        }

        req.session.userId = user.id;
        req.session.userEmail = user.email;

        logger(`User logged in: ${email}`, "[AUTH]");
        res.json({ status: "success", message: "Login successful" });
    } catch (error) {
        logger(`Login error: ${error.message}`, "[ERROR]");
        res.json({ status: "error", message: "Login error" });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.json({ status: "error", message: "Logout failed" });
        }
        res.json({ status: "success", message: "Logged out successfully" });
    });
});

app.get('/api/user-info', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Not authenticated" });
    }

    res.json({
        status: "success",
        user: {
            id: req.session.userId,
            email: req.session.userEmail
        }
    });
});

app.post('/start-bot', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { appstate, adminUid, prefix, commands, events, botId } = req.body;
    const userId = req.session.userId;
    const userEmail = req.session.userEmail;

    if (!botId) {
        return res.json({ status: "error", message: "Bot ID is required" });
    }

    // Check if bot ID already exists for any user
    const userBots = getUserBotsDB();
    for (const [ownerId, bots] of Object.entries(userBots)) {
        if (bots[botId] && ownerId !== userId) {
            return res.json({ status: "error", message: "Bot ID already taken by another user" });
        }
    }

    if (global.activeBots.has(botId)) {
        return res.json({ status: "error", message: "Bot is already running" });
    }

    // Check if this is a restart of an existing bot (user owns it but it's stopped)
    const isExistingBot = userBots[userId] && userBots[userId][botId];
    let config;

    if (isExistingBot) {
        // Use existing bot configuration for restart
        config = userBots[userId][botId].config;
        logger(`Restarting existing bot ${botId} for user ${userId}`, "[ BOT RESTART ]");
    } else {
        // New bot creation
        const baseConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        config = {
            ...baseConfig,
            appstate: appstate || baseConfig.appstate,
            ADMINBOT: adminUid ? [adminUid] : baseConfig.ADMINBOT,
            PREFIX: prefix || baseConfig.PREFIX,
            commands: commands || null,
            events: events || null,
            botId: botId
        };
    }

    try {

        const configPath = path.resolve(`temp_config_${botId}.json`);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        logger(`Starting bot ${botId} with config: ${configPath}`, "[ BOT START ]");

        const botDir = path.join(__dirname, 'bots', userId, botId);
        fs.mkdirSync(botDir, { recursive: true });

        // Copy commands and events to bot directory
        const botCommandsDir = path.join(botDir, 'commands');
        const botEventsDir = path.join(botDir, 'events');

        fs.mkdirSync(botCommandsDir, { recursive: true });
        fs.mkdirSync(botEventsDir, { recursive: true });

        // Copy selected commands (check user-specific versions first)
        if (commands && Array.isArray(commands)) {
            commands.forEach(cmd => {
                const cmdFileName = cmd.endsWith('.js') ? cmd : `${cmd}.js`;
                const userSpecificPath = path.join(__dirname, 'user_code', userEmail, 'commands', cmdFileName);
                const originalPath = path.join(__dirname, 'Priyansh/commands', cmdFileName);
                const destPath = path.join(botCommandsDir, cmdFileName);

                let srcPath = originalPath;
                if (fs.existsSync(userSpecificPath)) {
                    srcPath = userSpecificPath;
                    logger(`Using user-edited command: ${cmdFileName} for bot ${botId}`, "[ BOT SETUP ]");
                }

                if (fs.existsSync(srcPath)) {
                    fs.copyFileSync(srcPath, destPath);
                } else {
                    logger(`Command file not found: ${cmdFileName}`, "[ BOT SETUP WARNING ]");
                }
            });
        }

        // Copy selected events (check user-specific versions first)
        if (events && Array.isArray(events)) {
            events.forEach(evt => {
                const evtFileName = evt.endsWith('.js') ? evt : `${evt}.js`;
                const userSpecificPath = path.join(__dirname, 'user_code', userEmail, 'events', evtFileName);
                const originalPath = path.join(__dirname, 'Priyansh/events', evtFileName);
                const destPath = path.join(botEventsDir, evtFileName);

                let srcPath = originalPath;
                if (fs.existsSync(userSpecificPath)) {
                    srcPath = userSpecificPath;
                    logger(`Using user-edited event: ${evtFileName} for bot ${botId}`, "[ BOT SETUP ]");
                }

                if (fs.existsSync(srcPath)) {
                    fs.copyFileSync(srcPath, destPath);
                } else {
                    logger(`Event file not found: ${evtFileName}`, "[ BOT SETUP WARNING ]");
                }
            });
        }

        const child = spawn("node", ["--max-old-space-size=512", "--trace-warnings", "--async-stack-traces", "Priyansh.js"], {
            cwd: __dirname,
            stdio: ["pipe", "pipe", "pipe"],
            shell: true,
            detached: true, // Enable process group creation
            env: {
                ...process.env,
                BOT_CONFIG: configPath,
                BOT_ID: botId,
                USER_ID: userId,
                NODE_ENV: 'production'
            }
        });

        // Create a new process group so we can kill all child processes
        if (child.pid) {
            try {
                process.setpgid(child.pid, child.pid);
            } catch (e) {
                logger(`Warning: Could not set process group for bot ${botId}: ${e.message}`, "[ BOT WARNING ]");
            }
        }

        global.activeBots.set(botId, {
            process: child,
            startTime: new Date(),
            configPath,
            userId: userId,
            config: config
        });

        // Track bot ownership and enable auto-restart
        trackBotOwnership(userId, botId, config);

        // Re-enable auto-restart and clear manually stopped flag for manual start
        const userBots = getUserBotsDB();
        if (userBots[userId] && userBots[userId][botId]) {
            userBots[userId][botId].autoRestart = true;
            userBots[userId][botId].manuallyStopped = false; // Clear the flag
            saveUserBotsDB(userBots);
        }

        let responseSet = false;

        const timeout = setTimeout(() => {
            if (!responseSet) {
                responseSet = true;
                res.json({ status: "success", message: "Bot starting..." });
            }
        }, 5000); // Increased timeout to 5 seconds

        child.stdout.on('data', (data) => {
            logger(`[BOT ${botId} OUTPUT]: ${data.toString()}`, "[INFO]");
        });

        child.stderr.on('data', (data) => {
            logger(`[BOT ${botId} ERROR]: ${data.toString()}`, "[ERROR]");
        });

        child.on("close", (codeExit) => {
            clearTimeout(timeout);
            logger(`Bot ${botId} closed with exit code: ${codeExit}`, "[ BOT CLOSE ]");
            global.activeBots.delete(botId);

            try {
                if (fs.existsSync(configPath)) {
                    fs.unlinkSync(configPath);
                }
            } catch (cleanupError) {
                logger(`Error cleaning up config file: ${cleanupError.message}`, "[ CLEANUP ERROR ]");
            }

            // Auto-restart if bot crashed (non-zero exit code) and auto-restart is enabled
            if (codeExit !== 0 && shouldAutoRestart(botId, userId)) {
                logger(`Bot ${botId} crashed with exit code ${codeExit}, scheduling auto-restart`, "[ BOT CRASH ]");
                autoRestartBot(botId, userId, config, 3000);
            }

            if (!responseSet) {
                responseSet = true;
                if (codeExit === 0) {
                    res.json({ status: "success", message: "Bot started successfully" });
                } else {
                    res.json({ status: "error", message: `Bot exited with code ${codeExit}. Auto-restart initiated.` });
                }
            }
        });

        child.on("error", (error) => {
            clearTimeout(timeout);
            logger(`Bot ${botId} process error: ${error.message}`, "[ BOT ERROR ]");
            global.activeBots.delete(botId);

            try {
                if (fs.existsSync(configPath)) {
                    fs.unlinkSync(configPath);
                }
            } catch (cleanupError) {
                logger(`Error cleaning up config file: ${cleanupError.message}`, "[ CLEANUP ERROR ]");
            }

            // Auto-restart on process error if auto-restart is enabled
            if (shouldAutoRestart(botId, userId)) {
                logger(`Bot ${botId} had process error, scheduling auto-restart`, "[ BOT ERROR ]");
                autoRestartBot(botId, userId, config, 5000);
            }

            if (!responseSet) {
                responseSet = true;
                res.json({ status: "error", message: `Process error: ${error.message}. Auto-restart initiated.` });
            }
        });

        if (!responseSet) {
            responseSet = true;
            res.json({ status: "success", message: "Bot starting..." });
        }

    } catch (error) {
        logger(`Error starting bot ${botId}: ${error.message}`, "[ ERROR ]");
        res.json({ status: "error", message: `Failed to start bot: ${error.message}` });
    }
});

app.post('/stop-bot', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { botId } = req.body;
    const userId = req.session.userId;
    const bot = global.activeBots.get(botId);

    // Check if user owns this bot
    const userBots = getUserBotsDB();
    if (!userBots[userId] || !userBots[userId][botId]) {
        return res.json({ status: "error", message: "You don't have permission to stop this bot" });
    }

    // Disable auto-restart and mark as manually stopped for manual stop
    if (userBots[userId][botId]) {
        userBots[userId][botId].autoRestart = false;
        userBots[userId][botId].manuallyStopped = true; // Mark as manually stopped
        saveUserBotsDB(userBots);
    }

    if (bot && bot.process) {
        try {
            // Force kill the process and all its children
            if (bot.process.pid) {
                try {
                    // Kill the entire process group
                    process.kill(-bot.process.pid, 'SIGKILL');
                } catch (killError) {
                    // Fallback to killing just the main process
                    bot.process.kill('SIGKILL');
                }
            }

            // Wait a moment then force cleanup
            setTimeout(() => {
                if (bot.process && !bot.process.killed) {
                    try {
                        bot.process.kill('SIGKILL');
                    } catch (e) {
                        logger(`Additional cleanup attempt: ${e.message}`, "[ BOT CLEANUP ]");
                    }
                }
            }, 1000);

            global.activeBots.delete(botId);

            if (bot.configPath && fs.existsSync(bot.configPath)) {
                fs.unlinkSync(bot.configPath);
            }

            logger(`Bot ${botId} manually stopped by user ${userId} with PID ${bot.process.pid}`, "[ BOT STOP ]");
            res.json({ status: "success", message: "Bot stopped successfully" });
        } catch (error) {
            logger(`Error stopping bot ${botId}: ${error.message}`, "[ ERROR ]");
            res.json({ status: "error", message: `Error stopping bot: ${error.message}` });
        }
    } else {
        res.json({ status: "error", message: "Bot not found or already stopped" });
    }
});

app.post('/delete-bot', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { botId } = req.body;
    const userId = req.session.userId;

    // Check if user owns this bot
    const userBots = getUserBotsDB();
    if (!userBots[userId] || !userBots[userId][botId]) {
        return res.json({ status: "error", message: "You don't have permission to delete this bot" });
    }

    try {
        // Stop the bot if it's running
        const bot = global.activeBots.get(botId);
        if (bot && bot.process) {
            // Force kill the process and all its children
            if (bot.process.pid) {
                try {
                    // Kill the entire process group
                    process.kill(-bot.process.pid, 'SIGKILL');
                } catch (killError) {
                    // Fallback to killing just the main process
                    bot.process.kill('SIGKILL');
                }
            }

            // Wait a moment then force cleanup
            setTimeout(() => {
                if (bot.process && !bot.process.killed) {
                    try {
                        bot.process.kill('SIGKILL');
                    } catch (e) {
                        logger(`Additional cleanup attempt during delete: ${e.message}`, "[ BOT CLEANUP ]");
                    }
                }
            }, 1000);

            global.activeBots.delete(botId);

            if (bot.configPath && fs.existsSync(bot.configPath)) {
                fs.unlinkSync(bot.configPath);
            }

            logger(`Bot ${botId} process terminated with PID ${bot.process.pid} during deletion`, "[ BOT DELETE ]");
        }

        // Remove from ownership tracking
        removeBotOwnership(userId, botId);

        logger(`Bot ${botId} deleted by user ${userId}`, "[ BOT DELETE ]");
        res.json({ status: "success", message: "Bot deleted successfully" });
    } catch (error) {
        logger(`Error deleting bot ${botId}: ${error.message}`, "[ ERROR ]");
        res.json({ status: "error", message: `Error deleting bot: ${error.message}` });
    }
});

app.post('/restart-bot', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { botId } = req.body;
    const userId = req.session.userId;

    // Check if user owns this bot
    const userBots = getUserBotsDB();
    if (!userBots[userId] || !userBots[userId][botId]) {
        return res.json({ status: "error", message: "You don't have permission to restart this bot" });
    }

    try {
        const bot = global.activeBots.get(botId);

        if (!bot || !bot.process) {
            return res.json({ status: "error", message: "Bot is not currently running. Please start it manually." });
        }

        const savedConfig = bot.config;

        // First, stop the current bot process
        if (bot.process.pid) {
            try {
                // Kill the entire process group
                process.kill(-bot.process.pid, 'SIGKILL');
            } catch (killError) {
                // Fallback to killing just the main process
                bot.process.kill('SIGKILL');
            }
        }

        // Clean up old resources
        global.activeBots.delete(botId);
        if (bot.configPath && fs.existsSync(bot.configPath)) {
            fs.unlinkSync(bot.configPath);
        }

        logger(`Bot ${botId} stopped for restart`, "[ BOT RESTART ]");

        // Re-enable auto-restart and clear manually stopped flag for manual restart
        const userBots = getUserBotsDB();
        if (userBots[userId] && userBots[userId][botId]) {
            userBots[userId][botId].autoRestart = true;
            userBots[userId][botId].manuallyStopped = false; // Clear the flag
            saveUserBotsDB(userBots);
        }

        // Wait a moment before restarting
        setTimeout(() => {
            try {
                // Create new config file
                const newConfigPath = path.resolve(`temp_config_${botId}.json`);
                fs.writeFileSync(newConfigPath, JSON.stringify(savedConfig, null, 2));

                // Spawn new process
                const newChild = spawn("node", ["--max-old-space-size=512", "--trace-warnings", "--async-stack-traces", "Priyansh.js"], {
                    cwd: __dirname,
                    stdio: ["pipe", "pipe", "pipe"],
                    shell: true,
                    detached: true,
                    env: {
                        ...process.env,
                        BOT_CONFIG: newConfigPath,
                        BOT_ID: botId,
                        NODE_ENV: 'production'
                    }
                });

                // Create process group
                if (newChild.pid) {
                    try {
                        process.setpgid(newChild.pid, newChild.pid);
                    } catch (e) {
                        logger(`Warning: Could not set process group for restarted bot ${botId}: ${e.message}`, "[ BOT WARNING ]");
                    }
                }

                global.activeBots.set(botId, {
                    process: newChild,
                    startTime: new Date(),
                    configPath: newConfigPath,
                    userId: userId,
                    config: savedConfig
                });

                newChild.stdout.on('data', (data) => {
                    logger(`[BOT ${botId} OUTPUT]: ${data.toString()}`, "[INFO]");
                });

                newChild.stderr.on('data', (data) => {
                    logger(`[BOT ${botId} ERROR]: ${data.toString()}`, "[ERROR]");
                });

                newChild.on("close", (codeExit) => {
                    logger(`Restarted Bot ${botId} closed with exit code: ${codeExit}`, "[ BOT CLOSE ]");
                    global.activeBots.delete(botId);

                    try {
                        if (fs.existsSync(newConfigPath)) {
                            fs.unlinkSync(newConfigPath);
                        }
                    } catch (cleanupError) {
                        logger(`Error cleaning up config file: ${cleanupError.message}`, "[ CLEANUP ERROR ]");
                    }
                });

                newChild.on("error", (error) => {
                    logger(`Restarted Bot ${botId} process error: ${error.message}`, "[ BOT ERROR ]");
                    global.activeBots.delete(botId);

                    try {
                        if (fs.existsSync(newConfigPath)) {
                            fs.unlinkSync(newConfigPath);
                        }
                    } catch (cleanupError) {
                        logger(`Error cleaning up config file: ${cleanupError.message}`, "[ CLEANUP ERROR ]");
                    }
                });

                logger(`Bot ${botId} restarted successfully with new PID ${newChild.pid}`, "[ BOT RESTART ]");

            } catch (restartError) {
                logger(`Error restarting bot ${botId}: ${restartError.message}`, "[ ERROR ]");
            }
        }, 2000); // Wait 2 seconds before restarting

        res.json({ status: "success", message: "Bot is being restarted..." });

    } catch (error) {
        logger(`Error restarting bot ${botId}: ${error.message}`, "[ ERROR ]");
        res.json({ status: "error", message: `Error restarting bot: ${error.message}` });
    }
});

app.get('/api/available-items', (req, res) => {
    try {
        const commandsPath = path.join(__dirname, 'Priyansh/commands');
        const eventsPath = path.join(__dirname, 'Priyansh/events');

        let commands = [];
        let events = [];

        // Check if directories exist before reading them
        if (fs.existsSync(commandsPath)) {
            commands = fs.readdirSync(commandsPath)
                .filter(file => file.endsWith('.js') && !file.includes('example'))
                .map(file => file.replace('.js', ''))
                .sort();
        }

        if (fs.existsSync(eventsPath)) {
            events = fs.readdirSync(eventsPath)
                .filter(file => file.endsWith('.js') && !file.includes('example'))
                .map(file => file.replace('.js', ''))
                .sort();
        }

        res.setHeader('Content-Type', 'application/json');
        res.json({
            status: 'success',
            commands: commands,
            events: events
        });
    } catch (error) {
        logger(`Error fetching available items: ${error.message}`, "[ ERROR ]");
        res.setHeader('Content-Type', 'application/json');
        res.json({
            status: 'error',
            message: error.message,
            commands: [],
            events: []
        });
    }
});

app.get('/admin/all-bots', (req, res) => {
    const status = {};

    for (const [botId, bot] of global.activeBots) {
        const uptime = bot.startTime ? Math.floor((new Date() - bot.startTime) / 1000) : 0;
        status[botId] = {
            running: bot.process && !bot.process.killed,
            uptime: `${uptime}s`,
            pid: bot.process ? bot.process.pid : null,
            startTime: bot.startTime,
            userId: bot.userId,
            config: {
                prefix: bot.config?.PREFIX,
                adminUid: bot.config?.ADMINBOT,
                commands: bot.config?.commands,
                events: bot.config?.events
            }
        };
    }

    res.json({ totalBots: global.activeBots.size, bots: status });
});

app.get('/admin/download-appstate/:botId', (req, res) => {
    const { botId } = req.params;
    const bot = global.activeBots.get(botId);

    if (!bot || !bot.config) {
        return res.status(404).json({ error: 'Bot not found or no config available' });
    }

    try {
        let appstateData = typeof bot.config.appstate === 'string' ? bot.config.appstate : JSON.stringify(bot.config.appstate, null, 2);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="appstate_${botId}.json"`);

        res.send(appstateData);

        logger(`Admin downloaded appstate for bot ${botId}`, "[ ADMIN DOWNLOAD ]");

    } catch (error) {
        logger(`Error downloading appstate for bot ${botId}: ${error.message}`, "[ ERROR ]");
        res.status(500).json({ error: 'Failed to process appstate data' });
    }
});

app.get('/bot-status', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const userId = req.session.userId;
    const userBots = getUserBotsDB();
    const userOwnedBots = userBots[userId] || {};

    const status = {};
    let activeCount = 0;

    // Check all user's bots (both active and inactive)
    for (const [botId, botData] of Object.entries(userOwnedBots)) {
        const activeBotInfo = global.activeBots.get(botId);

        if (activeBotInfo && activeBotInfo.process && !activeBotInfo.process.killed) {
            // Bot is currently running
            const uptime = activeBotInfo.startTime ? Math.floor((new Date() - activeBotInfo.startTime) / 1000) : 0;
            status[botId] = {
                running: true,
                uptime: `${uptime}s`,
                pid: activeBotInfo.process.pid,
                startTime: activeBotInfo.startTime,
                config: botData.config,
                createdAt: botData.createdAt,
                lastActive: activeBotInfo.startTime,
                manuallyStopped: botData.manuallyStopped || false
            };
            activeCount++;
        } else {
            // Bot exists but is not running
            status[botId] = {
                running: false,
                uptime: '0s',
                pid: null,
                startTime: null,
                config: botData.config,
                createdAt: botData.createdAt,
                lastActive: botData.lastActive,
                manuallyStopped: botData.manuallyStopped || false
            };
        }
    }

    res.json({
        totalBots: Object.keys(userOwnedBots).length,
        activeBotsCount: activeCount,
        bots: status
    });
});

app.get('/api/bot-details/:botId', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { botId } = req.params;
    const userId = req.session.userId;
    const userBots = getUserBotsDB();

    // Check if user owns this bot
    if (!userBots[userId] || !userBots[userId][botId]) {
        return res.json({ status: "error", message: "Bot not found or you don't have permission to view it" });
    }

    const botData = userBots[userId][botId];
    const activeBotInfo = global.activeBots.get(botId);
    const isRunning = activeBotInfo && activeBotInfo.process && !activeBotInfo.process.killed;

    const details = {
        botId: botId,
        running: isRunning,
        config: botData.config,
        createdAt: botData.createdAt,
        lastActive: isRunning ? activeBotInfo.startTime : botData.lastActive,
        uptime: isRunning ? Math.floor((new Date() - activeBotInfo.startTime) / 1000) : 0,
        pid: isRunning ? activeBotInfo.process.pid : null,
        startTime: isRunning ? activeBotInfo.startTime : null,
        totalCommands: botData.config.commands ? botData.config.commands.length : 0,
        totalEvents: botData.config.events ? botData.config.events.length : 0,
        autoRestart: botData.autoRestart !== false,
        manuallyStopped: botData.manuallyStopped || false
    };

    res.json({ status: "success", bot: details });
});

app.post('/api/toggle-auto-restart', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { botId, autoRestart } = req.body;
    const userId = req.session.userId;
    const userBots = getUserBotsDB();

    // Check if user owns this bot
    if (!userBots[userId] || !userBots[userId][botId]) {
        return res.json({ status: "error", message: "You don't have permission to modify this bot" });
    }

    userBots[userId][botId].autoRestart = autoRestart;
    // If autoRestart is disabled, also mark it as manually stopped to prevent accidental restarts
    if (!autoRestart) {
        userBots[userId][botId].manuallyStopped = true;
    } else {
        // If autoRestart is enabled, and it was manually stopped, clear the manual stop flag
        userBots[userId][botId].manuallyStopped = false;
    }
    saveUserBotsDB(userBots);

    logger(`User ${userId} ${autoRestart ? 'enabled' : 'disabled'} auto-restart for bot ${botId}`, "[ AUTO-RESTART TOGGLE ]");
    res.json({ status: "success", message: `Auto-restart ${autoRestart ? 'enabled' : 'disabled'} for bot ${botId}` });
});

// Premium access control helper functions
const getPremiumAccessDB = () => {
    try {
        return JSON.parse(fs.readFileSync('./premium_access.json', 'utf8'));
    } catch {
        return { approved_users: {}, pending_requests: {} };
    }
};

const savePremiumAccessDB = (data) => {
    fs.writeFileSync('./premium_access.json', JSON.stringify(data, null, 2));
};

// Premium Access Page Route
app.get('/code-editor-premium.html', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'code-editor-premium.html'), (err) => {
        if (err) {
            logger(`Error serving code-editor-premium.html: ${err.message}`, "[ERROR]");
            res.status(500).send('Unable to load the premium access page. Check server logs.');
        }
    });
});

// Code Editor Routes
app.get('/code-editor', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'code-editor.html'), (err) => {
        if (err) {
            logger(`Error serving code-editor.html: ${err.message}`, "[ERROR]");
            res.status(500).send('Unable to load the code editor. Check server logs.');
        }
    });
});

// Add route for user code editor page
app.get('/code-editor-user', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'code-editor-user.html'), (err) => {
        if (err) {
            logger(`Error serving code-editor-user.html: ${err.message}`, "[ERROR]");
            res.status(500).send('Unable to load the user code editor. Check server logs.');
        }
    });
});

// Generate access key for premium code editor
app.post('/api/request-premium-access', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const userEmail = req.session.userEmail;
    const userId = req.session.userId;

    try {
        const premiumData = getPremiumKeysDB();

        // Check if user already has approved access using new key system
        for (const [key, data] of Object.entries(premiumData.approved_keys || {})) {
            if (data && data.userEmail === userEmail) {
                return res.json({
                    status: "success",
                    message: "You already have premium access! Redirecting to code editor...",
                    accessKey: "APPROVED"
                });
            }
        }

        // Generate new access key
        const accessKey = generatePersistentKey(userEmail);

        // Check if this key already exists in pending
        if (premiumData.pending_keys && premiumData.pending_keys[accessKey]) {
            return res.json({
                status: "info",
                message: "Access key already generated. Redirecting to WhatsApp...",
                accessKey: accessKey,
                whatsapp: "+923114397148"
            });
        }

        // Initialize pending_keys if it doesn't exist
        if (!premiumData.pending_keys) {
            premiumData.pending_keys = {};
        }

        // Add to pending keys
        premiumData.pending_keys[accessKey] = {
            userEmail: userEmail,
            userId: userId,
            requestTime: new Date().toISOString(),
            status: 'pending'
        };

        savePremiumKeysDB(premiumData);

        logger(`Premium access key generated for user ${userEmail}: ${accessKey}`, "[PREMIUM ACCESS]");

        res.json({
            status: "success",
            message: "Access key generated successfully! Redirecting to WhatsApp...",
            accessKey: accessKey,
            whatsapp: "+923114397148"
        });
    } catch (error) {
        logger(`Error in request-premium-access: ${error.message}`, "[ERROR]");
        res.json({
            status: "error",
            message: "Error generating access key. Please try again."
        });
    }
});

// Admin approve premium access
app.post('/api/approve-premium-access', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { accessKey } = req.body;
    const adminEmail = req.session.userEmail;

    // Check if admin (you can add more admin emails here if needed)
    if (adminEmail !== 'mahiamir452@gmail.com') {
        return res.json({ status: "error", message: "Only admin can approve premium access" });
    }

    const premiumData = getPremiumAccessDB();

    // Find user with this access key
    let userToApprove = null;
    for (const [email, data] of Object.entries(premiumData.pending_requests)) {
        if (data.accessKey === accessKey) {
            userToApprove = email;
            break;
        }
    }

    if (!userToApprove) {
        return res.json({ status: "error", message: "Invalid access key" });
    }

    // Move from pending to approved
    premiumData.approved_users[userToApprove] = {
        accessKey: accessKey,
        approvedBy: adminEmail,
        approvedAt: new Date().toISOString(),
        userId: premiumData.pending_requests[userToApprove].userId
    };

    delete premiumData.pending_requests[userToApprove];
    savePremiumAccessDB(premiumData);

    logger(`Premium access approved for user ${userToApprove} by admin ${adminEmail}`, "[PREMIUM ACCESS]");

    res.json({
        status: "success",
        message: `Premium access approved for ${userToApprove}`,
        userEmail: userToApprove
    });
});

// Check premium access status
app.get('/api/premium-status', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const userEmail = req.session.userEmail;
    const premiumData = getPremiumKeysDB();

    // Check if user has any approved key
    for (const [key, data] of Object.entries(premiumData.approved_keys || {})) {
        if (data && data.userEmail === userEmail) {
            logger(`Premium access confirmed for user ${userEmail}`, "[PREMIUM CHECK]");
            return res.json({ status: "approved", message: "You have premium access" });
        }
    }

    // Check if user has any pending key
    for (const [key, data] of Object.entries(premiumData.pending_keys || {})) {
        if (data.userEmail === userEmail) {
            return res.json({
                status: "pending",
                message: "Your request is pending approval",
                accessKey: key
            });
        }
    }

    // No access found
    logger(`No premium access found for user ${userEmail}`, "[PREMIUM CHECK]");
    res.json({
        status: "none",
        message: "No premium access found"
    });
});

// API endpoints for user bot files (dynamic bot directory structure)
app.get('/api/user-bot-files', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const userId = req.session.userId;
    const botsDir = path.join(__dirname, 'bots');

    try {
        const userBots = [];

        // Check if bots directory exists
        if (!fs.existsSync(botsDir)) {
            return res.json({
                status: 'success',
                bots: []
            });
        }

        // Look for user directories (numeric folders)
        const userDirs = fs.readdirSync(botsDir).filter(dir => {
            const userPath = path.join(botsDir, dir);
            return fs.statSync(userPath).isDirectory();
        });

        for (const userDir of userDirs) {
            const userPath = path.join(botsDir, userDir);
            
            // Check if this directory belongs to the current user by checking bot ownership
            const userBotsDB = getUserBotsDB();
            if (userBotsDB[userId]) {
                const botDirs = fs.readdirSync(userPath).filter(dir => {
                    const botPath = path.join(userPath, dir);
                    return fs.statSync(botPath).isDirectory() && userBotsDB[userId][dir];
                });

                for (const botDir of botDirs) {
                    userBots.push({
                        userId: userDir,
                        botId: botDir
                    });
                }
            }
        }

        res.json({
            status: 'success',
            bots: userBots
        });
    } catch (error) {
        logger(`Error fetching user bot files: ${error.message}`, "[ERROR]");
        res.json({
            status: 'error',
            message: error.message,
            bots: []
        });
    }
});

app.get('/api/user-bot-files/:userId/:botId', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { userId: botUserId, botId } = req.params;
    const sessionUserId = req.session.userId;

    // Check if user owns this bot
    const userBotsDB = getUserBotsDB();
    if (!userBotsDB[sessionUserId] || !userBotsDB[sessionUserId][botId]) {
        return res.json({ status: "error", message: "You don't have permission to access this bot" });
    }

    try {
        const botPath = path.join(__dirname, 'bots', botUserId, botId);
        const commandsPath = path.join(botPath, 'commands');
        const eventsPath = path.join(botPath, 'events');

        let commands = [];
        let events = [];

        if (fs.existsSync(commandsPath)) {
            commands = fs.readdirSync(commandsPath)
                .filter(file => file.endsWith('.js'))
                .sort();
        }

        if (fs.existsSync(eventsPath)) {
            events = fs.readdirSync(eventsPath)
                .filter(file => file.endsWith('.js'))
                .sort();
        }

        res.json({
            status: 'success',
            commands: commands,
            events: events
        });
    } catch (error) {
        logger(`Error fetching bot files: ${error.message}`, "[ERROR]");
        res.json({
            status: 'error',
            message: error.message,
            commands: [],
            events: []
        });
    }
});

// API endpoints for admin code files (main system files)
app.get('/api/admin-code-files', (req, res) => {
    try {
        const commandsPath = path.join(__dirname, 'Priyansh/commands');
        const eventsPath = path.join(__dirname, 'Priyansh/events');

        let commands = [];
        let events = [];

        if (fs.existsSync(commandsPath)) {
            commands = fs.readdirSync(commandsPath)
                .filter(file => file.endsWith('.js'))
                .sort();
        }

        if (fs.existsSync(eventsPath)) {
            events = fs.readdirSync(eventsPath)
                .filter(file => file.endsWith('.js'))
                .sort();
        }

        res.json({
            status: 'success',
            commands: commands,
            events: events
        });
    } catch (error) {
        logger(`Error fetching admin code files: ${error.message}`, "[ERROR]");
        res.json({
            status: 'error',
            message: error.message,
            commands: [],
            events: []
        });
    }
});

// Get user bot file content
app.get('/api/user-bot-file/:userId/:botId/:type/:fileName', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { userId: botUserId, botId, type, fileName } = req.params;
    const sessionUserId = req.session.userId;

    if (!['commands', 'events'].includes(type)) {
        return res.json({ status: "error", message: "Invalid file type" });
    }

    // Check if user owns this bot
    const userBotsDB = getUserBotsDB();
    if (!userBotsDB[sessionUserId] || !userBotsDB[sessionUserId][botId]) {
        return res.json({ status: "error", message: "You don't have permission to access this bot" });
    }

    try {
        const botPath = path.join(__dirname, 'bots', botUserId, botId);
        const filePath = path.join(botPath, type, fileName);

        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            res.json({ status: 'success', content: content });
        } else {
            res.json({ status: 'error', message: 'File not found' });
        }
    } catch (error) {
        logger(`Error reading bot file: ${error.message}`, "[ERROR]");
        res.json({ status: 'error', message: error.message });
    }
});

// Get admin file content
app.get('/api/admin-code-file/:type/:fileName', (req, res) => {
    const { type, fileName } = req.params;

    if (!['command', 'event'].includes(type)) {
        return res.json({ status: "error", message: "Invalid file type" });
    }

    try {
        const originalDir = path.join(__dirname, 'Priyansh', type === 'command' ? 'commands' : 'events');
        const originalPath = path.join(originalDir, fileName);

        if (fs.existsSync(originalPath)) {
            const content = fs.readFileSync(originalPath, 'utf8');
            res.json({ status: 'success', content: content });
        } else {
            res.json({ status: 'error', message: 'File not found' });
        }
    } catch (error) {
        logger(`Error reading admin code file: ${error.message}`, "[ERROR]");
        res.json({ status: 'error', message: error.message });
    }
});

// Save user bot file
app.post('/api/save-user-bot-file', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { userId: botUserId, botId, type, fileName, content } = req.body;
    const sessionUserId = req.session.userId;

    if (!['commands', 'events'].includes(type)) {
        return res.json({ status: "error", message: "Invalid file type" });
    }

    // Check if user owns this bot
    const userBotsDB = getUserBotsDB();
    if (!userBotsDB[sessionUserId] || !userBotsDB[sessionUserId][botId]) {
        return res.json({ status: "error", message: "You don't have permission to modify this bot" });
    }

    try {
        const botPath = path.join(__dirname, 'bots', botUserId, botId);
        const filePath = path.join(botPath, type, fileName);

        // Ensure directory exists
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');

        logger(`User ${sessionUserId} saved bot ${botId} ${type}: ${fileName}`, "[CODE EDITOR]");
        res.json({ status: 'success', message: 'File saved successfully' });
    } catch (error) {
        logger(`Error saving bot file: ${error.message}`, "[ERROR]");
        res.json({ status: 'error', message: error.message });
    }
});

// Save admin file
app.post('/api/save-admin-code-file', (req, res) => {
    const { type, fileName, content } = req.body;

    if (!['command', 'event'].includes(type)) {
        return res.json({ status: "error", message: "Invalid file type" });
    }

    try {
        const originalDir = path.join(__dirname, 'Priyansh', type === 'command' ? 'commands' : 'events');
        const originalPath = path.join(originalDir, fileName);

        // Save the modified code to original system directory
        fs.writeFileSync(originalPath, content, 'utf8');

        logger(`Admin saved system ${type}: ${fileName}`, "[CODE EDITOR]");
        res.json({ status: 'success', message: 'File saved successfully' });
    } catch (error) {
        logger(`Error saving admin code file: ${error.message}`, "[ERROR]");
        res.json({ status: 'error', message: error.message });
    }
});

// Reset user bot file
app.post('/api/reset-user-bot-file', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const { userId: botUserId, botId, type, fileName } = req.body;
    const sessionUserId = req.session.userId;

    if (!['commands', 'events'].includes(type)) {
        return res.json({ status: "error", message: "Invalid file type" });
    }

    // Check if user owns this bot
    const userBotsDB = getUserBotsDB();
    if (!userBotsDB[sessionUserId] || !userBotsDB[sessionUserId][botId]) {
        return res.json({ status: "error", message: "You don't have permission to modify this bot" });
    }

    try {
        const originalDir = path.join(__dirname, 'Priyansh', type);
        const originalPath = path.join(originalDir, fileName);

        let content = '';
        if (fs.existsSync(originalPath)) {
            content = fs.readFileSync(originalPath, 'utf8');
        } else {
            content = `// Original ${type.slice(0, -1)}: ${fileName} not found\n`;
        }

        // Save the original content back to the bot's file
        const botPath = path.join(__dirname, 'bots', botUserId, botId);
        const filePath = path.join(botPath, type, fileName);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');

        logger(`User ${sessionUserId} reset bot ${botId} ${type}: ${fileName}`, "[CODE EDITOR]");
        res.json({ status: 'success', content: content });
    } catch (error) {
        logger(`Error resetting bot file: ${error.message}`, "[ERROR]");
        res.json({ status: 'error', message: error.message });
    }
});

// Reset admin file
app.post('/api/reset-admin-code-file', (req, res) => {
    const { type, fileName } = req.body;

    if (!['command', 'event'].includes(type)) {
        return res.json({ status: "error", message: "Invalid file type" });
    }

    try {
        const originalDir = path.join(__dirname, 'Priyansh', type === 'command' ? 'commands' : 'events');
        const originalPath = path.join(originalDir, fileName);

        // Return original content (same as current since we're working with originals)
        let content = '';
        if (fs.existsSync(originalPath)) {
            content = fs.readFileSync(originalPath, 'utf8');
        }

        logger(`Admin reset ${type}: ${fileName}`, "[CODE EDITOR]");
        res.json({ status: 'success', content: content });
    } catch (error) {
        logger(`Error resetting admin code file: ${error.message}`, "[ERROR]");
        res.json({ status: 'error', message: error.message });
    }
});

// Delete admin file
app.post('/api/delete-admin-code-file', (req, res) => {
    const { type, fileName } = req.body;

    if (!['command', 'event'].includes(type)) {
        return res.json({ status: "error", message: "Invalid file type" });
    }

    try {
        const originalDir = path.join(__dirname, 'Priyansh', type === 'command' ? 'commands' : 'events');
        const originalPath = path.join(originalDir, fileName);

        if (fs.existsSync(originalPath)) {
            fs.unlinkSync(originalPath);
            logger(`Admin deleted system ${type}: ${fileName}`, "[CODE EDITOR]");
            res.json({ status: 'success', message: 'File deleted successfully' });
        } else {
            res.json({ status: 'error', message: 'File not found' });
        }
    } catch (error) {
        logger(`Error deleting admin code file: ${error.message}`, "[ERROR]");
        res.json({ status: 'error', message: error.message });
    }
});

// Upload new admin file
app.post('/api/upload-admin-code-file', (req, res) => {
    const { type, fileName, content } = req.body;

    if (!['command', 'event'].includes(type)) {
        return res.json({ status: "error", message: "Invalid file type" });
    }

    if (!fileName || !fileName.endsWith('.js')) {
        return res.json({ status: "error", message: "Invalid filename" });
    }

    try {
        const originalDir = path.join(__dirname, 'Priyansh', type === 'command' ? 'commands' : 'events');
        const originalPath = path.join(originalDir, fileName);

        if (fs.existsSync(originalPath)) {
            return res.json({ status: 'error', message: 'File already exists' });
        }

        fs.writeFileSync(originalPath, content || '// New file\n', 'utf8');

        logger(`Admin uploaded new system ${type}: ${fileName}`, "[CODE EDITOR]");
        res.json({ status: 'success', message: 'File uploaded successfully' });
    } catch (error) {
        logger(`Error uploading admin code file: ${error.message}`, "[ERROR]");
        res.json({ status: 'error', message: error.message });
    }
});

// Load user-specific file management for code editor
try {
    require("./editor-loader.js")(app);
    logger("User-specific editor loader initialized successfully", "[EDITOR INTEGRATION]");
} catch (error) {
    logger(`Warning: Could not initialize editor loader: ${error.message}`, "[EDITOR INTEGRATION WARNING]");
}

// Handle uncaught exceptions to prevent server crashes
process.on('uncaughtException', (error) => {
    logger(`Uncaught Exception: ${error.message}`, "[ CRITICAL ERROR ]");
    console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    logger(`Unhandled Rejection at: ${promise}, reason: ${reason}`, "[ CRITICAL ERROR ]");
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    logger('SIGTERM received, shutting down gracefully...', "[ SHUTDOWN ]");

    for (const [botId, bot] of global.activeBots) {
        try {
            if (bot.process && !bot.process.killed) {
                // Force kill the process and all its children
                if (bot.process.pid) {
                    try {
                        // Kill the entire process group
                        process.kill(-bot.process.pid, 'SIGKILL');
                    } catch (killError) {
                        // Fallback to killing just the main process
                        bot.process.kill('SIGKILL');
                    }
                }
                logger(`Stopped bot ${botId} during shutdown`, "[ SHUTDOWN ]");
            }
        } catch (error) {
            logger(`Error stopping bot ${botId}: ${error.message}`, "[ SHUTDOWN ERROR ]");
        }
    }

    process.exit(0);
});

process.on('SIGINT', () => {
    logger('SIGINT received, shutting down gracefully...', "[ SHUTDOWN ]");

    for (const [botId, bot] of global.activeBots) {
        try {
            if (bot.process && !bot.process.killed) {
                // Force kill the process and all its children
                if (bot.process.pid) {
                    try {
                        // Kill the entire process group
                        process.kill(-bot.process.pid, 'SIGKILL');
                    } catch (killError) {
                        // Fallback to killing just the main process
                        bot.process.kill('SIGKILL');
                    }
                }
                logger(`Stopped bot ${botId} during shutdown`, "[ SHUTDOWN ]");
            }
        } catch (error) {
            logger(`Error stopping bot ${botId}: ${error.message}`, "[ SHUTDOWN ERROR ]");
        }
    }

    process.exit(0);
});

const server = app.listen(port, '0.0.0.0', () => {
    logger(`🚀 Server is running on port ${port}...`, "[ Starting ]");
    logger(`🌐 Server accessible at: http://0.0.0.0:${port}`, "[ Starting ]");
    logger(`📝 Login page: http://0.0.0.0:${port}/`, "[ Starting ]");
    logger(`🤖 Bot Manager: http://0.0.0.0:${port}/bot-manager`, "[ Starting ]");
    logger(`👑 Owner: Kashif Raza | WhatsApp: +923003310470`, "[ Starting ]");

    // Log static file serving
    logger(`📁 Static files served from: ${path.join(__dirname, 'public')}`, "[ Starting ]");
}).on('error', (err) => {
    logger(`Server error: ${err.message}`, "[ Error ]");
    if (err.code === 'EADDRINUSE') {
        logger(`Port ${port} is already in use. Trying port ${port + 1}...`, "[ Error ]");
        server.listen(port + 1, '0.0.0.0');
    }
});

// Set server timeout for better handling of long requests
server.timeout = 300000; // 5 minutes
