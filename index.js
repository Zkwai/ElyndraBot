require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { statusBedrock } = require('minecraft-server-util');
const presenceManager = require('./richPresence');
const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SelectMenuBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    MessageFlags,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const WARNINGS_PATH = path.join(DATA_DIR, 'warnings.json');
const LINKS_PATH = path.join(DATA_DIR, 'links.json');
const LINK_CODES_PATH = path.join(DATA_DIR, 'link_codes.json');
const ROLE_MAP_PATH = path.join(DATA_DIR, 'role_map.json');
const REACTION_PANELS_PATH = path.join(DATA_DIR, 'reaction_panels.json');
const MC_CONFIG_PATH = path.join(CONFIG_DIR, 'minecraft.json');
const TIME_REGEX = /^(\d+)([smhd])$/;
const PANEL_COLOR = '#f1c40f';
const CREDIT_TEXT = 'aimbot.sprx';
const CREDIT_ICON_URL = 'https://cdn.discordapp.com/avatars/396332601717293056/05cc4947c620300904d645739e53f8d7.png?size=1024';
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_SECRET = process.env.LINK_SECRET || '';
const CONFIG_PANEL_ROLE_ID = '1266193611813290045'; // Rôle requis pour accéder au panel de configuration
const defaultMinecraftConfig = {
    title: 'Informations Minecraft',
    host: 'elyndra.mcbe.fr',
    port: 19132,
    versionOverride: ''
};
const defaultRoleMap = {
    defaultGroup: 'default',
    roles: []
};
const defaultReactionPanels = {
    panels: {}
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

console.log('🔐 Intents configurés:');
console.log('   • Guilds');
console.log('   • GuildMessages');
console.log('   • MessageContent (PRIVILEGED)');
console.log('   • GuildMembers (PRIVILEGED)');
console.log('   • GuildModeration');
console.log('   • GuildMessageReactions');

const antiSpamCache = new Map();

function ensureDataFile(filePath, defaultValue) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    }
}

function ensureConfigFile(filePath, defaultValue) {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    }
}

function readJson(filePath, fallback) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        console.error(`Erreur lecture JSON ${filePath}:`, error);
        return fallback;
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const defaultGuildConfig = {
    logChannelId: null,
    automod: {
        enabled: true,
        blockInvites: true,
        linkAllowedChannelIds: [],
        allowInvitesInLinkChannels: false,
        maxMentions: 5,
        maxLinks: 3,
        maxCapsPercent: 70,
        minCapsLength: 10
    },
    antispam: {
        enabled: true,
        intervalMs: 7000,
        maxMessages: 5,
        timeoutMs: 600000
    }
};

ensureDataFile(CONFIG_PATH, {});
ensureDataFile(WARNINGS_PATH, {});
ensureDataFile(LINKS_PATH, { byGamertag: {}, byDiscordId: {} });
ensureDataFile(LINK_CODES_PATH, {});
ensureDataFile(ROLE_MAP_PATH, defaultRoleMap);
ensureDataFile(REACTION_PANELS_PATH, defaultReactionPanels);
ensureConfigFile(MC_CONFIG_PATH, defaultMinecraftConfig);

const guildConfigs = readJson(CONFIG_PATH, {});
const warningsStore = readJson(WARNINGS_PATH, {});
const linksStore = readJson(LINKS_PATH, { byGamertag: {}, byDiscordId: {} });
const linkCodes = readJson(LINK_CODES_PATH, {});
const roleMap = readJson(ROLE_MAP_PATH, defaultRoleMap);
const reactionPanels = readJson(REACTION_PANELS_PATH, defaultReactionPanels);

function getGuildConfig(guildId) {
    if (!guildConfigs[guildId]) {
        guildConfigs[guildId] = JSON.parse(JSON.stringify(defaultGuildConfig));
        writeJson(CONFIG_PATH, guildConfigs);
    }
    const config = guildConfigs[guildId];
    const envAutomodOverrides = getEnvAutomodOverrides();
    const merged = {
        ...defaultGuildConfig,
        ...config,
        automod: {
            ...defaultGuildConfig.automod,
            ...(config.automod || {}),
            ...envAutomodOverrides
        },
        antispam: {
            ...defaultGuildConfig.antispam,
            ...(config.antispam || {})
        }
    };
    if (JSON.stringify(merged) !== JSON.stringify(config)) {
        guildConfigs[guildId] = merged;
        writeJson(CONFIG_PATH, guildConfigs);
    }
    return merged;
}

function saveGuildConfig(guildId, config) {
    guildConfigs[guildId] = config;
    writeJson(CONFIG_PATH, guildConfigs);
}

function getWarnings(guildId, userId) {
    if (!warningsStore[guildId]) warningsStore[guildId] = {};
    if (!warningsStore[guildId][userId]) warningsStore[guildId][userId] = [];
    return warningsStore[guildId][userId];
}

function saveWarnings() {
    writeJson(WARNINGS_PATH, warningsStore);
}

function saveLinks() {
    writeJson(LINKS_PATH, linksStore);
}

function saveLinkCodes() {
    writeJson(LINK_CODES_PATH, linkCodes);
}

function saveReactionPanels() {
    writeJson(REACTION_PANELS_PATH, reactionPanels);
}

function getMinecraftConfig() {
    return readJson(MC_CONFIG_PATH, defaultMinecraftConfig);
}

function parseDuration(duration) {
    const match = duration.match(TIME_REGEX);
    if (!match) return null;
    const timeValue = parseInt(match[1], 10);
    const timeUnit = match[2];
    switch (timeUnit) {
        case 's':
            return timeValue * 1000;
        case 'm':
            return timeValue * 60 * 1000;
        case 'h':
            return timeValue * 60 * 60 * 1000;
        case 'd':
            return timeValue * 24 * 60 * 60 * 1000;
        default:
            return null;
    }
}

function parseBoolean(value) {
    const normalized = String(value).toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return null;
}

function parseGuildIds() {
    const raw = String(process.env.GUILD_ID || '').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

function parseIdList(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return raw
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
}

function getEnvAutomodOverrides() {
    const overrides = {};
    if (Object.prototype.hasOwnProperty.call(process.env, 'AUTOMOD_ENABLED')) {
        const parsed = parseBoolean(process.env.AUTOMOD_ENABLED);
        if (parsed !== null) overrides.enabled = parsed;
    }
    if (Object.prototype.hasOwnProperty.call(process.env, 'AUTOMOD_BLOCK_INVITES')) {
        const parsed = parseBoolean(process.env.AUTOMOD_BLOCK_INVITES);
        if (parsed !== null) overrides.blockInvites = parsed;
    }
    if (Object.prototype.hasOwnProperty.call(process.env, 'AUTOMOD_ALLOW_INVITES_IN_LINK_CHANNELS')) {
        const parsed = parseBoolean(process.env.AUTOMOD_ALLOW_INVITES_IN_LINK_CHANNELS);
        if (parsed !== null) overrides.allowInvitesInLinkChannels = parsed;
    }
    if (Object.prototype.hasOwnProperty.call(process.env, 'AUTOMOD_LINK_ALLOWED_CHANNEL_IDS')) {
        const ids = parseIdList(process.env.AUTOMOD_LINK_ALLOWED_CHANNEL_IDS);
        if (ids) overrides.linkAllowedChannelIds = ids;
    }
    if (Object.prototype.hasOwnProperty.call(process.env, 'AUTOMOD_MAX_LINKS')) {
        const parsed = parseInt(process.env.AUTOMOD_MAX_LINKS, 10);
        if (!Number.isNaN(parsed)) overrides.maxLinks = parsed;
    }
    return overrides;
}

let presenceIndex = 0;

function updateBotPresence() {
    if (!client.user) return;
    
    const serverCount = client.guilds.cache.size;
    const memberCount = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    
    // Define multiple presence options that cycle
    const presences = [
        {
            activities: [{
                name: `/help pour les commandes`,
                type: 3 // Watching
            }],
            status: 'online'
        },
        {
            activities: [{
                name: `${serverCount} serveur${serverCount > 1 ? 's' : ''}`,
                type: 3 // Watching
            }],
            status: 'online'
        },
        {
            activities: [{
                name: `${memberCount} membre${memberCount > 1 ? 's' : ''}`,
                type: 3 // Watching
            }],
            status: 'online'
        },
        {
            activities: [{
                name: `Moderation & Roles`,
                type: 0 // Playing
            }],
            status: 'online'
        },
        {
            activities: [{
                name: `Minecraft: elyndra.mcbe.fr`,
                type: 0 // Playing
            }],
            status: 'online'
        }
    ];
    
    // Cycle through presences
    const presence = presences[presenceIndex % presences.length];
    client.user.setPresence(presence);
    
    presenceIndex++;
    console.log(`🎮 Presence mise à jour: ${presence.activities[0].name}`);
}

function normalizeGamertag(gamertag) {
    return String(gamertag || '').trim().toLowerCase();
}

function generateLinkCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code.slice(0, 4) + '-' + code.slice(4);
}

