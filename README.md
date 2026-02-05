# ElyndraBOT 🤖

Bot Discord francais oriente moderation avec slash commands, automod et anti-spam.

## Fonctionnalites

### Slash commands
- `/ping` - Latence du bot
- `/help` - Liste des commandes
- `/server` - Infos serveur

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

### Configuration et logs
- `/modlog set|clear` - Definir le salon de logs
- `/config view|set|reset` - Configurer automod et anti-spam

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
- Les fichiers de configuration runtime sont ecrits dans `data/`.
- Les slash commands peuvent mettre quelques minutes a apparaitre.

## Licence
MIT
