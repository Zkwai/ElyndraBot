# 🎭 Système de Panels de Réaction de Rôles

Similaire à **DraftBot**, ce bot inclut un système complet de panels de réaction qui permet aux utilisateurs d'obtenir des rôles en réagissant avec des emojis.

## 📋 Commandes disponibles

### `/reactionpanel create`
Crée un nouveau panneau de réaction.

**Paramètres:**
- `id` : Identifiant unique du panneau (par serveur)
- `titre` : Titre du panneau affiché
- `description` : Description du panneau

**Exemple:**
```
/reactionpanel create id:roles titre:Choisissez vos rôles description:Réagissez avec les emojis pour obtenir les rôles correspondants
```

### `/reactionpanel addrole`
Ajoute un mapping emoji → rôle au panneau.

**Paramètres:**
- `id` : ID du panneau
- `emoji` : Emoji à utiliser (ex: 🎮)
- `role` : Rôle à attribuer

**Exemple:**
```
/reactionpanel addrole id:roles emoji:🎮 role:Gamers
/reactionpanel addrole id:roles emoji:🎨 role:Artistes
/reactionpanel addrole id:roles emoji:🎵 role:Musiciens
```

### `/reactionpanel removerole`
Retire un mapping emoji du panneau.

**Paramètres:**
- `id` : ID du panneau
- `emoji` : Emoji à retirer

**Exemple:**
```
/reactionpanel removerole id:roles emoji:🎮
```

### `/reactionpanel publish`
Publie le panneau dans le salon courant. Ajoute automatiquement les réactions.

**Paramètres:**
- `id` : ID du panneau à publier

**Exemple:**
```
/reactionpanel publish id:roles
```

Les membres peuvent maintenant réagir avec les emojis pour obtenir/retirer les rôles!

### `/reactionpanel delete`
Supprime un panneau.

**Paramètres:**
- `id` : ID du panneau à supprimer

**Exemple:**
```
/reactionpanel delete id:roles
```

### `/reactionpanel list`
Affiche la liste de tous les panneaux du serveur.

**Exemple:**
```
/reactionpanel list
```

## 🔧 Flux de travail complet

### 1. Créer le panneau
```
/reactionpanel create id:couleurs titre:Choisissez votre couleur description:Réagissez pour obtenir votre rôle couleur préféré
```

### 2. Ajouter les rôles
```
/reactionpanel addrole id:couleurs emoji:🔴 role:Rouge
/reactionpanel addrole id:couleurs emoji:🟢 role:Vert
/reactionpanel addrole id:couleurs emoji:🔵 role:Bleu
```

### 3. Vérifier la configuration
```
/reactionpanel list
```

### 4. Publier dans un salon
```
# Aller dans le salon où vous voulez le panneau
/reactionpanel publish id:couleurs
```

### 5. Les membres utilisent le panneau
- Les membres réagissent avec l'emoji correspondant → reçoivent le rôle
- Ils retirent la réaction → perdent le rôle

## 📝 Cas d'usage

- **Sélection de rôles de départements** (UX, Backend, Frontend, etc.)
- **Sélection de jeux** (Valorant, Fortnite, Minecraft, etc.)
- **Sélection de langues** (Français, Anglais, Espagnol, etc.)
- **Acceptation de règles** (Lire et accepter les règles du serveur)
- **Notifications** (S'inscrire/désinscrire aux annonces)

## ⚠️ Permissions requises

- **Du bot:** `Gérer les rôles`, `Ajouter des réactions`
- **De l'utilisateur qui crée le panneau:** `Gérer les rôles`

## 💾 Stockage

Les configurations des panneaux sont sauvegardées dans `data/reaction_panels.json`.

Format exemple:
```json
{
  "panels": {
    "guildId": {
      "panelId": {
        "title": "Sélectionnez vos rôles",
        "description": "Réagissez avec les emojis...",
        "messageId": "123456789",
        "channelId": "987654321",
        "reactions": {
          "🎮": "123456789012345678",
          "🎨": "987654321098765432"
        }
      }
    }
  }
}
```

## 🎯 Différences avec DraftBot

Notre système respecte la même philosophie que DraftBot mais avec quelques variations:
- ✅ Gestion par ID de panneau (permet plusieurs panneaux par serveur)
- ✅ Emojis custom et standards supportés
- ✅ Réactions entièrement automatiques
- ✅ Stockage JSON local (pas de base de données externe)

Amusez-vous! 🎉
