const moment = require("moment-timezone");
const { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } = require("fs-extra");
const { join, resolve } = require("path");
const { execSync } = require('child_process');
const logger = require("./utils/log.js");
const login = require("fca-priyansh");
const axios = require("axios");
const listPackage = JSON.parse(readFileSync('./package.json')).dependencies;
const listbuiltinModules = require("module").builtinModules;

const configPath = process.env.BOT_CONFIG || 'config.json';
const botId = process.env.BOT_ID || 'default';

console.log("Bot ID:", botId);
console.log("Config Path:", configPath);

global.client = new Object({
    commands: new Map(),
    events: new Map(),
    cooldowns: new Map(),
    eventRegistered: new Array(),
    handleSchedule: new Array(),
    handleReaction: new Array(),
    handleReply: new Array(),
    mainPath: process.cwd(),
    configPath: configPath,
    getTime: function (option) {
        switch (option) {
            case "seconds": return `${moment.tz("Asia/Kolkata").format("ss")}`;
            case "minutes": return `${moment.tz("Asia/Kolkata").format("mm")}`;
            case "hours": return `${moment.tz("Asia/Kolkata").format("HH")}`;
            case "date": return `${moment.tz("Asia/Kolkata").format("DD")}`;
            case "month": return `${moment.tz("Asia/Kolkata").format("MM")}`;
            case "year": return `${moment.tz("Asia/Kolkata").format("YYYY")}`;
            case "fullHour": return `${moment.tz("Asia/Kolkata").format("HH:mm:ss")}`;
            case "fullYear": return `${moment.tz("Asia/Kolkata").format("DD/MM/YYYY")}`;
            case "fullTime": return `${moment.tz("Asia/Kolkata").format("HH:mm:ss DD/MM/YYYY")}`;
        }
    }
});

global.data = new Object({
    threadInfo: new Map(),
    threadData: new Map(),
    userName: new Map(),
    userBanned: new Map(),
    threadBanned: new Map(),
    commandBanned: new Map(),
    threadAllowNSFW: new Array(),
    allUserID: new Array(),
    allCurrenciesID: new Array(),
    allThreadID: new Array()
});

global.utils = require("./utils");
global.nodemodule = new Object();
global.config = new Object();
global.configModule = new Object();
global.moduleData = new Array();
global.language = new Object();

//////////////////////////////////////////////////////////
//========= Find and get variable from Config =========//
/////////////////////////////////////////////////////////

var configValue;
try {
    global.client.configPath = resolve(configPath);

    // Try to load the config file
    if (existsSync(global.client.configPath)) {
        configValue = JSON.parse(readFileSync(global.client.configPath, 'utf8'));
        logger.loader(`Found file config: ${configPath} for Bot ID: ${botId}`);
    } else if (existsSync(global.client.configPath.replace(/\.json/g, "") + ".temp")) {
        configValue = JSON.parse(readFileSync(global.client.configPath.replace(/\.json/g, "") + ".temp", 'utf8'));
        logger.loader(`Found temp config: ${global.client.configPath.replace(/\.json/g, "") + ".temp"} for Bot ID: ${botId}`);
    } else {
        // Fallback to main config.json
        const fallbackConfig = resolve('./config.json');
        if (existsSync(fallbackConfig)) {
            configValue = JSON.parse(readFileSync(fallbackConfig, 'utf8'));
            logger.loader(`Using fallback config: ${fallbackConfig} for Bot ID: ${botId}`);
        } else {
            return logger.loader("Config file not found or invalid!", "error");
        }
    }
} catch (error) {
    return logger.loader(`Error loading config: ${error.message}`, "error");
}

console.log("Loaded Config:", configValue ? "Success" : "Failed");

try {
    for (const key in configValue) global.config[key] = configValue[key];
    logger.loader("Config Loaded for Bot ID: " + botId);
} catch {
    return logger.loader("Can't load file config!", "error");
}

const { Sequelize, sequelize } = require("./includes/database");
writeFileSync(global.client.configPath + ".temp", JSON.stringify(global.config, null, 4), 'utf8');

/////////////////////////////////////////
//========= Load language use =========//
/////////////////////////////////////////

const langFile = (readFileSync(`${__dirname}/languages/${global.config.language || "en"}.lang`, { encoding: 'utf-8' })).split(/\r?\n|\r/);
const langData = langFile.filter(item => item.indexOf('#') != 0 && item != '');
for (const item of langData) {
    const getSeparator = item.indexOf('=');
    const itemKey = item.slice(0, getSeparator);
    const itemValue = item.slice(getSeparator + 1, item.length);
    const head = itemKey.slice(0, itemKey.indexOf('.'));
    const key = itemKey.replace(head + '.', '');
    const value = itemValue.replace(/\\n/gi, '\n');
    if (typeof global.language[head] == "undefined") global.language[head] = new Object();
    global.language[head][key] = value;
}

