# Configuration de la Rich Presence Discord

## 🎮 Guide de configuration

### 1. Créer une Application Discord

1. Va sur le [Discord Developer Portal](https://discord.com/developers/applications)
2. Clique sur **"New Application"**
3. Donne un nom à ton application (ex: "ElyndraBot Presence")
4. Copie l'**Application ID** (Client ID)
5. Colle cet ID dans le fichier `config/richpresence.json` dans le champ `clientId`

### 2. Ajouter des Assets (Images)

Pour afficher des images personnalisées dans la Rich Presence:

1. Dans ton application Discord, va dans **"Rich Presence" → "Art Assets"**
2. Upload tes images:
   - **elyndra_logo** - Logo principal du serveur (recommandé: 1024x1024px)
   - **minecraft** - Icon Minecraft (recommandé: 1024x1024px)
3. Le nom de l'asset doit correspondre aux clés dans la configuration:
   - `largeImageKey: "elyndra_logo"`
   - `smallImageKey: "minecraft"`

### 3. Configuration du fichier

Fichier: `config/richpresence.json`

```json
{
  "clientId": "VOTRE_APPLICATION_ID_ICI",
  "enabled": true,
  "updateInterval": 15000,
  "display": {
    "state": "Jouant à Minecraft",
    "details": "Sur Elyndra",
    "largeImageKey": "elyndra_logo",
    "largeImageText": "Serveur Elyndra",
    "smallImageKey": "minecraft",
    "smallImageText": "Minecraft Bedrock",
    "buttons": [
      {
        "label": "Rejoindre le serveur",
        "url": "https://elyndra.mcbe.fr"
      }
    ]
  }
}
```

### 4. Utilisation

**Pour les joueurs:**

1. Lier son compte Minecraft: `/link <code>` (le code est obtenu en jeu)
2. Activer la Rich Presence: `/richpresence enable`
3. Vérifier le statut: `/richpresence status`
4. Désactiver: `/richpresence disable`

**Pour les administrateurs:**

- Voir les statistiques: `/richpresence stats`

### 5. Fonctionnalités

✅ **Affiche automatiquement:**
- Le nom du joueur (gamertag Minecraft)
- Le serveur (elyndra.mcbe.fr)
- Le nombre de joueurs en ligne
- Le temps de jeu (depuis la connexion)
- Boutons cliquables personnalisables

✅ **S'active automatiquement** lors du `/link`

✅ **Se désactive automatiquement** lors du `/unlink`

### 6. Notes importantes

⚠️ **La Rich Presence ne fonctionne que si:**
- Le `clientId` est correctement configuré
- Le joueur a son client Discord ouvert
- Le compte Discord est bien lié au compte Minecraft

⚠️ **Limitations Discord:**
- Maximum 2 boutons
- Les images doivent être uploadées sur le Developer Portal
- Le texte est limité à 128 caractères

### 7. Dépannage

**Problème: "Rich Presence désactivée ou clientId manquant"**
- Vérifie que le `clientId` est bien renseigné dans `config/richpresence.json`
- Redémarre le bot après modification

**Problème: "Erreur connexion Rich Presence"**
- Vérifie que le Client ID est correct
- Assure-toi que l'application Discord existe bien
- Vérifie que Discord est ouvert sur l'ordinateur du joueur

**Problème: Les images ne s'affichent pas**
- Vérifie que les assets sont uploadés sur le Developer Portal
- Vérifie que les noms correspondent exactement (sensible à la casse)
- Attends quelques minutes après l'upload (propagation)

## 📚 Documentation

Pour plus d'informations sur la Rich Presence:
- [Discord Rich Presence Documentation](https://discord.com/developers/docs/rich-presence/how-to)
- [Discord RPC Visualizer](https://discord.com/developers/applications/[APP_ID]/rich-presence/visualizer)
