# ESPSomfy RTS

## Présentation

Cette intégration amène vos moteurs **Somfy RTS** dans Gladys grâce à un contrôleur **ESPSomfy RTS** : volets roulants, stores vénitiens et leurs lames, stores bannes, rideaux, portes de garage et portails, dans les pièces et les scènes, avec leur position, leur position favorite « My » et leur capteur soleil et vent.

[ESPSomfy RTS](https://github.com/rstrouse/ESPSomfy-RTS) est un micrologiciel libre pour un ESP32 équipé d’une radio 433 MHz (CC1101). Il envoie les trames radio d’une télécommande Somfy RTS, donc il pilote les moteurs sans aucune box Somfy, et il entend vos télécommandes, donc il sait où est allé chaque volet. Il estime les positions à partir des temps de course réglés dans sa page web.

**Fonctionnement** : tout reste sur votre **réseau local**. Gladys trouve le contrôleur toute seule (SSDP), lit ses volets et ses groupes, puis garde une connexion ouverte avec lui : chaque mouvement, qu’il vienne de Gladys, d’une télécommande ou de la page web du contrôleur, apparaît aussitôt, rien n’est interrogé en boucle. Pas de compte, pas de cloud. Cette intégration n’est pas officielle et n’a aucun lien avec Somfy ni avec les auteurs d’ESPSomfy RTS.

## Prérequis

- Gladys Assistant 5.1.0 ou plus récent.
- Un contrôleur ESPSomfy RTS en micrologiciel 2.4 ou plus récent, connecté au **même réseau que Gladys** (Wi-Fi ou Ethernet).
- Vos volets et groupes **créés et appairés dans la page web du contrôleur** : l’intégration n’appaire pas les moteurs, elle utilise ce que connaît le contrôleur.
- À l’installation, acceptez la **découverte réseau** (SSDP), qui permet à Gladys de trouver le contrôleur. L’option **SSDP broadcast** du contrôleur doit rester active (elle l’est par défaut) ; sinon, saisissez son adresse dans la configuration.

## Configuration

### Contrôleurs

Rien n’est obligatoire : enregistrez la configuration, puis cliquez sur **Rechercher les contrôleurs**. Le message liste chaque contrôleur trouvé avec son adresse, son micrologiciel et son nombre de volets et de groupes.

- **Adresses IP des contrôleurs** : seulement pour un contrôleur que la recherche ne trouve pas (autre sous-réseau, réseau qui filtre le multicast, SSDP désactivé), séparées par des virgules. Donnez une adresse fixe à votre contrôleur dans votre box : un contrôleur dont l’adresse a changé est retrouvé par son identifiant, mais plus vite avec une adresse fixe.
- **Rechercher à nouveau sur le réseau** : toutes les heures (par défaut), toutes les 15 minutes, ou jamais. Utile pour un nouveau contrôleur, un volet ajouté dans la page web, ou une adresse changée par la box. Un contrôleur qui ne répond plus est rappelé dans tous les cas.

### Langue

**Langue des textes** : noms des fonctionnalités et messages d’erreur des scènes, car Gladys ne transmet pas votre langue avec eux.

## Utilisation

### Appareils

Ouvrez l’onglet **Découverte** de l’intégration et ajoutez vos volets et groupes. Chacun devient un appareil Gladys, nommé comme dans le contrôleur :

- **Volet roulant, volet, store vénitien, store banne, porte de garage, portail à trois boutons** : un volet avec **Ouvrir / fermer** (ouvrir, arrêter, fermer) et **Position** (0 % = fermé, 100 % = ouvert).
- **Rideau** : un rideau avec les deux mêmes fonctionnalités.
- **Store avec moteur d’inclinaison** : en plus **Lames** (0 % = fermées, 100 % = ouvertes). Un store à lames seules a ses lames comme position.
- **Porte de garage ou portail à un bouton** : **Ouvrir / fermer** seulement ; le bouton n’est actionné que s’il change quelque chose.
- **Contact sec** : un interrupteur **Relais**.
- **Moteur avec capteur soleil, store banne** : en plus **Capteur soleil actif**, qui laisse le capteur soleil bouger le moteur, ou non (le « sun flag » de Somfy).
- **Groupe** : **Ouvrir / fermer** pour tous ses volets d’un coup (et **Capteur soleil actif** s’il en a un). Un groupe n’a pas de position.

**Arrêter** stoppe un volet en mouvement ; sur un volet immobile, il ne fait rien (chez Somfy, le même bouton envoie un volet immobile à sa position « My » : utilisez pour cela l’action de scène ou le widget). Les positions suivent les conventions de l’intégration Home Assistant de l’auteur du micrologiciel, y compris l’option **flip position** et les stores bannes (ouvert = déroulé).

### Transport

Le catalogue affiche le badge **local** : rien ne sort de votre réseau. Chaque appareil indique **local** tant que son contrôleur répond, **injoignable** sinon.

### Widgets

![Le widget « Volet Somfy » : le store terrasse ouvert à 65 % avec une jauge, son état, sa position « My » à 50 %, soleil détecté, pas de vent, capteur soleil actif, et les boutons Ouvrir, My, Fermer et Ignorer le soleil ; à côté, le widget « Volets Somfy » listant six volets avec leur état et leur position, et le contrôleur en ligne en Wi-Fi (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-espsomfy-rts/main/docs/assets/widgets.fr.png)

- **Volet Somfy** : un volet ou un groupe choisi dans les réglages : son ouverture (jauge en direct), son état, sa **position « My »**, les lames, le soleil et le vent, et les boutons **Ouvrir**, **My**, **Fermer** et le capteur soleil. **My** est la position favorite enregistrée dans le moteur, pour laquelle Gladys n’a pas de bouton.
- **Volets Somfy** : tous les volets ajoutés à Gladys, ouverts ou fermés d’un coup d’œil (huit au plus), et l’état des contrôleurs avec une mise à jour du micrologiciel quand il y en a une.

### Déclencheurs de scène

- **Une télécommande Somfy est pressée** : une télécommande, un interrupteur mural ou une Situo appairés à un volet sont pressés et le contrôleur l’entend. Filtre par volet et par bouton (▲ haut, ▼ bas, My, My + haut…). Variables : nom du volet, bouton, adresse de la télécommande. Les commandes envoyées par Gladys ou par le contrôleur ne le déclenchent jamais.
- **Le soleil ou le vent change** : le capteur soleil et vent Somfy d’un moteur signale l’arrivée ou le départ du soleil ou du vent. Filtre par volet, capteur et état.
- **Un contrôleur ESPSomfy RTS est perdu** : il ne répond plus depuis une minute (débranché, Wi-Fi perdu). Variables : nom du contrôleur, adresse IP.
- **Un contrôleur ESPSomfy RTS est de retour** : il répond de nouveau après un événement « perdu ».

### Actions de scène

- **Envoyer une commande Somfy** à un volet ou un groupe : **My** (position favorite ; arrête un volet en mouvement), ouvrir, fermer, un pas vers l’ouverture ou la fermeture, capteur soleil actif ou ignoré.
- **Corriger la position d’un volet** : indique au contrôleur où se trouve vraiment le volet, sans le bouger (après une télécommande qu’il n’entend pas, ou une coupure de courant), avec les lames s’il y en a.

### Exemples de scènes

- Quand **le bouton « My » de la télécommande du salon** est pressé → baisser les lumières et allumer la télé.
- Quand **du vent est détecté** sur le store terrasse → envoyer une notification (le moteur le replie tout seul).
- Au coucher du soleil → **Envoyer une commande Somfy** « My » au groupe du rez-de-chaussée : chaque volet va à sa position favorite.

## Dépannage

- **Aucun contrôleur trouvé** : vérifiez que le contrôleur répond à `http://<son adresse>` depuis un ordinateur du même réseau, que son option **SSDP broadcast** est active, et que vous avez accepté la découverte réseau à l’installation (sinon réinstallez l’intégration). Ou saisissez son adresse dans **Adresses IP des contrôleurs**.
- **Un volet manque** : créez-le dans la page web du contrôleur, puis lancez une recherche dans l’onglet **Découverte**.
- **La position est fausse** : ESPSomfy RTS l’estime à partir des temps de course réglés dans sa page web et des trames qu’il entend. Une télécommande qu’il n’entend pas bouge le volet sans le lui dire : utilisez l’action **Corriger la position d’un volet**, ou liez cette télécommande dans la page web du contrôleur.
- **Les commandes vont dans le mauvais sens** : corrigez-le dans la page web du contrôleur (flip commands, flip position), puis ajoutez de nouveau l’appareil si l’onglet Découverte propose une mise à jour.
- **Injoignable** : le contrôleur redémarre après une mise à jour du micrologiciel ou une perte du Wi-Fi ; Gladys se reconnecte en moins d’une minute. L’API HTTP (port 8081) et le socket (port 8080) doivent être accessibles depuis Gladys.
- **Journaux** : onglet Journaux de la page de l’intégration. Pour plus de détails, ajoutez la variable d’environnement `DEBUG=gladys-integration-sdk`.