global.getText = function (...args) {
    const langText = global.language;
    if (!langText.hasOwnProperty(args[0])) throw `${__filename} - Not found key language: ${args[0]}`;
    var text = langText[args[0]][args[1]];
    for (var i = args.length - 1; i > 0; i--) {
        const regEx = RegExp(`%${i}`, 'g');
        text = text.replace(regEx, args[i + 1]);
    }
    return text;
}

try {
    var appState = JSON.parse(global.config.appstate); // Use dynamic appstate from web
    logger.loader(global.getText("priyansh", "foundPathAppstate"));
} catch {
    return logger.loader(global.getText("priyansh", "notFoundPathAppstate"), "error");
}

//========= Login account and start Listen Event =========//

function onBot({ models: botModel }) {
    const loginData = {};
    loginData['appState'] = appState;
    login(loginData, async (loginError, loginApiData) => {
        if (loginError) return logger(JSON.stringify(loginError), `ERROR`);
        loginApiData.setOptions(global.config.FCAOption || {});
        global.client.api = loginApiData;
        global.config.version = '1.2.14';
        global.client.timeStart = new Date().getTime();

        // Load commands dynamically based on selected commands
        const botCommandsPath = global.client.mainPath + `/bots/${process.env.USER_ID || 'default'}/${botId}/commands`;
        const defaultCommandsPath = global.client.mainPath + '/Priyansh/commands';

        let commandsPath = defaultCommandsPath;
        if (existsSync(botCommandsPath)) {
            commandsPath = botCommandsPath;
            logger.loader(`Using bot-specific commands from: ${botCommandsPath}`);
        }

        const listCommand = readdirSync(commandsPath)
            .filter(command => command.endsWith('.js') && !command.includes('example') &&
                (!global.config.commandDisabled || !global.config.commandDisabled.includes(command)) &&
                (!global.config.commands || global.config.commands.includes(command.replace('.js', ''))));
        for (const command of listCommand) {
            try {
                var module = require(commandsPath + '/' + command);
                if (!module.config || !module.run || !module.config.commandCategory) throw new Error(global.getText('priyansh', 'errorFormat'));
                if (global.client.commands.has(module.config.name || '')) throw new Error(global.getText('priyansh', 'nameExist'));
                if (!module.languages || typeof module.languages != 'object' || Object.keys(module.languages).length == 0)
                    logger.loader(global.getText('priyansh', 'notFoundLanguage', module.config.name), 'warn');
                if (module.config.dependencies && typeof module.config.dependencies == 'object') {
                    for (const reqDependencies in module.config.dependencies) {
                        const reqDependenciesPath = join(__dirname, 'nodemodules', 'node_modules', reqDependencies);
                        try {
                            if (!global.nodemodule.hasOwnProperty(reqDependencies)) {
                                if (listPackage.hasOwnProperty(reqDependencies) || listbuiltinModules.includes(reqDependencies))
                                    global.nodemodule[reqDependencies] = require(reqDependencies);
                                else global.nodemodule[reqDependencies] = require(reqDependenciesPath);
                            }
                        } catch {
                            var check = false;
                            var isError;
                            logger.loader(global.getText('priyansh', 'notFoundPackage', reqDependencies, module.config.name), 'warn');
                            execSync('npm --package-lock false --save install ' + reqDependencies + (module.config.dependencies[reqDependencies] == '*' || module.config.dependencies[reqDependencies] == '' ? '' : '@' + module.config.dependencies[reqDependencies]), { stdio: 'inherit', env: process.env, shell: true, cwd: join(__dirname, 'nodemodules') });
                            for (let i = 1; i <= 3; i++) {
                                try {
                                    require.cache = {};
                                    if (listPackage.hasOwnProperty(reqDependencies) || listbuiltinModules.includes(reqDependencies))
                                        global.nodemodule[reqDependencies] = require(reqDependencies);
                                    else global.nodemodule[reqDependencies] = require(reqDependenciesPath);
                                    check = true;
                                    break;
                                } catch (error) { isError = error; }
                                if (check || !isError) break;
                            }
                            if (!check || isError) throw global.getText('priyansh', 'cantInstallPackage', reqDependencies, module.config.name, isError);
                        }
                    }
                    logger.loader(global.getText('priyansh', 'loadedPackage', module.config.name));
                }
                if (module.config.envConfig) try {
                    for (const envConfig in module.config.envConfig) {
                        if (typeof global.configModule[module.config.name] == 'undefined') global.configModule[module.config.name] = {};
                        if (typeof global.config[module.config.name] == 'undefined') global.config[module.config.name] = {};
                        if (typeof global.config[module.config.name][envConfig] !== 'undefined')
                            global.configModule[module.config.name][envConfig] = global.config[module.config.name][envConfig];
                        else global.configModule[module.config.name][envConfig] = module.config.envConfig[envConfig] || '';
                        if (typeof global.config[module.config.name][envConfig] == 'undefined')
                            global.config[module.config.name][envConfig] = module.config.envConfig[envConfig] || '';
                    }
                    logger.loader(global.getText('priyansh', 'loadedConfig', module.config.name));
                } catch (error) {
                    throw new Error(global.getText('priyansh', 'loadedConfig', module.config.name, JSON.stringify(error)));
                }
                if (module.onLoad) {
                    try {
                        const moduleData = { api: loginApiData, models: botModel };
                        module.onLoad(moduleData);
                    } catch (error) {
                        throw new Error(global.getText('priyansh', 'cantOnload', module.config.name, JSON.stringify(error)), 'error');
                    }
                }
                if (module.handleEvent) global.client.eventRegistered.push(module.config.name);
                global.client.commands.set(module.config.name, module);
                logger.loader(global.getText('priyansh', 'successLoadModule', module.config.name));
            } catch (error) {
                logger.loader(global.getText('priyansh', 'failLoadModule', module.config.name, error), 'error');
            }
        }

        // Load events dynamically based on selected events
        const botEventsPath = global.client.mainPath + `/bots/${process.env.USER_ID || 'default'}/${botId}/events`;
        const defaultEventsPath = global.client.mainPath + '/Priyansh/events';

        let eventsPath = defaultEventsPath;
        if (existsSync(botEventsPath)) {
            eventsPath = botEventsPath;
            logger.loader(`Using bot-specific events from: ${botEventsPath}`);
        }

        const events = readdirSync(eventsPath)
            .filter(event => event.endsWith('.js') &&
                (!global.config.eventDisabled || !global.config.eventDisabled.includes(event)) &&
                (!global.config.events || global.config.events.includes(event.replace('.js', ''))));
        for (const ev of events) {
            try {
                var event = require(eventsPath + '/' + ev);
                if (!event.config || !event.run) throw new Error(global.getText('priyansh', 'errorFormat'));
                if (global.client.events.has(event.config.name || '')) throw new Error(global.getText('priyansh', 'nameExist'));
                if (event.config.dependencies && typeof event.config.dependencies == 'object') {
                    for (const dependency in event.config.dependencies) {
                        const dependencyPath = join(__dirname, 'nodemodules', 'node_modules', dependency);
                        try {
                            if (!global.nodemodule.hasOwnProperty(dependency)) {
                                if (listPackage.hasOwnProperty(dependency) || listbuiltinModules.includes(dependency))
                                    global.nodemodule[dependency] = require(dependency);
                                else global.nodemodule[dependency] = require(dependencyPath);
                            }
                        } catch {
                            let check = false;
                            let isError;
                            logger.loader(global.getText('priyansh', 'notFoundPackage', dependency, event.config.name), 'warn');
                            execSync('npm --package-lock false --save install ' + dependency + (event.config.dependencies[dependency] == '*' || event.config.dependencies[dependency] == '' ? '' : '@' + event.config.dependencies[dependency]), { stdio: 'inherit', env: process.env, shell: true, cwd: join(__dirname, 'nodemodules') });
                            for (let i = 1; i <= 3; i++) {
                                try {
                                    require.cache = {};
                                    if (listPackage.hasOwnProperty(dependency) || listbuiltinModules.includes(dependency))
                                        global.nodemodule[dependency] = require(dependency);
                                    else global.nodemodule[dependency] = require(dependencyPath);
                                    check = true;
                                    break;
                                } catch (error) { isError = error; }
                                if (check || !isError) break;
                            }
                            if (!check || isError) throw global.getText('priyansh', 'cantInstallPackage', dependency, event.config.name);
                        }
                    }
                    logger.loader(global.getText('priyansh', 'loadedPackage', event.config.name));
                }
                if (event.config.envConfig) try {
                    for (const envConfig in event.config.envConfig) {
                        if (typeof global.configModule[event.config.name] == 'undefined') global.configModule[event.config.name] = {};
                        if (typeof global.config[event.config.name] == 'undefined') global.config[event.config.name] = {};
                        if (typeof global.config[event.config.name][envConfig] !== 'undefined')
                            global.configModule[event.config.name][envConfig] = global.config[event.config.name][envConfig];
                        else global.configModule[event.config.name][envConfig] = event.config.envConfig[envConfig] || '';
                        if (typeof global.config[event.config.name][envConfig] == 'undefined')
                            global.config[event.config.name][envConfig] = event.config.envConfig[envConfig] || '';
                    }
                    logger.loader(global.getText('priyansh', 'loadedConfig', event.config.name));
                } catch (error) {
                    throw new Error(global.getText('priyansh', 'loadedConfig', event.config.name, JSON.stringify(error)));
                }
                if (event.onLoad) try {
                    const eventData = { api: loginApiData, models: botModel };
                    event.onLoad(eventData);
                } catch (error) {
                    throw new Error(global.getText('priyansh', 'cantOnload', event.config.name, JSON.stringify(error)), 'error');
                }
                global.client.events.set(event.config.name, event);
                logger.loader(global.getText('priyansh', 'successLoadModule', event.config.name));
            } catch (error) {
                logger.loader(global.getText('priyansh', 'failLoadModule', event.config.name, error), 'error');
            }
        }

        logger.loader(global.getText('priyansh', 'finishLoadModule', global.client.commands.size, global.client.events.size));
        logger.loader(`Startup Time: ${((Date.now() - global.client.timeStart) / 1000).toFixed()}s`);
        logger.loader('===== [ ' + (Date.now() - global.client.timeStart) + 'ms ] =====');
        writeFileSync(global.client.configPath, JSON.stringify(global.config, null, 4), 'utf8');
        unlinkSync(global.client.configPath + '.temp');

        const listenerData = { api: loginApiData, models: botModel };
        const listener = require('./includes/listen')(listenerData);

        function listenerCallback(error, message) {
            if (error) return logger(global.getText('priyansh', 'handleListenError', JSON.stringify(error)), 'error');
            if (['presence', 'typ', 'read_receipt'].some(data => data == message.type)) return;
            if (global.config.DeveloperMode) console.log(message);
            return listener(message);
        }
        global.handleListen = loginApiData.listenMqtt(listenerCallback);
    });
}