function pruneExpiredCodes() {
    const now = Date.now();
    for (const [code, entry] of Object.entries(linkCodes)) {
        if (!entry || typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) {
            delete linkCodes[code];
        }
    }
}

function linkDiscordToGamertag(discordId, gamertag) {
    const normalized = normalizeGamertag(gamertag);
    if (!normalized) return null;

    const existingDiscord = linksStore.byDiscordId[discordId];
    if (existingDiscord?.gamertag) {
        delete linksStore.byGamertag[normalizeGamertag(existingDiscord.gamertag)];
    }

    const existingGamertag = linksStore.byGamertag[normalized];
    if (existingGamertag?.discordId) {
        delete linksStore.byDiscordId[existingGamertag.discordId];
    }

    const linkedAt = new Date().toISOString();
    const entry = { gamertag: gamertag.trim(), discordId, linkedAt };
    linksStore.byGamertag[normalized] = entry;
    linksStore.byDiscordId[discordId] = entry;
    saveLinks();
    return entry;
}

function unlinkByDiscordId(discordId) {
    const entry = linksStore.byDiscordId[discordId];
    if (!entry) return false;
    delete linksStore.byDiscordId[discordId];
    delete linksStore.byGamertag[normalizeGamertag(entry.gamertag)];
    saveLinks();
    return true;
}

function unlinkByGamertag(gamertag) {
    const normalized = normalizeGamertag(gamertag);
    const entry = linksStore.byGamertag[normalized];
    if (!entry) return false;
    delete linksStore.byGamertag[normalized];
    delete linksStore.byDiscordId[entry.discordId];
    saveLinks();
    return true;
}

async function resolveGroupForDiscord(discordId) {
    const guildIds = parseGuildIds();
    const targetGuilds = guildIds.length > 0
        ? guildIds
        : client.guilds.cache.map(guild => guild.id);
    if (targetGuilds.length === 0) return null;

    let member = null;
    for (const guildId of targetGuilds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        member = await guild.members.fetch(discordId).catch(() => null);
        if (member) break;
    }
    if (!member) return null;

    const roleEntries = Array.isArray(roleMap.roles) ? roleMap.roles : [];
    let best = null;
    for (const roleEntry of roleEntries) {
        if (!roleEntry || !roleEntry.discordRoleId || !roleEntry.group) continue;
        if (!member.roles.cache.has(roleEntry.discordRoleId)) continue;
        const priority = Number(roleEntry.priority) || 0;
        if (!best || priority > best.priority) {
            best = { group: roleEntry.group, priority };
        }
    }

    if (best?.group) return best.group;
    return roleMap.defaultGroup || null;
}

// Reaction Panel Functions
function createReactionPanel(guildId, panelId, title, description) {
    if (!reactionPanels.panels[guildId]) {
        reactionPanels.panels[guildId] = {};
    }
    reactionPanels.panels[guildId][panelId] = {
        title,
        description,
        messageId: null,
        channelId: null,
        reactions: {}
    };
    saveReactionPanels();
    return reactionPanels.panels[guildId][panelId];
}

function deleteReactionPanel(guildId, panelId) {
    if (reactionPanels.panels[guildId]?.[panelId]) {
        delete reactionPanels.panels[guildId][panelId];
        saveReactionPanels();
        return true;
    }
    return false;
}

function getReactionPanel(guildId, panelId) {
    return reactionPanels.panels[guildId]?.[panelId] || null;
}

function getReactionPanelByMessage(guildId, messageId) {
    for (const [panelId, panel] of Object.entries(reactionPanels.panels[guildId] || {})) {
        if (panel.messageId === messageId) {
            return { panelId, panel };
        }
    }
    return null;
}

function addReactionRole(guildId, panelId, emoji, roleId) {
    const panel = getReactionPanel(guildId, panelId);
    if (!panel) return false;
    panel.reactions[emoji] = roleId;
    saveReactionPanels();
    return true;
}

function removeReactionRole(guildId, panelId, emoji) {
    const panel = getReactionPanel(guildId, panelId);
    if (!panel) return false;
    delete panel.reactions[emoji];
    saveReactionPanels();
    return true;
}

function updatePanelMessage(guildId, panelId, messageId, channelId) {
    const panel = getReactionPanel(guildId, panelId);
    if (!panel) return false;
    panel.messageId = messageId;
    panel.channelId = channelId;
    saveReactionPanels();
    return true;
}

function countLinks(content) {
    const matches = content.match(/https?:\/\//gi);
    return matches ? matches.length : 0;
}

function hasInvite(content) {
    return /(discord\.gg|discord\.com\/invite)/i.test(content);
}

function capsPercent(content) {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length === 0) return 0;
    const caps = letters.replace(/[^A-Z]/g, '').length;
    return Math.round((caps / letters.length) * 100);
}

// Config Panel Functions
function buildConfigPanelEmbed(guild) {
    return applyCredit(new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle('⚙️ Configuration')
        .setDescription('Bienvenue dans le panneau de configuration d\'ElyndraBot.')
        .addFields(
            { name: '🏠 Accueil', value: 'Vue d\'ensemble du serveur', inline: true },
            { name: '🚫 Automod', value: 'Configuration anti-spam', inline: true },
            { name: '🎭 Reaction Panels', value: 'Gestion des réaction-rôles', inline: true },
            { name: '📋 Moderation', value: 'Paramètres de modération', inline: true },
            { name: '🔔 Notifications', value: 'Salon de logs', inline: true },
            { name: '🌐 Minecraft', value: 'Info serveur Minecraft', inline: true }
        )
        .setTimestamp());
}

function getConfigModuleSelectMenu() {
    return new StringSelectMenuBuilder()
        .setCustomId('config_module_select')
        .setPlaceholder('Choisissez un module...')
        .addOptions(
            { label: 'Accueil', value: 'home', emoji: '🏠', description: 'Vue d\'ensemble', default: true },
            { label: 'Automod', value: 'automod', emoji: '🚫', description: 'Configuration anti-spam' },
            { label: 'Reaction Panels', value: 'reaction_panels', emoji: '🎭', description: 'Gestion des rôles' },
            { label: 'Moderation', value: 'moderation', emoji: '📋', description: 'Paramètres de modération' },
            { label: 'Notifications', value: 'notifications', emoji: '🔔', description: 'Salon de logs' },
            { label: 'Minecraft', value: 'minecraft', emoji: '🌐', description: 'Info serveur Minecraft' }
        );
}

