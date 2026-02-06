require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { statusBedrock } = require('minecraft-server-util');
const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
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
const MC_CONFIG_PATH = path.join(CONFIG_DIR, 'minecraft.json');
const TIME_REGEX = /^(\d+)([smhd])$/;
const PANEL_COLOR = '#f1c40f';
const CREDIT_TEXT = 'aimbot.sprx';
const CREDIT_ICON_URL = 'https://cdn.discordapp.com/avatars/396332601717293056/05cc4947c620300904d645739e53f8d7.png?size=1024';
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_SECRET = process.env.LINK_SECRET || '';
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

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
ensureConfigFile(MC_CONFIG_PATH, defaultMinecraftConfig);

const guildConfigs = readJson(CONFIG_PATH, {});
const warningsStore = readJson(WARNINGS_PATH, {});
const linksStore = readJson(LINKS_PATH, { byGamertag: {}, byDiscordId: {} });
const linkCodes = readJson(LINK_CODES_PATH, {});
const roleMap = readJson(ROLE_MAP_PATH, defaultRoleMap);

function getGuildConfig(guildId) {
    if (!guildConfigs[guildId]) {
        guildConfigs[guildId] = JSON.parse(JSON.stringify(defaultGuildConfig));
        writeJson(CONFIG_PATH, guildConfigs);
    }
    return guildConfigs[guildId];
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
                .setDescription('Reinitialiser la configuration'))
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const guildIds = parseGuildIds();
    if (guildIds.length > 0) {
        for (const guildId of guildIds) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                { body: commands }
            );
            console.log(`✅ Slash commands synchronisees pour le serveur ${guildId}.`);
        }
        return;
    }

    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Slash commands synchronisees globalement.');
}

client.once('clientReady', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    console.log(`📊 Serveurs: ${client.guilds.cache.size}`);
    console.log(`👥 Utilisateurs: ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`);
    client.user.setActivity('/help pour les commandes', { type: 3 });

    try {
        await registerSlashCommands();
    } catch (error) {
        console.error('Erreur synchronisation commandes:', error);
    }
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
            return interaction.reply({ content: `✅ Compte lie a ${linked.gamertag}.`, flags: MessageFlags.Ephemeral });
        }

        if (commandName === 'unlink') {
            const removed = unlinkByDiscordId(interaction.user.id);
            if (!removed) {
                return interaction.reply({ content: '❌ Aucune liaison trouvee.', flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({ content: '✅ Liaison supprimee.', flags: MessageFlags.Ephemeral });
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
                        { name: 'Automod', value: `enabled=${config.automod.enabled}\nblockInvites=${config.automod.blockInvites}\nmaxMentions=${config.automod.maxMentions}\nmaxLinks=${config.automod.maxLinks}\nmaxCapsPercent=${config.automod.maxCapsPercent}\nminCapsLength=${config.automod.minCapsLength}`, inline: false },
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
                if (key.includes('enabled') || key.includes('blockInvites')) {
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

        if (config.automod.blockInvites && hasInvite(message.content)) {
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

        if (linksCount > config.automod.maxLinks) {
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
    .listen(port, () => {
        console.log(`🌐 HTTP server listening on ${port}`);
    });

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);