//========= Connecting to Database =========//

(async () => {
    try {
        await sequelize.authenticate();
        const authentication = { Sequelize, sequelize };
        const models = require('./includes/database/model')(authentication);
        logger(global.getText('priyansh', 'successConnectDatabase'), '[ DATABASE ]');
        const botData = { models };
        onBot(botData);
    } catch (error) {
        logger(global.getText('priyansh', 'successConnectDatabase', JSON.stringify(error)), '[ DATABASE ]');
    }
})();

// Better error handling for production
process.on('unhandledRejection', (reason, promise) => {
    logger(`Unhandled Rejection at Promise: ${promise}, reason: ${reason}`, "[ ERROR ]");
    console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    logger(`Uncaught Exception: ${error.message}`, "[ CRITICAL ERROR ]");
    console.error('Uncaught Exception:', error);

    // Don't exit the process, just log the error
    // process.exit(1);
});

// Memory usage monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 200 * 1024 * 1024) { // 200MB
        logger(`High memory usage detected: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`, "[ MEMORY WARNING ]");

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            logger("Forced garbage collection", "[ MEMORY CLEANUP ]");
        }
    }
}, 60000); // Check every minute
const fs = require('fs');
const path = require('path');
// Function to load commands
client.loadCommands = (commandPath) => {
  const commandFiles = readdirSync(commandPath).filter((file) =>
    file.endsWith(".js")
  );

  // Function to get user-specific file if exists
  function getUserSpecificFile(originalPath, userEmail) {
    if (!userEmail) return originalPath;

    const fileName = path.basename(originalPath);
    const isCommand = originalPath.includes('/commands/');
    const userSpecificPath = path.join(__dirname, 'user_code', userEmail, isCommand ? 'commands' : 'events', fileName);

    return fs.existsSync(userSpecificPath) ? userSpecificPath : originalPath;
  }

  for (const file of commandFiles) {
    const originalPath = path.join(commandPath, file);
    const filePath = getUserSpecificFile(originalPath, global.botUserEmail);

    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);
    if (command.config?.name) {
      client.commands.set(command.config.name, command);
      client.aliases.set(command.config.name, command.config.name);
      if (command.config.aliases) {
        command.config.aliases.forEach((alias) =>
          client.aliases.set(alias, command.config.name)
        );
      }
    }
  }
};

// Function to load events
client.loadEvents = (eventPath) => {
  const eventFiles = readdirSync(eventPath).filter((file) =>
    file.endsWith(".js")
  );
  for (const file of eventFiles) {
    const originalPath = path.join(eventPath, file);
    const filePath = getUserSpecificFile(originalPath, global.botUserEmail);

    delete require.cache[require.resolve(filePath)];
    const event = require(filePath);
    if (event.config?.name) {
      client.events.set(event.config.name, event);
    }
  }
};