function buildConfigModuleEmbed(moduleName, guild, guildConfig) {
    const baseEmbed = new EmbedBuilder().setColor(PANEL_COLOR);
    
    if (moduleName === 'home') {
        return baseEmbed
            .setTitle('🏠 Accueil')
            .setDescription(`Bienvenue sur **${guild.name}**`)
            .addFields(
                { name: '👥 Membres', value: `${guild.memberCount}`, inline: true },
                { name: '📅 Créé le', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
                { name: '💬 Salons texte', value: `${guild.channels.cache.filter(c => c.isTextBased()).size}`, inline: true },
                { name: '🔊 Salons vocaux', value: `${guild.channels.cache.filter(c => c.isVoiceBased()).size}`, inline: true },
                { name: '🧩 Rôles', value: `${guild.roles.cache.size}`, inline: true },
                { name: '👤 Propriétaire', value: `<@${guild.ownerId}>`, inline: true }
            )
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .setTimestamp();
    }
    
    if (moduleName === 'automod') {
        const automod = guildConfig.automod;
        return baseEmbed
            .setTitle('🚫 Configuration Automod')
            .addFields(
                { name: '✅ Activé', value: automod.enabled ? 'Oui' : 'Non', inline: true },
                { name: '🔗 Bloquer invitations', value: automod.blockInvites ? 'Oui' : 'Non', inline: true },
                { name: '⚠️ Max mentions', value: `${automod.maxMentions}`, inline: true },
                { name: '🔗 Max liens', value: `${automod.maxLinks}`, inline: true },
                { name: '🔤 Max CAPS %', value: `${automod.maxCapsPercent}%`, inline: true },
                { name: '📏 Min CAPS longueur', value: `${automod.minCapsLength}`, inline: true }
            )
            .setTimestamp();
    }
    
    if (moduleName === 'reaction_panels') {
        const panels = reactionPanels.panels[guild.id] || {};
        const panelCount = Object.keys(panels).length;
        return baseEmbed
            .setTitle('🎭 Reaction Panels')
            .setDescription(`**${panelCount}** panneau(x) configuré(s)`)
            .addFields(
                { name: 'Total', value: `${panelCount} panel(s)`, inline: true },
                { name: 'Publiés', value: `${Object.values(panels).filter(p => p.messageId).length}`, inline: true },
                { name: 'Brouillons', value: `${Object.values(panels).filter(p => !p.messageId).length}`, inline: true }
            )
            .setTimestamp();
    }
    
    if (moduleName === 'moderation') {
        return baseEmbed
            .setTitle('📋 Moderation')
            .setDescription('Paramètres de modération')
            .addFields(
                { name: 'Anti-spam activé', value: guildConfig.antispam.enabled ? 'Oui' : 'Non', inline: true },
                { name: 'Max messages', value: `${guildConfig.antispam.maxMessages}`, inline: true },
                { name: 'Intervalle', value: `${guildConfig.antispam.intervalMs}ms`, inline: true },
                { name: 'Durée timeout', value: `${Math.floor(guildConfig.antispam.timeoutMs / 1000)}s`, inline: true }
            )
            .setTimestamp();
    }
    
    if (moduleName === 'notifications') {
        const logChannel = guildConfig.logChannelId ? `<#${guildConfig.logChannelId}>` : 'Non configuré';
        return baseEmbed
            .setTitle('🔔 Notifications')
            .addFields(
                { name: 'Salon de logs', value: logChannel, inline: false }
            )
            .setTimestamp();
    }
    
    if (moduleName === 'minecraft') {
        const mcConfig = getMinecraftConfig();
        return baseEmbed
            .setTitle('🌐 Minecraft')
            .addFields(
                { name: 'Serveur', value: mcConfig.host, inline: true },
                { name: 'Port', value: `${mcConfig.port}`, inline: true }
            )
            .setTimestamp();
    }
    
    return baseEmbed;
}

function applyCredit(embed) {
    return embed.setFooter({ text: CREDIT_TEXT, iconURL: CREDIT_ICON_URL });
}

function buildServerInfoEmbed(guild) {
    return applyCredit(new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle(`Information serveur ${guild.name}`)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
            { name: '👑 Proprietaire', value: `<@${guild.ownerId}>`, inline: true },
            { name: '👥 Membres', value: `${guild.memberCount}`, inline: true },
            { name: '📅 Cree le', value: guild.createdAt.toLocaleDateString('fr-FR'), inline: true },
            { name: '💬 Salons texte', value: `${guild.channels.cache.filter(channel => channel.isTextBased()).size}`, inline: true },
            { name: '🔊 Salons vocaux', value: `${guild.channels.cache.filter(channel => channel.isVoiceBased()).size}`, inline: true },
            { name: '🧩 Roles', value: `${guild.roles.cache.size}`, inline: true },
            { name: '🚀 Boosts', value: `${guild.premiumSubscriptionCount ?? 0}`, inline: true }
        )
        .setTimestamp());
}

function buildMinecraftPanelEmbed(config, status) {
    const isOnline = status?.online === true;
    const players = isOnline
        ? `${status.playersOnline}/${status.playersMax}`
        : '0/0';
    const version = isOnline
        ? status.versionName
        : (config.versionOverride || 'Inconnu');
    const motd = isOnline && status.motdClean
        ? status.motdClean.slice(0, 200)
        : 'Non disponible';
    const ping = isOnline && typeof status.pingMs === 'number'
        ? `${status.pingMs} ms`
        : 'N/A';
    return applyCredit(new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle(config.title)
        .addFields(
            { name: '🟢 Statut', value: isOnline ? 'En ligne' : 'Hors ligne', inline: false },
            { name: '🌐 IP', value: config.host, inline: false },
            { name: '🔌 Port', value: String(config.port), inline: false },
            { name: '👥 Joueurs', value: players, inline: false },
            { name: '🧭 Version', value: version, inline: false },
            { name: '📡 Ping', value: ping, inline: false },
            { name: '📝 MOTD', value: motd, inline: false }
        )
        .setTimestamp());
}

async function fetchMinecraftStatus(config) {
    try {
        const startedAt = Date.now();
        const result = await statusBedrock(config.host, config.port, { timeout: 3000 });
        const pingMs = Date.now() - startedAt;
        return {
            online: true,
            playersOnline: result.players?.online ?? 0,
            playersMax: result.players?.max ?? 0,
            versionName: result.version?.name || 'Inconnu',
            motdClean: result.motd?.clean || result.motd?.raw || '',
            pingMs
        };
    } catch (error) {
        return { online: false };
    }
}

async function sendModLog(guild, embed) {
    const config = getGuildConfig(guild.id);
    if (!config.logChannelId) return;
    const channel = guild.channels.cache.get(config.logChannelId);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({ embeds: [embed] });
}

async function ensurePermissions(interaction, memberPerms, botPerms) {
    if (!interaction.member.permissions.has(memberPerms)) {
        await interaction.reply({ content: '❌ Tu n\'as pas la permission requise.', flags: MessageFlags.Ephemeral });
        return false;
    }
    const me = interaction.guild.members.me;
    if (!me.permissions.has(botPerms)) {
        await interaction.reply({ content: '❌ Il me manque une permission pour cette action.', flags: MessageFlags.Ephemeral });
        return false;
    }
    return true;
}

