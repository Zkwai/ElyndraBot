# 🎛️ Panel de Configuration Discord

Un panneau de configuration moderne et intuitif **directement sur Discord**, similaire au design de **DraftBot**.

## 📋 Usage

### Commande `/configpanel`

Affiche le panneau de configuration avec un menu de sélection des modules.

**Permissions requises:**
- Gérer le serveur (`Manage Guild`)

**Exemple:**
```
/configpanel
```

## 🎨 Modules disponibles

### 🏠 **Accueil**
Vue d'ensemble du serveur:
- 👥 Nombre de membres
- 📅 Date de création
- 💬 Nombre de salons texte
- 🔊 Nombre de salons vocaux
- 🧩 Nombre de rôles
- 👤 Propriétaire du serveur

### 🚫 **Automod**
Configuration de l'antimod:
- ✅ Statut (activé/désactivé)
- 🔗 Blocage des invitations
- ⚠️ Limite de mentions
- 🔗 Limite de liens
- 🔤 Limite de majuscules (%)
- 📏 Longueur minimale de majuscules

### 🎭 **Reaction Panels**
Gestion des panneaux de réaction-rôles:
- 📊 Nombre total de panneaux
- ✅ Nombre de panneaux publiés
- ⏳ Nombre de brouillons

### 📋 **Moderation**
Paramètres anti-spam:
- ✅ Statut du anti-spam
- 📊 Nombre maximum de messages
- ⏱️ Intervalle de vérification (ms)
- ⏰ Durée du timeout automatique

### 🔔 **Notifications**
Configuration des logs:
- 📨 Salon de logs

### 🌐 **Minecraft**
Informations serveur Minecraft:
- 🖥️ Adresse hostname
- 🔌 Port du serveur

## 🎯 Comment utiliser

1. **Ouvrir le panel:**
   ```
   /configpanel
   ```

2. **Sélectionner un module** dans le dropdown menu
   - Choisissez le module que vous voulez consulter

3. **Voir les paramètres** dans l'embed
   - Les paramètres s'affichent en temps réel

4. **Modifier les paramètres:**
   - Utilisez `/config set` pour modifier les valeurs
   - Exemple: `/config set cle:automod.maxMentions valeur:8`

## 🎨 Design

Le panel utilise:
- **Couleur doré (#f1c40f)** pour les embeds
- **Emojis** pour chaque section
- **Select Menu** dans un dropdown intuitif
- **Code couleur Discord** pour les timestamps

```
⚙️ Configuration
Bienvenue dans le panneau de configuration d'ElyndraBot.

🏠 Accueil - Vue d'ensemble du serveur
🚫 Automod - Configuration anti-spam
🎭 Reaction Panels - Gestion des réaction-rôles
📋 Moderation - Paramètres de modération
🔔 Notifications - Salon de logs
🌐 Minecraft - Info serveur Minecraft
```

## 📝 Intégration avec les autres commandes

Le panel de configuration est **complémentaire** aux commandes existantes:

- **`/configpanel`** → Vue d'ensemble interactive
- **`/config view`** → Voir toute la configuration en liste
- **`/config set`** → Modifier les paramètres en détail
- **`/modlog set|clear`** → Configurer les logs

## 💡 Exemple de flux complet

1. Ouvrir le panel:
   ```
   /configpanel
   ```

2. Sélectionner "Automod" pour voir les paramètres

3. Si vous voulez modifier, utilisez:
   ```
   /config set cle:automod.blockInvites valeur:true
   ```

4. Rouvrir le panel pour vérifier:
   ```
   /configpanel
   ```

## ✨ Avantages

✅ **Interface visuelle et intuitive**
✅ **Pas besoin de retenir les noms de paramètres**
✅ **Navigation par dropdown menu**
✅ **Réactions instantanées**
✅ **Design cohérent avec DraftBot**
✅ **Totalement accessible depuis Discord**

C'est un outil parfait pour:
- 🆕 Les nouveaux administrateurs
- 📱 Ceux qui n'aiment pas les commandes texte
- 🎮 Une gestion plus visuelle et intuitive
- 📊 Consulter les stats du serveur rapidement

Amusez-vous! 🎉
