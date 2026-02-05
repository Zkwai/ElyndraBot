require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    EmbedBuilder,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const WARNINGS_PATH = path.join(DATA_DIR, 'warnings.json');
const TIME_REGEX = /^(\d+)([smhd])$/;

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

const guildConfigs = readJson(CONFIG_PATH, {});
const warningsStore = readJson(WARNINGS_PATH, {});

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

async function sendModLog(guild, embed) {
    const config = getGuildConfig(guild.id);
    if (!config.logChannelId) return;
    const channel = guild.channels.cache.get(config.logChannelId);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({ embeds: [embed] });
}

async function ensurePermissions(interaction, memberPerms, botPerms) {
    if (!interaction.member.permissions.has(memberPerms)) {
        await interaction.reply({ content: '❌ Tu n\'as pas la permission requise.', ephemeral: true });
        return false;
    }
    const me = interaction.guild.members.me;
    if (!me.permissions.has(botPerms)) {
        await interaction.reply({ content: '❌ Il me manque une permission pour cette action.', ephemeral: true });
        return false;
    }
    return true;
}

async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder().setName('ping').setDescription('Afficher la latence du bot'),
        new SlashCommandBuilder().setName('help').setDescription('Afficher la liste des commandes'),
        new SlashCommandBuilder().setName('server').setDescription('Infos sur le serveur'),
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
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
}

