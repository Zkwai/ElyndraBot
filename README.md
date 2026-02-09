# ElyndraBOT 🤖

Bot Discord francais oriente moderation avec slash commands, automod et anti-spam.

**Nouveaute:** 🎛️ **Panel de configuration intuitif** directement sur Discord (similaire a DraftBot)

## Fonctionnalites

### Slash commands
- `/ping` - Latence du bot
- `/help` - Liste des commandes
- `/server` - Infos serveur
- `/panel serverinfo` - Panel infos serveur
- `/panel mcinfo` - Panel Minecraft

### Moderation
- `/kick` - Expulser un membre
- `/ban` - Bannir un membre
- `/unban` - Debannir un membre par ID
- `/timeout` - Timeout un membre (ex: 10m, 1h, 1d)
- `/clear` - Supprimer des messages

### Avertissements
- `/warn` - Ajouter un avertissement
- `/warnings` - Voir les avertissements
- `/unwarn` - Retirer un avertissement par index
- `/clearwarnings` - Effacer tous les avertissements

### Panels de Réaction (Type DraftBot)
- `/reactionpanel create` - Créer un nouveau panel
- `/reactionpanel addrole` - Ajouter une réaction-rôle
- `/reactionpanel removerole` - Retirer une réaction-rôle
- `/reactionpanel publish` - Publier le panel dans le salon
- `/reactionpanel delete` - Supprimer un panel
- `/reactionpanel list` - Lister les panels

Les membres réagissent avec les emojis pour obtenir/retirer automatiquement les rôles! 🎭

📖 [Documentation complète des panels](REACTION_PANELS.md)

### Configuration et logs
- `/modlog set|clear` - Definir le salon de logs
- `/config view|set|reset` - Configurer automod et anti-spam
- **`/configpanel`** - Panneau de configuration interactif 🎨

📖 [Documentation du panel](CONFIG_PANEL.md)

### Automod et anti-spam
- Blocage d'invitations Discord
- Limites de mentions, liens, majuscules
- Anti-spam avec timeout automatique

## Installation

### Prerequis
- Node.js 16.9+ (recommande LTS)
- Un bot cree sur le Discord Developer Portal

### Etapes
1) Cloner le repo
```bash
git clone https://github.com/Zkwai/ElyndraBOT.git
cd ElyndraBOT
```

2) Installer les dependances
```bash
npm install
```

3) Configurer l'environnement
```bash
cp .env.example .env
```
Remplir:
```env
DISCORD_TOKEN=ton_token
CLIENT_ID=ton_client_id
GUILD_ID=ton_id_serveur (optionnel, pour sync instantanee)
```

4) Activer les intents privilegies
Dans Developer Portal > Bot:
- Presence Intent
- Server Members Intent
- Message Content Intent

5) Inviter le bot
Scopes: `bot`, `applications.commands`
Permissions recommandees:
- Kick Members, Ban Members, Moderate Members
- Manage Messages, Read Message History
- View Channels, Send Messages

6) Lancer le bot
```bash
npm start
```

## Notes
- Les fichiers runtime sont ecrits dans `data/`.
- La config Minecraft est dans `config/minecraft.json`.
- Les slash commands globales peuvent mettre quelques minutes a apparaitre. Avec `GUILD_ID`, elles apparaissent tout de suite.

## Licence
MIT