async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder().setName('ping').setDescription('Afficher la latence du bot'),
        new SlashCommandBuilder().setName('help').setDescription('Afficher la liste des commandes'),
        new SlashCommandBuilder().setName('ip').setDescription('Infos Minecraft (meme que panel mcinfo)'),
        new SlashCommandBuilder()
            .setName('link')
            .setDescription('Lier ton compte Minecraft avec un code')
            .addStringOption(option => option.setName('code').setDescription('Code donne en jeu').setRequired(true)),
        new SlashCommandBuilder()
            .setName('unlink')
            .setDescription('Retirer la liaison Minecraft'),
        new SlashCommandBuilder().setName('server').setDescription('Infos sur le serveur'),
        new SlashCommandBuilder()
            .setName('panel')
            .setDescription('Panneaux d\'information pour les membres')
            .addSubcommand(sub => sub
                .setName('serverinfo')
                .setDescription('Publier le panneau d\'information serveur'))
            .addSubcommand(sub => sub
                .setName('mcinfo')
                .setDescription('Publier le panneau d\'information Minecraft')),
        new SlashCommandBuilder()
            .setName('kick')
            .setDescription('Expulser un membre')
            .addUserOption(option => option.setName('membre').setDescription('Membre a expulser').setRequired(true))
            .addStringOption(option => option.setName('raison').setDescription('Raison')),
        new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Bannir un membre')
            .addUserOption(option => option.setName('membre').setDescription('Membre a bannir').setRequired(true))
            .addStringOption(option => option.setName('raison').setDescription('Raison')),
        new SlashCommandBuilder()
            .setName('unban')
            .setDescription('Debannir un membre par ID')
            .addStringOption(option => option.setName('id').setDescription('ID utilisateur').setRequired(true))
            .addStringOption(option => option.setName('raison').setDescription('Raison')),
        new SlashCommandBuilder()
            .setName('timeout')
            .setDescription('Timeout un membre')
            .addUserOption(option => option.setName('membre').setDescription('Membre a timeout').setRequired(true))
            .addStringOption(option => option.setName('duree').setDescription('Ex: 10m, 1h, 1d').setRequired(true))
            .addStringOption(option => option.setName('raison').setDescription('Raison')),
        new SlashCommandBuilder()
            .setName('clear')
            .setDescription('Supprimer des messages')
            .addIntegerOption(option => option.setName('nombre').setDescription('1 a 100').setRequired(true)),
        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Avertir un membre')
            .addUserOption(option => option.setName('membre').setDescription('Membre a avertir').setRequired(true))
            .addStringOption(option => option.setName('raison').setDescription('Raison')),
        new SlashCommandBuilder()
            .setName('warnings')
            .setDescription('Afficher les avertissements')
            .addUserOption(option => option.setName('membre').setDescription('Membre cible').setRequired(true)),
        new SlashCommandBuilder()
            .setName('unwarn')
            .setDescription('Retirer un avertissement')
            .addUserOption(option => option.setName('membre').setDescription('Membre cible').setRequired(true))
            .addIntegerOption(option => option.setName('index').setDescription('Index du warn (1...)').setRequired(true)),
        new SlashCommandBuilder()
            .setName('clearwarnings')
            .setDescription('Effacer tous les avertissements')
            .addUserOption(option => option.setName('membre').setDescription('Membre cible').setRequired(true)),
        new SlashCommandBuilder()
            .setName('modlog')
            .setDescription('Configurer le salon de logs')
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Definir le salon de logs')
                .addChannelOption(option => option.setName('salon').setDescription('Salon de logs').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('clear')
                .setDescription('Supprimer le salon de logs')),
        new SlashCommandBuilder()
            .setName('config')
            .setDescription('Configurer la moderation')
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('Afficher la configuration'))
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Modifier un parametre')
                .addStringOption(option => option
                    .setName('cle')
                    .setDescription('Parametre a modifier')
                    .setRequired(true)
                    .addChoices(
                        { name: 'automod.enabled', value: 'automod.enabled' },
                        { name: 'automod.blockInvites', value: 'automod.blockInvites' },
                        { name: 'automod.linkAllowedChannelIds', value: 'automod.linkAllowedChannelIds' },
                        { name: 'automod.allowInvitesInLinkChannels', value: 'automod.allowInvitesInLinkChannels' },
                        { name: 'automod.maxMentions', value: 'automod.maxMentions' },
                        { name: 'automod.maxLinks', value: 'automod.maxLinks' },
                        { name: 'automod.maxCapsPercent', value: 'automod.maxCapsPercent' },
                        { name: 'automod.minCapsLength', value: 'automod.minCapsLength' },
                        { name: 'antispam.enabled', value: 'antispam.enabled' },
                        { name: 'antispam.intervalMs', value: 'antispam.intervalMs' },
                        { name: 'antispam.maxMessages', value: 'antispam.maxMessages' },
                        { name: 'antispam.timeoutMs', value: 'antispam.timeoutMs' }
                    ))
                .addStringOption(option => option.setName('valeur').setDescription('Nouvelle valeur').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('reset')
                .setDescription('Reinitialiser la configuration')),
        new SlashCommandBuilder()
            .setName('configpanel')
            .setDescription('Panneau de configuration interactif du serveur'),
        new SlashCommandBuilder()
            .setName('reactionpanel')
            .setDescription('Gerer les panneaux de reaction de roles')
            .addSubcommand(sub => sub
                .setName('create')
                .setDescription('Creer un nouveau panneau')
                .addStringOption(option => option.setName('id').setDescription('ID du panneau (unique par serveur)').setRequired(true))
                .addStringOption(option => option.setName('titre').setDescription('Titre du panneau').setRequired(true))
                .addStringOption(option => option.setName('description').setDescription('Description du panneau').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('delete')
                .setDescription('Supprimer un panneau')
                .addStringOption(option => option.setName('id').setDescription('ID du panneau').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('addrole')
                .setDescription('Ajouter une reaction-role au panneau')
                .addStringOption(option => option.setName('id').setDescription('ID du panneau').setRequired(true))
                .addStringOption(option => option.setName('emoji').setDescription('Emoji (ex: 🎮)').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Role a attribuer').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('removerole')
                .setDescription('Retirer une reaction-role du panneau')
                .addStringOption(option => option.setName('id').setDescription('ID du panneau').setRequired(true))
                .addStringOption(option => option.setName('emoji').setDescription('Emoji').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('publish')
                .setDescription('Publier le panneau dans le salon courant')
                .addStringOption(option => option.setName('id').setDescription('ID du panneau').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('Lister les panneaux')),
        new SlashCommandBuilder()
            .setName('richpresence')
            .setDescription('Gerer ta Rich Presence Discord')
            .addSubcommand(sub => sub
                .setName('enable')
                .setDescription('Activer la Rich Presence (compte Minecraft doit etre lie)'))
            .addSubcommand(sub => sub
                .setName('disable')
                .setDescription('Desactiver la Rich Presence'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('Voir le statut de ta Rich Presence'))
            .addSubcommand(sub => sub
                .setName('stats')
                .setDescription('Statistiques Rich Presence (admins uniquement)'))
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10', timeout: 15000 }).setToken(process.env.DISCORD_TOKEN);
    const guildIds = parseGuildIds();
    if (guildIds.length > 0) {
        for (const guildId of guildIds) {
            console.log(`📤 Enregistrement des commandes pour le serveur ${guildId}...`);
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                { body: commands }
            );
            console.log(`✅ Slash commands synchronisees pour le serveur ${guildId}.`);
        }
        return;
    }

    console.log('📤 Enregistrement global des commandes...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Slash commands synchronisees globalement.');
}

client.once('ready', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    console.log(`📊 Serveurs: ${client.guilds.cache.size}`);
    console.log(`👥 Utilisateurs: ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`);
    console.log(`🔑 Environment: NODE_ENV=${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Port: ${port}`);
    
    // Initialize dynamic presence
    updateBotPresence();
    // Update presence every 30 seconds
    setInterval(updateBotPresence, 30000);

    // Enregistrer les commandes en background (non-bloquant)
    console.log('📝 Enregistrement des slash commands...');
    registerSlashCommands()
        .then(() => {
            console.log('✅ Toutes les commandes ont été enregistrées');
        })
        .catch(error => {
            console.error('❌ Erreur synchronisation commandes:', error.message || error);
            console.error('⚠️ Le bot fonctionnera quand même, mais les commandes peuvent ne pas être à jour');
        });
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        if (interaction.customId === 'panel_serverinfo') {
            const guild = interaction.guild;
            if (!guild) return;
            const embed = buildServerInfoEmbed(guild);
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        return;
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'config_module_select') {
            const guild = interaction.guild;
            if (!guild) return;
            
            const selectedValue = interaction.values[0];
            const config = getGuildConfig(guild.id);
            const embed = buildConfigModuleEmbed(selectedValue, guild, config);
            const selectMenu = getConfigModuleSelectMenu();
            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            await interaction.update({ embeds: [embed], components: [row] });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const guild = interaction.guild;
    if (!guild) return;

    try {
        if (commandName === 'ping') {
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('🏓 Pong!')
                .setDescription(`Latence: ${client.ws.ping}ms`)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('📋 Commandes du Bot')
                .setDescription('Principales commandes de moderation et configuration.')
                .addFields(
                    { name: 'Moderation', value: '/kick /ban /unban /timeout /clear /warn /warnings /unwarn /clearwarnings', inline: false },
                    { name: 'Configuration', value: '/modlog set|clear /config view|set|reset', inline: false },
                    { name: 'Panels membres', value: '/panel serverinfo /panel mcinfo /ip', inline: false },
                    { name: 'Minecraft', value: '/link /unlink', inline: false }
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (commandName === 'server') {
            const embed = buildServerInfoEmbed(guild);
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'panel') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'serverinfo') {
                const embed = applyCredit(new EmbedBuilder()
                    .setColor(PANEL_COLOR)
                    .setTitle(`Information serveur ${guild.name}`)
                    .setDescription('Clique sur le bouton pour afficher les informations du serveur.')
                    .setThumbnail(guild.iconURL({ dynamic: true }))
                    .setTimestamp());
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('panel_serverinfo')
                        .setLabel('Voir les infos')
                        .setStyle(ButtonStyle.Secondary)
                );
                await interaction.reply({ embeds: [embed], components: [row] });
                return;
            }
            if (sub === 'mcinfo') {
                await interaction.deferReply();
                const config = getMinecraftConfig();
                const status = await fetchMinecraftStatus(config);
                const embed = buildMinecraftPanelEmbed(config, status);
                await interaction.editReply({ embeds: [embed] });
                return;
            }
        }

        if (commandName === 'ip') {
            await interaction.deferReply();
            const config = getMinecraftConfig();
            const status = await fetchMinecraftStatus(config);
            const embed = buildMinecraftPanelEmbed(config, status);
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (commandName === 'link') {
            pruneExpiredCodes();
            const code = interaction.options.getString('code', true).trim().toUpperCase();
            const entry = linkCodes[code];
            if (!entry || typeof entry.expiresAt !== 'number' || entry.expiresAt <= Date.now()) {
                delete linkCodes[code];
                saveLinkCodes();
                return interaction.reply({ content: '❌ Code invalide ou expire.', flags: MessageFlags.Ephemeral });
            }
            const linked = linkDiscordToGamertag(interaction.user.id, entry.gamertag);
            delete linkCodes[code];
            saveLinkCodes();
            if (!linked) {
                return interaction.reply({ content: '❌ Gamertag invalide.', flags: MessageFlags.Ephemeral });
            }
            
            // Activer la Rich Presence pour le joueur
            try {
                const mcConfig = getMinecraftConfig();
                await presenceManager.updateMinecraftPresence(interaction.user.id, {
                    gamertag: linked.gamertag,
                    world: 'Serveur Elyndra',
                    level: 1
                });
                console.log(`🎮 Rich Presence activée pour ${interaction.user.tag} (${linked.gamertag})`);
            } catch (error) {
                console.error('⚠️ Erreur activation Rich Presence:', error.message);
            }
            
            return interaction.reply({ content: `✅ Compte lie a ${linked.gamertag}.\n🎮 Rich Presence activée!`, flags: MessageFlags.Ephemeral });
        }

        if (commandName === 'unlink') {
            const removed = unlinkByDiscordId(interaction.user.id);
            if (!removed) {
                return interaction.reply({ content: '❌ Aucune liaison trouvee.', flags: MessageFlags.Ephemeral });
            }
            
            // Désactiver la Rich Presence
            try {
                await presenceManager.disconnectUser(interaction.user.id);
                console.log(`🔌 Rich Presence désactivée pour ${interaction.user.tag}`);
            } catch (error) {
                console.error('⚠️ Erreur désactivation Rich Presence:', error.message);
            }
            
            return interaction.reply({ content: '✅ Liaison supprimee.\n🔌 Rich Presence désactivée.', flags: MessageFlags.Ephemeral });
        }

        if (commandName === 'kick') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.KickMembers, PermissionFlagsBits.KickMembers))) return;
            const target = interaction.options.getUser('membre', true);
            const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
            const member = guild.members.cache.get(target.id);
            if (!member) return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
            if (member.id === interaction.user.id) return interaction.reply({ content: '❌ Action sur soi impossible.', flags: MessageFlags.Ephemeral });
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: '❌ Rôle supérieur ou égal.', flags: MessageFlags.Ephemeral });
            }
            await member.kick(reason);
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('👢 Membre expulsé')
                .setDescription(`${target.tag} a été expulsé`)
                .addFields({ name: 'Raison', value: reason }, { name: 'Modérateur', value: interaction.user.tag })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            await sendModLog(guild, embed);
            return;
        }

        if (commandName === 'ban') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.BanMembers, PermissionFlagsBits.BanMembers))) return;
            const target = interaction.options.getUser('membre', true);
            const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
            const member = guild.members.cache.get(target.id);
            if (!member) return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
            if (member.id === interaction.user.id) return interaction.reply({ content: '❌ Action sur soi impossible.', flags: MessageFlags.Ephemeral });
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: '❌ Rôle supérieur ou égal.', flags: MessageFlags.Ephemeral });
            }
            await member.ban({ reason, deleteMessageDays: 1 });
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('🔨 Membre banni')
                .setDescription(`${target.tag} a été banni`)
                .addFields({ name: 'Raison', value: reason }, { name: 'Modérateur', value: interaction.user.tag })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            await sendModLog(guild, embed);
            return;
        }

        if (commandName === 'unban') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.BanMembers, PermissionFlagsBits.BanMembers))) return;
            const userId = interaction.options.getString('id', true);
            const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
            await guild.members.unban(userId, reason);
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('✅ Membre débanni')
                .setDescription(`ID: ${userId}`)
                .addFields({ name: 'Raison', value: reason }, { name: 'Modérateur', value: interaction.user.tag })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            await sendModLog(guild, embed);
            return;
        }

        if (commandName === 'timeout') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ModerateMembers))) return;
            const target = interaction.options.getUser('membre', true);
            const duration = interaction.options.getString('duree', true);
            const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
            const member = guild.members.cache.get(target.id);
            if (!member) return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
            if (member.id === interaction.user.id) return interaction.reply({ content: '❌ Action sur soi impossible.', flags: MessageFlags.Ephemeral });
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: '❌ Rôle supérieur ou égal.', flags: MessageFlags.Ephemeral });
            }
            const milliseconds = parseDuration(duration);
            if (!milliseconds) {
                return interaction.reply({ content: '❌ Durée invalide (ex: 10m, 1h, 1d).', flags: MessageFlags.Ephemeral });
            }
            if (milliseconds > 28 * 24 * 60 * 60 * 1000) {
                return interaction.reply({ content: '❌ Durée maximale: 28 jours.', flags: MessageFlags.Ephemeral });
            }
            await member.timeout(milliseconds, reason);
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('⏰ Timeout')
                .setDescription(`${target.tag} a été mis en timeout`)
                .addFields(
                    { name: 'Durée', value: duration },
                    { name: 'Raison', value: reason },
                    { name: 'Modérateur', value: interaction.user.tag }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            await sendModLog(guild, embed);
            return;
        }

        if (commandName === 'clear') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageMessages))) return;
            const amount = interaction.options.getInteger('nombre', true);
            if (amount < 1 || amount > 100) {
                return interaction.reply({ content: '❌ Nombre entre 1 et 100.', flags: MessageFlags.Ephemeral });
            }
            const deleted = await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({ content: `✅ ${deleted.size} message(s) supprimé(s).`, flags: MessageFlags.Ephemeral });
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('🧹 Purge')
                .setDescription(`${deleted.size} message(s) supprimé(s)`)
                .addFields({ name: 'Modérateur', value: interaction.user.tag })
                .setTimestamp();
            await sendModLog(guild, embed);
            return;
        }

        if (commandName === 'warn') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ModerateMembers))) return;
            const target = interaction.options.getUser('membre', true);
            const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
            const warnList = getWarnings(guild.id, target.id);
            warnList.push({ reason, moderatorId: interaction.user.id, timestamp: Date.now() });
            saveWarnings();
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('⚠️ Avertissement')
                .setDescription(`${target.tag} a reçu un avertissement`)
                .addFields({ name: 'Raison', value: reason }, { name: 'Modérateur', value: interaction.user.tag })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            await sendModLog(guild, embed);
            return;
        }

        if (commandName === 'warnings') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ModerateMembers))) return;
            const target = interaction.options.getUser('membre', true);
            const warnList = getWarnings(guild.id, target.id);
            const formatted = warnList.length
                ? warnList.map((warn, index) => `${index + 1}. ${warn.reason} (par <@${warn.moderatorId}>)`).slice(0, 10).join('\n')
                : 'Aucun avertissement.';
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle(`📒 Avertissements de ${target.tag}`)
                .setDescription(formatted)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (commandName === 'unwarn') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ModerateMembers))) return;
            const target = interaction.options.getUser('membre', true);
            const index = interaction.options.getInteger('index', true) - 1;
            const warnList = getWarnings(guild.id, target.id);
            if (index < 0 || index >= warnList.length) {
                return interaction.reply({ content: '❌ Index invalide.', flags: MessageFlags.Ephemeral });
            }
            const removed = warnList.splice(index, 1)[0];
            saveWarnings();
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('✅ Avertissement retiré')
                .setDescription(`${target.tag}`)
                .addFields({ name: 'Raison', value: removed.reason }, { name: 'Modérateur', value: interaction.user.tag })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            await sendModLog(guild, embed);
            return;
        }

        if (commandName === 'clearwarnings') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ModerateMembers))) return;
            const target = interaction.options.getUser('membre', true);
            getWarnings(guild.id, target.id);
            warningsStore[guild.id][target.id] = [];
            saveWarnings();
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('✅ Avertissements effacés')
                .setDescription(`${target.tag}`)
                .addFields({ name: 'Modérateur', value: interaction.user.tag })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            await sendModLog(guild, embed);
            return;
        }

        if (commandName === 'modlog') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageGuild))) return;
            const config = getGuildConfig(guild.id);
            const sub = interaction.options.getSubcommand();
            if (sub === 'set') {
                const channel = interaction.options.getChannel('salon', true);
                config.logChannelId = channel.id;
                saveGuildConfig(guild.id, config);
                return interaction.reply({ content: `✅ Salon de logs: ${channel}.`, flags: MessageFlags.Ephemeral });
            }
            if (sub === 'clear') {
                config.logChannelId = null;
                saveGuildConfig(guild.id, config);
                return interaction.reply({ content: '✅ Salon de logs supprimé.', flags: MessageFlags.Ephemeral });
            }
        }

        if (commandName === 'config') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageGuild))) return;
            const config = getGuildConfig(guild.id);
            const sub = interaction.options.getSubcommand();
            if (sub === 'view') {
                const embed = new EmbedBuilder()
                    .setColor(PANEL_COLOR)
                    .setTitle('⚙️ Configuration de modération')
                    .addFields(
                        { name: 'Automod', value: `enabled=${config.automod.enabled}\nblockInvites=${config.automod.blockInvites}\nlinkAllowedChannelIds=${(config.automod.linkAllowedChannelIds || []).join(',') || 'aucun'}\nallowInvitesInLinkChannels=${config.automod.allowInvitesInLinkChannels}\nmaxMentions=${config.automod.maxMentions}\nmaxLinks=${config.automod.maxLinks}\nmaxCapsPercent=${config.automod.maxCapsPercent}\nminCapsLength=${config.automod.minCapsLength}`, inline: false },
                        { name: 'Anti-spam', value: `enabled=${config.antispam.enabled}\nintervalMs=${config.antispam.intervalMs}\nmaxMessages=${config.antispam.maxMessages}\ntimeoutMs=${config.antispam.timeoutMs}`, inline: false },
                        { name: 'Logs', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Non defini', inline: false }
                    )
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
            if (sub === 'set') {
                const key = interaction.options.getString('cle', true);
                const value = interaction.options.getString('valeur', true);
                let parsedValue = value;
                if (key === 'automod.linkAllowedChannelIds') {
                    const normalized = value.trim();
                    parsedValue = normalized
                        ? normalized.split(',').map(entry => entry.trim()).filter(Boolean)
                        : [];
                } else if (key.includes('enabled') || key.includes('blockInvites') || key.includes('allowInvitesInLinkChannels')) {
                    const boolValue = parseBoolean(value);
                    if (boolValue === null) {
                        return interaction.reply({ content: '❌ Valeur booleenne invalide (true/false).', flags: MessageFlags.Ephemeral });
                    }
                    parsedValue = boolValue;
                } else {
                    const intValue = parseInt(value, 10);
                    if (Number.isNaN(intValue)) {
                        return interaction.reply({ content: '❌ Valeur numerique requise.', flags: MessageFlags.Ephemeral });
                    }
                    parsedValue = intValue;
                }

                if (key.startsWith('automod.')) {
                    config.automod[key.split('.')[1]] = parsedValue;
                } else if (key.startsWith('antispam.')) {
                    config.antispam[key.split('.')[1]] = parsedValue;
                }
                saveGuildConfig(guild.id, config);
                return interaction.reply({ content: `✅ ${key} mis a jour.`, flags: MessageFlags.Ephemeral });
            }
            if (sub === 'reset') {
                saveGuildConfig(guild.id, JSON.parse(JSON.stringify(defaultGuildConfig)));
                return interaction.reply({ content: '✅ Configuration reinitialisee.', flags: MessageFlags.Ephemeral });
            }
        }

        if (commandName === 'configpanel') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageGuild))) return;
            
            // Vérifier que l'utilisateur a le rôle requis
            if (!interaction.member.roles.cache.has(CONFIG_PANEL_ROLE_ID)) {
                return interaction.reply({ content: '❌ Tu n\'as pas le rôle requis pour accéder au panel de configuration.', flags: MessageFlags.Ephemeral });
            }
            
            const config = getGuildConfig(guild.id);
            const mainEmbed = buildConfigPanelEmbed(guild);
            const selectMenu = getConfigModuleSelectMenu();
            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            await interaction.reply({ embeds: [mainEmbed], components: [row], flags: MessageFlags.Ephemeral });
            return;
        }

        if (commandName === 'reactionpanel') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageRoles))) return;
            const sub = interaction.options.getSubcommand();

            if (sub === 'create') {
                const panelId = interaction.options.getString('id', true).trim();
                const titre = interaction.options.getString('titre', true);
                const description = interaction.options.getString('description', true);

                if (getReactionPanel(guild.id, panelId)) {
                    return interaction.reply({ content: `❌ Un panneau avec l'ID '${panelId}' existe deja.`, flags: MessageFlags.Ephemeral });
                }

                createReactionPanel(guild.id, panelId, titre, description);
                const embed = new EmbedBuilder()
                    .setColor(PANEL_COLOR)
                    .setTitle('✅ Panneau cree')
                    .addFields(
                        { name: 'ID', value: panelId },
                        { name: 'Titre', value: titre },
                        { name: 'Description', value: description }
                    );
                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            if (sub === 'delete') {
                const panelId = interaction.options.getString('id', true).trim();
                if (!deleteReactionPanel(guild.id, panelId)) {
                    return interaction.reply({ content: `❌ Panneau '${panelId}' non trouve.`, flags: MessageFlags.Ephemeral });
                }
                return interaction.reply({ content: `✅ Panneau '${panelId}' supprime.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'addrole') {
                const panelId = interaction.options.getString('id', true).trim();
                const emoji = interaction.options.getString('emoji', true).trim();
                const role = interaction.options.getRole('role', true);

                if (!getReactionPanel(guild.id, panelId)) {
                    return interaction.reply({ content: `❌ Panneau '${panelId}' non trouve.`, flags: MessageFlags.Ephemeral });
                }

                if (!addReactionRole(guild.id, panelId, emoji, role.id)) {
                    return interaction.reply({ content: `❌ Erreur lors de l'ajout du role au panneau.`, flags: MessageFlags.Ephemeral });
                }

                return interaction.reply({ content: `✅ Role ${role} ajoute avec l'emoji ${emoji}.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'removerole') {
                const panelId = interaction.options.getString('id', true).trim();
                const emoji = interaction.options.getString('emoji', true).trim();

                if (!removeReactionRole(guild.id, panelId, emoji)) {
                    return interaction.reply({ content: `❌ Emoji non trouve pour ce panneau.`, flags: MessageFlags.Ephemeral });
                }

                return interaction.reply({ content: `✅ Emoji ${emoji} retire du panneau.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'publish') {
                const panelId = interaction.options.getString('id', true).trim();
                const panel = getReactionPanel(guild.id, panelId);

                if (!panel) {
                    return interaction.reply({ content: `❌ Panneau '${panelId}' non trouve.`, flags: MessageFlags.Ephemeral });
                }

                const embed = new EmbedBuilder()
                    .setColor(PANEL_COLOR)
                    .setTitle(panel.title)
                    .setDescription(panel.description);

                if (Object.keys(panel.reactions).length > 0) {
                    const reactionsText = Object.entries(panel.reactions)
                        .map(([emoji, roleId]) => `${emoji} = <@&${roleId}>`)
                        .join('\n');
                    embed.addFields({ name: 'Reactions auto-roles', value: reactionsText });
                }

                const sentMessage = await interaction.channel.send({ embeds: [embed] });

                // Add reactions to the message
                for (const emoji of Object.keys(panel.reactions)) {
                    await sentMessage.react(emoji).catch(() => {});
                }

                updatePanelMessage(guild.id, panelId, sentMessage.id, interaction.channel.id);

                return interaction.reply({ content: `✅ Panneau publie! Les utilisateurs peuvent maintenant reagir.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'list') {
                const panels = reactionPanels.panels[guild.id] || {};
                const panelCount = Object.keys(panels).length;

                if (panelCount === 0) {
                    return interaction.reply({ content: '❌ Aucun panneau pour ce serveur.', flags: MessageFlags.Ephemeral });
                }

                const embed = new EmbedBuilder()
                    .setColor(PANEL_COLOR)
                    .setTitle('📋 Panneaux de reaction-roles');

                for (const [id, panel] of Object.entries(panels)) {
                    const rolesCount = Object.keys(panel.reactions).length;
                    const status = panel.messageId ? '✅ Publie' : '⏳ Brouillon';
                    embed.addFields({ name: id, value: `${panel.title}\n${rolesCount} role(s)\n${status}`, inline: true });
                }

                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
        }

        if (commandName === 'richpresence') {
            const sub = interaction.options.getSubcommand();

            if (sub === 'enable') {
                // Vérifier si le compte est lié
                const linkedAccount = linksStore.byDiscordId[interaction.user.id];
                if (!linkedAccount) {
                    return interaction.reply({ 
                        content: '❌ Tu dois d\'abord lier ton compte Minecraft avec `/link`', 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                try {
                    // Obtenir les infos du serveur Minecraft
                    const mcConfig = getMinecraftConfig();
                    let mcStatus = null;
                    try {
                        mcStatus = await fetchMinecraftStatus(mcConfig);
                    } catch (err) {
                        console.warn('⚠️ Impossible d\'obtenir le statut du serveur:', err.message);
                    }

                    await presenceManager.updateMinecraftPresence(interaction.user.id, {
                        gamertag: linkedAccount.gamertag,
                        world: 'Serveur Elyndra',
                        level: 1,
                        onlinePlayers: mcStatus?.onlinePlayers || 0,
                        maxPlayers: mcStatus?.maxPlayers || 20
                    });

                    const embed = new EmbedBuilder()
                        .setColor(PANEL_COLOR)
                        .setTitle('🎮 Rich Presence activée')
                        .setDescription('Ta Rich Presence Discord affiche maintenant ton statut Minecraft!')
                        .addFields(
                            { name: 'Gamertag', value: linkedAccount.gamertag, inline: true },
                            { name: 'Statut', value: '✅ Actif', inline: true }
                        )
                        .setTimestamp();

                    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

                } catch (error) {
                    console.error('❌ Erreur activation Rich Presence:', error);
                    return interaction.reply({ 
                        content: '❌ Erreur lors de l\'activation de la Rich Presence. Assure-toi que ton compte Discord est bien configuré.', 
                        flags: MessageFlags.Ephemeral 
                    });
                }
            }

            if (sub === 'disable') {
                try {
                    await presenceManager.disconnectUser(interaction.user.id);
                    
                    const embed = new EmbedBuilder()
                        .setColor(PANEL_COLOR)
                        .setTitle('🔌 Rich Presence désactivée')
                        .setDescription('Ta Rich Presence a été désactivée avec succès.')
                        .setTimestamp();

                    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

                } catch (error) {
                    console.error('❌ Erreur désactivation Rich Presence:', error);
                    return interaction.reply({ 
                        content: '❌ Erreur lors de la désactivation.', 
                        flags: MessageFlags.Ephemeral 
                    });
                }
            }

            if (sub === 'status') {
                const linkedAccount = linksStore.byDiscordId[interaction.user.id];
                const isActive = presenceManager.clients.has(interaction.user.id);
                const playerData = presenceManager.playerData.get(interaction.user.id);

                const embed = new EmbedBuilder()
                    .setColor(PANEL_COLOR)
                    .setTitle('🎮 Statut Rich Presence')
                    .addFields(
                        { name: 'Compte lié', value: linkedAccount ? `✅ ${linkedAccount.gamertag}` : '❌ Non lié', inline: true },
                        { name: 'Rich Presence', value: isActive ? '✅ Active' : '❌ Inactive', inline: true }
                    );

                if (isActive && playerData) {
                    embed.addFields(
                        { name: 'État actuel', value: playerData.state || 'N/A', inline: false },
                        { name: 'Détails', value: playerData.details || 'N/A', inline: false }
                    );
                }

                embed.setTimestamp();
                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            if (sub === 'stats') {
                // Vérifier les permissions d'admin
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ 
                        content: '❌ Cette commande est réservée aux administrateurs.', 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                const stats = presenceManager.getStats();
                const embed = new EmbedBuilder()
                    .setColor(PANEL_COLOR)
                    .setTitle('📊 Statistiques Rich Presence')
                    .addFields(
                        { name: 'Connexions actives', value: `${stats.activeConnections}`, inline: true },
                        { name: 'Config', value: presenceManager.config.enabled ? '✅ Activée' : '❌ Désactivée', inline: true }
                    )
                    .setTimestamp();

                if (stats.connectedUsers.length > 0) {
                    const users = stats.connectedUsers.slice(0, 10).map(id => `<@${id}>`).join(', ');
                    embed.addFields({ name: 'Utilisateurs connectés', value: users, inline: false });
                }

                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
        }
    } catch (error) {
        console.error('Erreur commande:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Erreur lors de l\'execution de la commande.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.editReply({ content: '❌ Erreur lors de l\'execution de la commande.' }).catch(() => {});
    }
});

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;
    const config = getGuildConfig(message.guild.id);

    if (config.automod.enabled) {
        const mentionsCount = message.mentions.users.size;
        const linksCount = countLinks(message.content);
        const capsRatio = capsPercent(message.content);
        const capsLength = message.content.replace(/[^A-Z]/g, '').length;
        const linkAllowedChannelIds = Array.isArray(config.automod.linkAllowedChannelIds)
            ? config.automod.linkAllowedChannelIds
            : [];
        const isLinkAllowedChannel = linkAllowedChannelIds.includes(message.channel.id);

        if (config.automod.blockInvites
            && (!isLinkAllowedChannel || !config.automod.allowInvitesInLinkChannels)
            && hasInvite(message.content)) {
            await message.delete().catch(() => {});
            await message.channel.send('❌ Lien d\'invitation interdit.').then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('🚫 Invitation bloquee')
                .setDescription(`${message.author.tag} a tente de poster une invite.`)
                .setTimestamp();
            await sendModLog(message.guild, embed);
            return;
        }

        if (mentionsCount > config.automod.maxMentions) {
            await message.delete().catch(() => {});
            await message.channel.send('❌ Trop de mentions.').then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('🚫 Mention spam')
                .setDescription(`${message.author.tag} a excede les mentions.`)
                .setTimestamp();
            await sendModLog(message.guild, embed);
            return;
        }

        if (!isLinkAllowedChannel && linksCount > config.automod.maxLinks) {
            await message.delete().catch(() => {});
            await message.channel.send('❌ Trop de liens.').then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('🚫 Spam de liens')
                .setDescription(`${message.author.tag} a excede les liens.`)
                .setTimestamp();
            await sendModLog(message.guild, embed);
            return;
        }

        if (capsLength >= config.automod.minCapsLength && capsRatio > config.automod.maxCapsPercent) {
            await message.delete().catch(() => {});
            await message.channel.send('❌ Trop de majuscules.').then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('🚫 Caps spam')
                .setDescription(`${message.author.tag} a abuse des majuscules.`)
                .setTimestamp();
            await sendModLog(message.guild, embed);
            return;
        }
    }

    if (config.antispam.enabled) {
        const guildCache = antiSpamCache.get(message.guild.id) || new Map();
        const timestamps = guildCache.get(message.author.id) || [];
        const now = Date.now();
        const windowStart = now - config.antispam.intervalMs;
        const recent = timestamps.filter(ts => ts > windowStart);
        recent.push(now);
        guildCache.set(message.author.id, recent);
        antiSpamCache.set(message.guild.id, guildCache);

        if (recent.length > config.antispam.maxMessages) {
            await message.delete().catch(() => {});
            const member = message.guild.members.cache.get(message.author.id);
            if (member && member.moderatable) {
                await member.timeout(config.antispam.timeoutMs, 'Anti-spam automatique').catch(() => {});
            }
            await message.channel.send('❌ Anti-spam: ralentis un peu.').then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
            const embed = new EmbedBuilder()
                .setColor(PANEL_COLOR)
                .setTitle('🚫 Anti-spam')
                .setDescription(`${message.author.tag} a spam.`)
                .setTimestamp();
            await sendModLog(message.guild, embed);
        }
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (!reaction.message.guild) return;

    try {
        const panelInfo = getReactionPanelByMessage(reaction.message.guild.id, reaction.message.id);
        if (!panelInfo) return;

        const { panelId, panel } = panelInfo;
        const emoji = reaction.emoji.toString();
        const roleId = panel.reactions[emoji];

        if (!roleId) {
            await reaction.users.remove(user.id).catch(() => {});
            return;
        }

        const role = reaction.message.guild.roles.cache.get(roleId);
        if (!role) return;

        const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        await member.roles.add(role).catch(() => {});
    } catch (error) {
        console.error('Erreur reaction add:', error);
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (!reaction.message.guild) return;

    try {
        const panelInfo = getReactionPanelByMessage(reaction.message.guild.id, reaction.message.id);
        if (!panelInfo) return;

        const { panelId, panel } = panelInfo;
        const emoji = reaction.emoji.toString();
        const roleId = panel.reactions[emoji];

        if (!roleId) return;

        const role = reaction.message.guild.roles.cache.get(roleId);
        if (!role) return;

        const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        await member.roles.remove(role).catch(() => {});
    } catch (error) {
        console.error('Erreur reaction remove:', error);
    }
});

client.on('error', console.error);

function isAuthorized(req) {
    if (!LINK_SECRET) return true;
    return req.headers['x-link-secret'] === LINK_SECRET;
}

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
            if (data.length > 1024 * 1024) {
                reject(new Error('Payload too large'));
                req.destroy();
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

const port = Number.parseInt(process.env.PORT, 10) || 3000;
http
    .createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        if (req.method === 'GET' && url.pathname === '/health') {
            return sendJson(res, 200, { status: 'ok' });
        }

        if (!isAuthorized(req)) {
            return sendJson(res, 401, { error: 'unauthorized' });
        }

        if (req.method === 'GET' && url.pathname === '/link/resolve') {
            const gamertag = url.searchParams.get('gamertag');
            const normalized = normalizeGamertag(gamertag);
            if (!normalized) return sendJson(res, 400, { error: 'gamertag_required' });
            const entry = linksStore.byGamertag[normalized];
            if (!entry) return sendJson(res, 200, { linked: false });
            const group = client.isReady()
                ? await resolveGroupForDiscord(entry.discordId)
                : null;
            return sendJson(res, 200, {
                linked: true,
                gamertag: entry.gamertag,
                discordId: entry.discordId,
                group
            });
        }

        if (req.method === 'POST' && url.pathname === '/link/code') {
            try {
                const raw = await readRequestBody(req);
                const body = raw ? JSON.parse(raw) : {};
                const gamertag = String(body.gamertag || '').trim();
                if (!gamertag) return sendJson(res, 400, { error: 'gamertag_required' });
                pruneExpiredCodes();
                const code = generateLinkCode();
                linkCodes[code] = {
                    gamertag,
                    createdAt: Date.now(),
                    expiresAt: Date.now() + LINK_CODE_TTL_MS
                };
                saveLinkCodes();
                return sendJson(res, 200, { code, expiresAt: linkCodes[code].expiresAt });
            } catch (error) {
                return sendJson(res, 400, { error: 'invalid_json' });
            }
        }

        if (req.method === 'POST' && url.pathname === '/link/unlink') {
            try {
                const raw = await readRequestBody(req);
                const body = raw ? JSON.parse(raw) : {};
                const gamertag = String(body.gamertag || '').trim();
                const discordId = String(body.discordId || '').trim();
                if (!gamertag && !discordId) return sendJson(res, 400, { error: 'identifier_required' });
                const removed = gamertag
                    ? unlinkByGamertag(gamertag)
                    : unlinkByDiscordId(discordId);
                return sendJson(res, 200, { removed });
            } catch (error) {
                return sendJson(res, 400, { error: 'invalid_json' });
            }
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    })
    .listen(port, '0.0.0.0', () => {
        console.log(`🌐 HTTP server listening on ${port}`);
    });

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

client.on('shardError', error => {
    console.error('WebSocket connection error:', error);
});

client.on('shardDisconnect', (closeCode, shardId) => {
    console.warn(`⚠️ Shard ${shardId} disconnected with code ${closeCode}`);
});

client.on('warn', message => {
    console.warn('⚠️ Warning:', message);
});

// Capture les messages de debug discord.js (très verbeux)
client.on('debug', message => {
    if (message.includes('invalid') || message.includes('token') || message.includes('auth')) {
        console.debug('🐛 DEBUG:', message);
    }
});

// Si le token est invalide
client.once('invalidated', () => {
    console.error('❌ Token invalidé! Le bot doit être redémarré.');
    process.exit(1);
});

// Reconnexion
client.on('shardResume', shardId => {
    console.log(`✅ Shard ${shardId} reconnecté`);
});

client.on('shardDisconnect', (closeCode, shardId) => {
    console.warn(`⚠️ Shard ${shardId} disconnected with code ${closeCode}`);
});

console.log('🔄 Connexion à Discord...');
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN manquant dans .env');
    process.exit(1);
}

const tokenLength = process.env.DISCORD_TOKEN.length;
const tokenPreview = process.env.DISCORD_TOKEN.substring(0, 20) + '...';
console.log(`📝 Token recevé (longueur: ${tokenLength}, aperçu: ${tokenPreview})`);

console.log('📋 Configuration:');
console.log(`   • Client ID: ${process.env.CLIENT_ID || 'non défini'}`);
console.log(`   • Guild IDs: ${process.env.GUILD_ID || 'non défini'}`);
console.log(`   • PORT: ${port}`);
console.log(`   • NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

// Timeout si le bot ne se connecte pas dans 10 secondes
const loginTimeout = setTimeout(() => {
    if (!client.isReady()) {
        console.error('');
        console.error('❌ ERREUR: Le bot n\'a pas pu se connecter à Discord après 10 secondes');
        console.error('');
        console.error('🔍 Causes possibles:');
        console.error('   1. ❌ Variables d\'environnement manquantes sur Render');
        console.error('   2. ❌ Token Discord invalide ou expiré');
        console.error('   3. ❌ Privileged Gateway Intents non activés');
        console.error('   4. ❌ Problème de connectivité réseau');
        console.error('');
        console.error('✅ Solutions:');
        console.error('   1. Allez sur Dashboard Render > Environment > Ajouter:');
        console.error('      - DISCORD_TOKEN=<votre_token>');
        console.error('      - CLIENT_ID=1469054263647928452');
        console.error('      - GUILD_ID=1250098388750438501,1459716898940784844');
        console.error('   2. Régénérez le token dans Discord Developer Portal si expiré');
        console.error('   3. Activez les Intents: Message Content, Server Members');
        console.error('   4. Vérifiez votre connexion réseau');
        console.error('');
        console.error('⚠️ Le serveur HTTP reste actif pour le health check Render');
        console.error('⚠️ Le bot tentera de se reconnecter automatiquement');
    }
}, 10000);

console.log('🚀 Tentative de connexion au serveur Discord...');
console.log(`   En cours avec token (${tokenLength} caractères)`);
console.log(`   Client ID: ${process.env.CLIENT_ID}`);

client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log('✅ Login effectué avec succès');
        clearTimeout(loginTimeout);
    })
    .catch(error => {
        console.error('❌ Erreur de login:', error.message || error);
        if (error.code === 'ERR_INVALID_TOKEN') {
            console.error('💥 Token invalide! Vérifiez qu\'il est correct dans les variables d\'environnement Render.');
        } else if (error.code === 'INVALID_TOKEN') {
            console.error('💥 Token invalide (Discord error)! Régénérez le token.');
        }
        console.error('⚠️ Le serveur HTTP reste actif, mais le bot Discord n\'est pas connecté.');
        console.error('⚠️ Corrigez le token et redéployez sur Render.');
        clearTimeout(loginTimeout);
        // NE PAS exit pour que Render considère le service comme actif
    });

// Heartbeat pour confirmer que le processus est vivant
setInterval(() => {
    const status = client.isReady() ? '✅ Connecté' : '⏳ En connexion...';
    console.log(`💓 Heartbeat: ${status} | ${new Date().toISOString()}`);
}, 30000);
