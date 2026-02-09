const DiscordRPC = require('discord-rpc');
const fs = require('fs');
const path = require('path');

/**
 * Module de gestion de Discord Rich Presence pour ElyndraBot
 * Permet aux joueurs Minecraft liés d'afficher leur statut de jeu
 */

const CONFIG_PATH = path.join(__dirname, 'config', 'richpresence.json');

// Configuration par défaut
const defaultConfig = {
    clientId: '', // ID de l'application Discord (à configurer)
    enabled: true,
    updateInterval: 15000, // Mise à jour toutes les 15 secondes
    display: {
        state: 'Jouant à Minecraft',
        details: 'Sur Elyndra',
        largeImageKey: 'elyndra_logo', // Nom de l'asset uploadé sur Discord
        largeImageText: 'Serveur Elyndra',
        smallImageKey: 'minecraft', // Nom de l'asset uploadé sur Discord
        smallImageText: 'Minecraft Bedrock',
        buttons: [
            {
                label: 'Rejoindre le serveur',
                url: 'https://elyndra.mcbe.fr'
            }
        ]
    }
};

class RichPresenceManager {
    constructor() {
        this.config = this.loadConfig();
        this.clients = new Map(); // Map<userId, RPCClient>
        this.startTimestamps = new Map(); // Map<userId, timestamp>
        this.playerData = new Map(); // Map<userId, gameData>
    }

    loadConfig() {
        try {
            if (fs.existsSync(CONFIG_PATH)) {
                const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
                return { ...defaultConfig, ...JSON.parse(raw) };
            } else {
                // Créer le fichier de config par défaut
                const dir = path.dirname(CONFIG_PATH);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
                console.log('⚙️ Fichier de configuration Rich Presence créé:', CONFIG_PATH);
                return defaultConfig;
            }
        } catch (error) {
            console.error('❌ Erreur chargement config Rich Presence:', error);
            return defaultConfig;
        }
    }

    saveConfig() {
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('❌ Erreur sauvegarde config Rich Presence:', error);
        }
    }

    /**
     * Initialise la Rich Presence pour un utilisateur
     * @param {string} userId - ID Discord de l'utilisateur
     * @param {Object} options - Options personnalisées
     */
    async connectUser(userId, options = {}) {
        if (!this.config.enabled || !this.config.clientId) {
            console.warn('⚠️ Rich Presence désactivée ou clientId manquant');
            return false;
        }

        // Ne pas recréer une connexion existante
        if (this.clients.has(userId)) {
            await this.updatePresence(userId, options);
            return true;
        }

        try {
            const rpc = new DiscordRPC.Client({ transport: 'ipc' });
            
            rpc.on('ready', () => {
                console.log(`✅ Rich Presence connectée pour l'utilisateur ${userId}`);
                this.startTimestamps.set(userId, Date.now());
                this.updatePresence(userId, options);
            });

            await rpc.login({ clientId: this.config.clientId });
            this.clients.set(userId, rpc);
            return true;

        } catch (error) {
            console.error(`❌ Erreur connexion Rich Presence pour ${userId}:`, error.message);
            return false;
        }
    }

    /**
     * Met à jour la Rich Presence d'un utilisateur
     * @param {string} userId - ID Discord de l'utilisateur
     * @param {Object} data - Données de jeu (gamertag, server, etc.)
     */
    async updatePresence(userId, data = {}) {
        const rpc = this.clients.get(userId);
        if (!rpc) return;

        try {
            const gameData = { ...this.playerData.get(userId), ...data };
            this.playerData.set(userId, gameData);

            const presence = {
                state: gameData.state || this.config.display.state,
                details: gameData.details || this.config.display.details,
                startTimestamp: this.startTimestamps.get(userId),
                largeImageKey: gameData.largeImageKey || this.config.display.largeImageKey,
                largeImageText: gameData.largeImageText || this.config.display.largeImageText,
                smallImageKey: gameData.smallImageKey || this.config.display.smallImageKey,
                smallImageText: gameData.smallImageText || this.config.display.smallImageText,
                instance: false,
            };

            // Ajouter party info si disponible
            if (gameData.partySize && gameData.partyMax) {
                presence.partySize = gameData.partySize;
                presence.partyMax = gameData.partyMax;
            }

            // Ajouter les boutons
            if (this.config.display.buttons && this.config.display.buttons.length > 0) {
                presence.buttons = this.config.display.buttons;
            }

            await rpc.setActivity(presence);
            console.log(`🎮 Presence mise à jour pour ${userId}`);

        } catch (error) {
            console.error(`❌ Erreur mise à jour Rich Presence pour ${userId}:`, error.message);
        }
    }

    /**
     * Déconnecte la Rich Presence d'un utilisateur
     * @param {string} userId - ID Discord de l'utilisateur
     */
    async disconnectUser(userId) {
        const rpc = this.clients.get(userId);
        if (!rpc) return;

        try {
            await rpc.clearActivity();
            await rpc.destroy();
            this.clients.delete(userId);
            this.startTimestamps.delete(userId);
            this.playerData.delete(userId);
            console.log(`🔌 Rich Presence déconnectée pour ${userId}`);
        } catch (error) {
            console.error(`❌ Erreur déconnexion Rich Presence pour ${userId}:`, error.message);
        }
    }

    /**
     * Met à jour la presence pour un joueur Minecraft
     * @param {string} userId - ID Discord
     * @param {Object} mcData - Données Minecraft (gamertag, world, etc.)
     */
    async updateMinecraftPresence(userId, mcData) {
        const data = {
            state: mcData.world ? `Dans ${mcData.world}` : 'Jouant à Minecraft',
            details: `${mcData.gamertag || 'Joueur'} | elyndra.mcbe.fr`,
            largeImageKey: 'elyndra_logo',
            largeImageText: mcData.world || 'Serveur Elyndra',
            smallImageKey: 'minecraft',
            smallImageText: `Niveau ${mcData.level || 1}`,
            partySize: mcData.onlinePlayers || 1,
            partyMax: mcData.maxPlayers || 20
        };

        if (this.clients.has(userId)) {
            await this.updatePresence(userId, data);
        } else {
            await this.connectUser(userId, data);
        }
    }

    /**
     * Déconnecte tous les utilisateurs
     */
    async disconnectAll() {
        console.log('🔌 Déconnexion de tous les clients Rich Presence...');
        const promises = Array.from(this.clients.keys()).map(userId => 
            this.disconnectUser(userId)
        );
        await Promise.all(promises);
    }

    /**
     * Obtient les statistiques
     */
    getStats() {
        return {
            activeConnections: this.clients.size,
            connectedUsers: Array.from(this.clients.keys())
        };
    }
}

// Créer une instance globale
const presenceManager = new RichPresenceManager();

// Nettoyer lors de la fermeture du processus
process.on('SIGINT', async () => {
    await presenceManager.disconnectAll();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await presenceManager.disconnectAll();
    process.exit(0);
});

module.exports = presenceManager;