client.once('clientReady', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    console.log(`📊 Serveurs: ${client.guilds.cache.size}`);
    console.log(`👥 Utilisateurs: ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`);
    client.user.setActivity('/help pour les commandes', { type: 3 });

    try {
        await registerSlashCommands();
        console.log('✅ Slash commands synchronisees.');
    } catch (error) {
        console.error('Erreur synchronisation commandes:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const guild = interaction.guild;
    if (!guild) return;

    try {
        if (commandName === 'ping') {
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🏓 Pong!')
                .setDescription(`Latence: ${client.ws.ping}ms`)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📋 Commandes du Bot')
                .setDescription('Principales commandes de moderation et configuration.')
                .addFields(
                    { name: 'Moderation', value: '/kick /ban /unban /timeout /clear /warn /warnings /unwarn /clearwarnings', inline: false },
                    { name: 'Configuration', value: '/modlog set|clear /config view|set|reset', inline: false }
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (commandName === 'server') {
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`📊 Informations sur ${guild.name}`)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: '👑 Propriétaire', value: `<@${guild.ownerId}>`, inline: true },
                    { name: '👥 Membres', value: `${guild.memberCount}`, inline: true },
                    { name: '📅 Créé le', value: guild.createdAt.toLocaleDateString('fr-FR'), inline: true },
                    { name: '📝 Rôles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: '💬 Salons', value: `${guild.channels.cache.size}`, inline: true }
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'kick') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.KickMembers, PermissionFlagsBits.KickMembers))) return;
            const target = interaction.options.getUser('membre', true);
            const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
            const member = guild.members.cache.get(target.id);
            if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            if (member.id === interaction.user.id) return interaction.reply({ content: '❌ Action sur soi impossible.', ephemeral: true });
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: '❌ Rôle supérieur ou égal.', ephemeral: true });
            }
            await member.kick(reason);
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
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
            if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            if (member.id === interaction.user.id) return interaction.reply({ content: '❌ Action sur soi impossible.', ephemeral: true });
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: '❌ Rôle supérieur ou égal.', ephemeral: true });
            }
            await member.ban({ reason, deleteMessageDays: 1 });
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
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
                .setColor('#00ff00')
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
            if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            if (member.id === interaction.user.id) return interaction.reply({ content: '❌ Action sur soi impossible.', ephemeral: true });
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: '❌ Rôle supérieur ou égal.', ephemeral: true });
            }
            const milliseconds = parseDuration(duration);
            if (!milliseconds) {
                return interaction.reply({ content: '❌ Durée invalide (ex: 10m, 1h, 1d).', ephemeral: true });
            }
            if (milliseconds > 28 * 24 * 60 * 60 * 1000) {
                return interaction.reply({ content: '❌ Durée maximale: 28 jours.', ephemeral: true });
            }
            await member.timeout(milliseconds, reason);
            const embed = new EmbedBuilder()
                .setColor('#ff9900')
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
                return interaction.reply({ content: '❌ Nombre entre 1 et 100.', ephemeral: true });
            }
            const deleted = await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({ content: `✅ ${deleted.size} message(s) supprimé(s).`, ephemeral: true });
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
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
                .setColor('#ffcc00')
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
                .setColor('#ffcc00')
                .setTitle(`📒 Avertissements de ${target.tag}`)
                .setDescription(formatted)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (commandName === 'unwarn') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ModerateMembers))) return;
            const target = interaction.options.getUser('membre', true);
            const index = interaction.options.getInteger('index', true) - 1;
            const warnList = getWarnings(guild.id, target.id);
            if (index < 0 || index >= warnList.length) {
                return interaction.reply({ content: '❌ Index invalide.', ephemeral: true });
            }
            const removed = warnList.splice(index, 1)[0];
            saveWarnings();
            const embed = new EmbedBuilder()
                .setColor('#00ff99')
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
                .setColor('#00ff99')
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
                return interaction.reply({ content: `✅ Salon de logs: ${channel}.`, ephemeral: true });
            }
            if (sub === 'clear') {
                config.logChannelId = null;
                saveGuildConfig(guild.id, config);
                return interaction.reply({ content: '✅ Salon de logs supprimé.', ephemeral: true });
            }
        }

        if (commandName === 'config') {
            if (!(await ensurePermissions(interaction, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageGuild))) return;
            const config = getGuildConfig(guild.id);
            const sub = interaction.options.getSubcommand();
            if (sub === 'view') {
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('⚙️ Configuration de modération')
                    .addFields(
                        { name: 'Automod', value: `enabled=${config.automod.enabled}\nblockInvites=${config.automod.blockInvites}\nmaxMentions=${config.automod.maxMentions}\nmaxLinks=${config.automod.maxLinks}\nmaxCapsPercent=${config.automod.maxCapsPercent}\nminCapsLength=${config.automod.minCapsLength}`, inline: false },
                        { name: 'Anti-spam', value: `enabled=${config.antispam.enabled}\nintervalMs=${config.antispam.intervalMs}\nmaxMessages=${config.antispam.maxMessages}\ntimeoutMs=${config.antispam.timeoutMs}`, inline: false },
                        { name: 'Logs', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Non defini', inline: false }
                    )
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (sub === 'set') {
                const key = interaction.options.getString('cle', true);
                const value = interaction.options.getString('valeur', true);
                let parsedValue = value;
                if (key.includes('enabled') || key.includes('blockInvites')) {
                    const boolValue = parseBoolean(value);
                    if (boolValue === null) {
                        return interaction.reply({ content: '❌ Valeur booleenne invalide (true/false).', ephemeral: true });
                    }
                    parsedValue = boolValue;
                } else {
                    const intValue = parseInt(value, 10);
                    if (Number.isNaN(intValue)) {
                        return interaction.reply({ content: '❌ Valeur numerique requise.', ephemeral: true });
                    }
                    parsedValue = intValue;
                }

                if (key.startsWith('automod.')) {
                    config.automod[key.split('.')[1]] = parsedValue;
                } else if (key.startsWith('antispam.')) {
                    config.antispam[key.split('.')[1]] = parsedValue;
                }
                saveGuildConfig(guild.id, config);
                return interaction.reply({ content: `✅ ${key} mis a jour.`, ephemeral: true });
            }
            if (sub === 'reset') {
                saveGuildConfig(guild.id, JSON.parse(JSON.stringify(defaultGuildConfig)));
                return interaction.reply({ content: '✅ Configuration reinitialisee.', ephemeral: true });
            }
        }
    } catch (error) {
        console.error('Erreur commande:', error);
        if (!interaction.replied) {
            await interaction.reply({ content: '❌ Erreur lors de l\'execution de la commande.', ephemeral: true });
        }
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
                .setColor('#ff0000')
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
                .setColor('#ff0000')
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
                .setColor('#ff0000')
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
                .setColor('#ff0000')
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
                .setColor('#ff0000')
                .setTitle('🚫 Anti-spam')
                .setDescription(`${message.author.tag} a spam.`)
                .setTimestamp();
            await sendModLog(message.guild, embed);
        }
    }
});

client.on('error', console.error);

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);
