// Reelbook landing and language (L30, decision 13; v3 by L36).
// - The landing (#intro in index.html): the first screen of a device that has never signed in, the v3 mockup
//   docs/audit-design/mockups/p6-landing.html. Its copy is the mockup's, word for word, French and English.
// - The FR / EN dictionary of the screens a newcomer sees: the landing, sign-up / sign-in and their messages, #setup,
//   #welcome. The rest of the app stays English (L35 later). Static text carries data-k="<key>" (data-ka for an
//   aria-label); the app script asks window.RBL.t(key) for what it writes itself.
// - Language: the choice saved in localStorage rb.lang (not per user: it is chosen before signing in), else
//   navigator.language, else English. <html lang> follows.
// - Pictures (decision 19, L36): five examples (MMA, dance, stretch, snowboard, HIIT), generated images in
//   assets/<folder>/ (assets/<folder>/README.md): <name>.jpg a step frame (640 px), <name>-t.jpg a thumbnail (240 px).
//   Never a frame from a third-party video, never an address outside the app.
// - The beta's state comes from beta_seats() (L32), asked by the app script on the hosted backend: RBL.seats(data).
//   Without an answer (no function, an error, null): seats open, no count. At the limit (taken >= total, or open
//   false): the waiting-list card, « On my own Supabase » as the way in, the buttons say « Join the waiting list ».
// The vm harness of tests/auth-flow.test.cjs does not load this file: the app script falls back to English.
// tests/landing.test.cjs runs it with a small fake DOM, so every newer DOM API here is guarded.
(function () {
  'use strict';
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : {};

  // @gen-start: generated from the v3 mockup (docs/audit-design/mockups/p6-landing.html): FR from its markup, EN
  // from its EN dictionary, then the strings its script writes itself. Image names: see assets/README.md.
  const LANDING = {
    "fr": {
      "foot": "Les fiches personnelles gardent le lien vers leur vidéo et leur auteur. Les visuels de cette page sont des démonstrations générées. Reelbook est open source, sous licence MIT : <a href=\"https://github.com/lt20/reelbook\" target=\"_blank\" rel=\"noopener\">github.com/lt20/reelbook</a>.",
      "cta": "Créer mon carnet",
      "c.p": "Tes vidéos de technique, enfin prêtes pour l’entraînement. Gratuit pendant la bêta, 50 places.",
      "d4.p": "Ouvre la fiche ou la séance sur ton téléphone : le geste d’abord, en images, puis les détails. Coche « Fait aujourd’hui ».",
      "d4.v": "Entraîne-toi",
      "d3.p": "Déplace une fiche d’un groupe à l’autre, ajoute tes notes, compose une séance à partir de plusieurs carnets.",
      "d3.v": "Organise",
      "d2.p": "<code>/reelbook</code> dans Claude Code quand tu veux, ou laisse-le tourner chaque nuit. Le matin, tes fiches sont là.",
      "d2.v": "Lance",
      "d1.p": "Une technique te plaît dans ton fil : Partager, Reelbook. Dix secondes, et tu continues à scroller.",
      "d1.v": "Envoie",
      "d.h": "Au quotidien.",
      "i3.cta": "Ajouter le raccourci",
      "i3.p2": "Sur Android, colle simplement le lien dans l’app.",
      "i3.p": "Mets Reelbook sur ton écran d’accueil, puis le raccourci « Envoyer à Reelbook » dans le menu Partager de l’iPhone.",
      "i3.h": "Ajoute Reelbook à ton téléphone",
      "i2.src": "Lire le script avant de le lancer ↗",
      "i2.copy": "Copier la ligne",
      "i2.pw": "Colle cette ligne dans PowerShell. Elle installe le skill <code>/reelbook</code> et le relie à ton compte.",
      "i2.p": "Colle cette ligne dans le Terminal. Elle installe le skill <code>/reelbook</code> et le relie à ton compte.",
      "i2.n": "Il te faut Claude Pro ou plus avec Claude Code, et Chrome avec l’extension Claude in Chrome.",
      "i2.h": "Installe le skill",
      "i1.cta": "Créer mon carnet",
      "i1.bd": "Ton propre projet, tes limites. Un fichier SQL à lancer, puis colle l’adresse et la clé.",
      "i1.b": "Sur mon Supabase",
      "wl.cta": "Me prévenir",
      "wl.c": "J’accepte que Reelbook garde mon prénom et mon e-mail pour me prévenir d’une place libre, et rien d’autre. Effacés à mon inscription ou sur simple demande.",
      "wl.e": "E-mail",
      "wl.n": "Prénom",
      "wl.p": "Laisse ton prénom et ton e-mail : on te prévient dès qu’une place se libère.",
      "wl.h": "Bêta complète : {total} sur {total}",
      "i1.seats": "",
      "i1.ad": "Rien à configurer. Gratuit pendant la bêta : 300 fiches, 200 Mo de photos, 10 vidéos par jour.",
      "i1.a": "Chez Reelbook",
      "i1.p": "Choisis où vivent tes fiches. Tu pourras changer plus tard.",
      "i1.h": "Crée ton carnet",
      "oss.a": "Voir le code sur GitHub ↗",
      "oss.p": "<b>Reelbook est open source.</b> Le skill, l’app et le serveur sont publics sur GitHub, sous licence MIT : tu peux lire ce que tu installes, et l’héberger toi-même.",
      "inst.p": "Avant de commencer : Claude Pro avec Claude Code, Chrome avec l’extension Claude in Chrome, Git et Python 3.9+. Ensuite, trois choses à faire une fois : ton compte, le skill sur ton ordinateur, l’app sur ton téléphone.",
      "inst.h": "Installer Reelbook.",
      "r5.p": "Dans le bon carnet, le bon groupe. Prête à être retrouvée, annotée, ajoutée à une séance.",
      "r5.h": "Rangée dans ton carnet",
      "r4.p": "Les moments clés deviennent une séquence d’images, avec les points à retenir, un dosage et le lien vers la vidéo.",
      "r4.h": "Le geste, découpé",
      "r3.p": "L’extension Claude in Chrome lit la vidéo comme toi : le geste, les consignes, les sous-titres.",
      "r3.h": "Chrome ouvre et analyse",
      "r2.p": "Tape <code>/reelbook</code> dans Claude Code, ou laisse-le tourner la nuit sur ton ordinateur.",
      "r2.h": "Claude s’en charge",
      "t.l2": "ouverture dans Chrome",
      "t.l1": "3 vidéos dans la file",
      "r1.p": "Depuis TikTok, Instagram, YouTube ou Facebook : Partager, puis Reelbook. Elle rejoint ta file.",
      "r1.h": "Tu envoies la vidéo",
      "how.p": "<strong class=\"lp-brand\">Reelbook</strong> est un skill pour Claude Code. Avec l’extension Claude in Chrome, il ouvre les vidéos que tu lui as envoyées, les découpe en séquence d’images et range chaque fiche dans le bon carnet.",
      "how.h": "Un skill Claude fait le travail.",
      "v4.p": "Les nouvelles fiches t’attendent en haut de l’accueil, celles que tu n’as jamais essayées remontent d’elles-mêmes, et chaque « Fait aujourd’hui » s’ajoute au compteur de la fiche.",
      "v4.h": "Ta progression, fiche par fiche.",
      "v3.p": "Pioche dans tous tes carnets et mélange-les : la technique, la mobilité, l’échauffement dans la même séance. Mets les exercices dans l’ordre, donne à chacun son dosage, puis suis la séance fiche après fiche.",
      "v3.h": "Tes fiches font tes séances.",
      "v1.p": "Le reel de ton coach sur Instagram, la vidéo YouTube d’une championne, le TikTok repéré dans le métro : tout arrive au même endroit, rangé par activité et par thème. Tu y cherches par zone du corps ou par matériel, et les notes de ton coach restent à côté du geste.",
      "v1.h": "Tout au même endroit.",
      "f3.p": "Mélange les fiches de tous tes carnets, donne à chacune son dosage, et entraîne-toi fiche après fiche.",
      "f3.h": "Tes fiches font tes séances",
      "f2.p": "Le geste découpé en images, avec les consignes à retenir, un dosage et le lien vers la vidéo.",
      "f2.h": "Elle devient une fiche",
      "f1.p": "Sur TikTok, Instagram, YouTube ou Facebook : Partager, puis Reelbook. Dix secondes, et tu continues de scroller.",
      "f1.h": "Tu repères une vidéo, tu l’envoies à Reelbook",
      "ex.hiit": "HIIT",
      "ex.snow": "Snowboard",
      "ex.stretch": "Étirement",
      "ex.dance": "Danse",
      "ex.l": "Voir un exemple :",
      "flow.h": "Du reel au geste.",
      "v6.own": "Crée ta propre activité",
      "v6.q": "29 carnets prêts à l’emploi. Le tien n’y est pas ?",
      "v6.h": "Tes activités, tes carnets.",
      "fit": "Il te faut Claude Pro (ou plus) avec Claude Code, et Chrome sur ton ordinateur. Pour TikTok, Instagram, YouTube et Facebook.",
      "beta": "Gratuit pendant la bêta",
      "cta2": "Voir comment ça marche",
      "sub": "Reelbook réunit tes vidéos de technique dans un carnet d’entraînement. Chaque vidéo devient une fiche image par image, facile à retrouver et à assembler en séances.",
      "h1": "Un <span class=\"lp-slash\">/skill</span> Claude Code qui transforme tes vidéos de technique en carnet d’entraînement.",
      "seats": "{taken} places prises sur {total}",
      "beta.full": "Bêta complète · inscris-toi sur la liste d’attente",
      "beta.closed": "Bêta complète",
      "cta.full": "Rejoindre la liste d’attente",
      "i1.cta.full": "Connecter mon Supabase",
      "ui.nbs": "Mes carnets",
      "ui.paste": "Colle le lien d’une vidéo…",
      "ui.sheets": "{n} fiches",
      "ui.devices": "6 carnets · 89 fiches, sur ton téléphone et sur ta tablette.",
      "ui.session": "Séance",
      "ui.done": "Fait aujourd’hui",
      "ui.new": "Nouveau",
      "ui.nw.h": "Nouveautés",
      "ui.nw.p": "Arrivées ces derniers jours, pas encore ouvertes.",
      "ui.tr.h": "À essayer",
      "ui.tr.p": "Gardées depuis un moment, jamais travaillées.",
      "ui.tr.tag": "Jamais faite",
      "ui.dn.h": "Déjà travaillées",
      "ui.dn.p": "Combien de fois, et la dernière.",
      "ui.pause": "Mettre en pause les animations",
      "ui.play": "Relancer les animations",
      "ui.copied": "Copiée",
      "i2.own": "Sur ton propre Supabase, ta ligne arrive une fois le carnet créé : elle porte l’URL et la clé de ton projet. Tu la retrouves à tout moment dans les réglages.",
      "ui.copyHand": "La copie n’a pas marché : la ligne est sélectionnée, copie-la à la main (⌘C ou Ctrl+C).",
      "aria.sections": "Sections",
      "aria.ex": "Exemple",
      "aria.sheet": "Une fiche Reelbook",
      "aria.devices": "Six carnets Reelbook sur une tablette, un carnet ouvert sur un téléphone",
      "aria.session": "Une séance Reelbook",
      "aria.os": "Système"
    },
    "en": {
      "h1": "A Claude Code <span class=\"lp-slash\">/skill</span> that turns your technique videos into a training notebook.",
      "flow.h": "From reel to move.",
      "f1.h": "You spot a video, send it to Reelbook",
      "f1.p": "On TikTok, Instagram, YouTube or Facebook: Share, then Reelbook. Ten seconds, and you keep scrolling.",
      "f2.h": "It becomes a sheet",
      "f2.p": "The move cut into frames, with the cues to remember, a dose and the link to the video.",
      "f3.h": "Sheets become sessions",
      "f3.p": "Mix sheets from all your notebooks, give each one its dose, and train sheet by sheet.",
      "sub": "Reelbook gathers your technique videos into a training notebook. Each video becomes a frame-by-frame sheet, easy to find and to build sessions from.",
      "cta": "Create my notebook",
      "cta2": "See how it works",
      "beta": "Free during the beta",
      "fit": "You need Claude Pro (or higher) with Claude Code, and Chrome on your computer. For TikTok, Instagram, YouTube and Facebook.",
      "ex.l": "See an example:",
      "ex.dance": "Dance",
      "ex.stretch": "Stretch",
      "ex.snow": "Snowboard",
      "ex.hiit": "HIIT",
      "v1.h": "All in one place.",
      "v1.p": "Your coach’s reel on Instagram, a champion’s YouTube breakdown, the TikTok you caught on the train: it all lands in one place, filed by activity and by theme. Search by body zone or gear, and keep your coach’s notes next to the move.",
      "v6.h": "Your activities, your notebooks.",
      "v6.own": "Create your own activity",
      "v6.q": "29 ready-made notebooks. Yours isn’t there?",
      "v3.h": "Sheets become sessions.",
      "v3.p": "Pick from all your notebooks and mix them: technique, mobility and warm-up in the same session. Put the exercises in order, give each one its dose, then follow the session sheet by sheet.",
      "v4.h": "Your progress, sheet by sheet.",
      "v4.p": "New sheets wait at the top of the home page, the ones you’ve never tried resurface on their own, and every “Done today” adds to the sheet’s count.",
      "how.h": "A Claude skill does the work.",
      "how.p": "<strong class=\"lp-brand\">Reelbook</strong> is a skill for Claude Code. With the Claude in Chrome extension, it opens the videos you sent, cuts each one into a sequence of frames and files each sheet in the right notebook.",
      "r1.h": "You send the video",
      "r1.p": "From TikTok, Instagram, YouTube or Facebook: Share, then Reelbook. It joins your queue.",
      "t.l1": "3 videos queued",
      "t.l2": "opening in Chrome",
      "r2.h": "Claude takes over",
      "r2.p": "Type <code>/reelbook</code> in Claude Code, or let it run overnight on your computer.",
      "r3.h": "Chrome opens and reads it",
      "r3.p": "The Claude in Chrome extension watches the video the way you would: the move, the cues, the captions.",
      "r4.h": "The move, cut into frames",
      "r4.p": "The key moments become a sequence of images, with the points to remember, a dose and the link to the video.",
      "r5.h": "Filed in your notebook",
      "r5.p": "Right notebook, right group. Ready to find, annotate and add to a session.",
      "inst.h": "Set up Reelbook.",
      "inst.p": "Before you start: Claude Pro with Claude Code, Chrome with the Claude in Chrome extension, Git and Python 3.9+. Then three things to do once: your account, the skill on your computer, the app on your phone.",
      "i1.h": "Create your notebook",
      "i1.p": "Choose where your sheets live. You can change it later.",
      "i1.a": "Hosted by Reelbook",
      "i1.ad": "Nothing to set up. Free during the beta: 300 sheets, 200 MB of photos, 10 videos a day.",
      "i1.seats": "",
      "wl.h": "Beta full: {total} of {total}",
      "wl.p": "Leave your first name and email: we’ll let you know as soon as a spot opens.",
      "wl.n": "First name",
      "wl.e": "Email",
      "wl.c": "I agree that Reelbook keeps my first name and email to tell me when a spot opens, and for nothing else. Deleted when I sign up or whenever I ask.",
      "wl.cta": "Notify me",
      "i1.b": "On my own Supabase",
      "i1.bd": "Your own project, your limits. Run one SQL file, then paste the URL and key.",
      "i1.cta": "Create my notebook",
      "i2.h": "Install the skill",
      "i2.n": "You need Claude Pro or above with Claude Code, and Chrome with the Claude in Chrome extension.",
      "i2.p": "Paste this line into Terminal. It installs the <code>/reelbook</code> skill and links it to your account.",
      "i2.copy": "Copy the line",
      "i2.pw": "Paste this line into PowerShell. It installs the <code>/reelbook</code> skill and links it to your account.",
      "i3.h": "Add it to your phone",
      "i3.p": "Put Reelbook on your home screen, then the “Send to Reelbook” shortcut in the iPhone Share menu.",
      "i3.p2": "On Android, just paste the link in the app.",
      "i3.cta": "Add the shortcut",
      "d.h": "Day to day.",
      "d1.v": "Send",
      "d1.p": "A technique catches your eye in your feed: Share, Reelbook. Ten seconds, and you keep scrolling.",
      "d2.v": "Run",
      "d2.p": "<code>/reelbook</code> in Claude Code whenever you like, or every night on its own. In the morning, your sheets are there.",
      "d3.v": "Organise",
      "d3.p": "Move a sheet to another group, add your notes, build a session from several notebooks.",
      "d4.v": "Train",
      "d4.p": "Open the sheet or the session on your phone: the move first, in pictures, then the details. Tick “Done today”.",
      "c.p": "Your technique videos, ready for training at last. Free during the beta, 50 spots.",
      "foot": "Personal sheets keep the link to their video and author. The visuals on this page are generated demonstrations. Reelbook is open source, under the MIT licence: <a href=\"https://github.com/lt20/reelbook\" target=\"_blank\" rel=\"noopener\">github.com/lt20/reelbook</a>.",
      "oss.p": "<b>Reelbook is open source.</b> The skill, the app and the server are public on GitHub, under the MIT licence: you can read what you install, and host it yourself.",
      "oss.a": "See the code on GitHub ↗",
      "i2.src": "Read the script before you run it ↗",
      "seats": "{taken} of {total} spots taken",
      "beta.full": "Beta full · join the waiting list",
      "beta.closed": "Beta full",
      "cta.full": "Join the waiting list",
      "i1.cta.full": "Connect my Supabase",
      "ui.nbs": "My notebooks",
      "ui.paste": "Paste a video link…",
      "ui.sheets": "{n} sheets",
      "ui.devices": "6 notebooks · 89 sheets, on your phone and on your tablet.",
      "ui.session": "Session",
      "ui.done": "Done today",
      "ui.new": "New",
      "ui.nw.h": "New",
      "ui.nw.p": "Arrived in the last few days, not opened yet.",
      "ui.tr.h": "To try",
      "ui.tr.p": "Saved a while ago, never practised.",
      "ui.tr.tag": "Never done",
      "ui.dn.h": "Practised",
      "ui.dn.p": "How many times, and the last one.",
      "ui.pause": "Pause the animations",
      "ui.play": "Play the animations",
      "ui.copied": "Copied",
      "i2.own": "On your own Supabase, your line comes once your notebook is created: it carries your project’s URL and key. You can find it again anytime in Settings.",
      "ui.copyHand": "Copying did not work: the line is selected, copy it by hand (⌘C or Ctrl+C).",
      "aria.sections": "Sections",
      "aria.ex": "Example",
      "aria.sheet": "A Reelbook sheet",
      "aria.devices": "Six Reelbook notebooks on a tablet, one notebook open on a phone",
      "aria.session": "A Reelbook session",
      "aria.os": "Operating system"
    }
  };
  const EX = {
    "mma": {
      "nb": "Fight techniques",
      "icon": "fight",
      "col": "#b4432f",
      "url": "reelbook.demo/mma",
      "mine": "fight",
      "fk": "kick",
      "share": [4,"18% 50%"],
      "drawn": {"fr":"Séquence générée et mise en scène : les mêmes sportifs et le même studio dans les six étapes, sans vidéo réelle.","en":"Generated staged sequence: the same athletes and studio in all six steps, not footage from a real video."},
      "crumb": "Fight techniques › Coups de pied et genoux",
      "crumbEn": "Fight techniques › Kicks & knees",
      "title": {"fr":"Coup de pied retourné","en":"Spinning back kick"},
      "frames": ["k01","k02","k03","k04","k05","k06"],
      "alts": {"fr":["En garde, face à la cible","Les pieds croisés","Le tour","Le genou levé","Le coup","Sur la pao"],"en":["On guard","Feet crossed","The turn","Knee up","The kick","On the pad"]},
      "steps": {"fr":[["Départ","En garde, pieds écartés, face à la cible. Si tu tournes comme ça, tu perds l’équilibre : prépare d’abord le tour."],["Croise les pieds","Premier temps : les pieds se croisent, avant de tourner. Le regard reste sur la cible."],["Le tour","Tu tournes sur les pieds croisés, équilibré, le regard déjà tourné vers la cible."],["Le genou monte","Le genou se lève pendant que tu finis le tour : c’est lui qui arme le coup. Le haut du corps accompagne."],["Le coup part","Le buste s’incline et la jambe se tend vers la pao, le talon devant."],["Le coup au foie, sur la pao","Le talon frappe la pao tenue par le partenaire, au niveau du foie. Tour, genou et coup n’en font plus qu’un."]],"en":[["Start","On guard, feet apart, facing the target. Turn from here and you lose your balance: set it up first."],["Cross your feet","First beat: the feet cross before you turn. Your eyes stay on the target."],["The turn","You turn on crossed feet, balanced, eyes already back on the target."],["The knee rises","The knee comes up as you finish the turn: that's what chambers the kick. The upper body follows."],["The kick goes out","The torso leans and the leg extends toward the pad, heel first."],["Kick to the liver, on the pad","The heel lands on the pad your partner holds, at liver height. Turn, knee and kick become one."]]},
      "items": {"neck":{"t":{"fr":"Prise de nuque : le genou à la ceinture","en":"Neck clinch: knee to the belt"},"img":"t-defense-prise-de-nuque","m":{"fr":"10 min · Instagram","en":"10 min · Instagram"},"g":"Clinch & grappling"},"crav":{"t":{"fr":"Sortir d’une cravate debout","en":"Escaping a standing headlock"},"img":"t-sortie-cravate-debout","m":{"fr":"5 min · Instagram","en":"5 min · Instagram"},"g":"Clinch & grappling"},"kick":{"t":{"fr":"Coup de pied retourné","en":"Spinning back kick"},"img":"t-coup-de-pied-tournant-foie","m":{"fr":"6 min · Instagram","en":"6 min · Instagram"},"g":"Kicks & knees"},"foot":{"t":{"fr":"Footwork boxe : le pas dans le cerceau","en":"Boxing footwork: the hoop step"},"img":"t-footwork-drills-boxe","m":{"fr":"4 combinaisons · YouTube","en":"4 combos · YouTube"},"g":"Footwork"}},
      "groupNames": {"fr":{"Clinch & grappling":"Corps à corps","Kicks & knees":"Coups de pied et genoux","Footwork":"Déplacements","Hips":"Hanches"},"en":{"Clinch & grappling":"Clinch & grappling","Kicks & knees":"Kicks & knees","Footwork":"Footwork","Hips":"Hips"}},
      "session": {"title":{"fr":"Jeudi : clinch et kicks","en":"Thursday: clinch and kicks"},"format":{"fr":"3 tours · 60 s de repos","en":"3 rounds · 60 s rest"},"items":[["foot","Fight",{"fr":"3 min","en":"3 min"}],["crav","Fight",{"fr":"5 / côté","en":"5 / side"}],["neck","Fight",{"fr":"5 / côté","en":"5 / side"}],["kick","Fight",{"fr":"8 / côté","en":"8 / side"}]]}
    },
    "dance": {
      "nb": "Dance",
      "icon": "dance",
      "col": "#b23a6e",
      "url": "tiktok.com/@…/video/…",
      "mine": "dance",
      "fk": "pir",
      "drawn": {"fr":"Démonstration générée : images mises en scène, pas une vraie vidéo.","en":"Generated demo: staged images, not a real video."},
      "crumb": "Dance › Tours",
      "crumbEn": "Dance › Turns",
      "title": {"fr":"Pirouette en dehors","en":"Pirouette en dehors"},
      "frames": ["d01","d02","d03","d04","d05","d06"],
      "alts": {"fr":["Préparation en quatrième","Montée en retiré","Début du tour","Rotation, le regard sur son point","Sortie du tour","Réception en quatrième, bras ouverts"],"en":["Preparation in fourth","Rising into retiré","Start of the turn","Rotation, eyes on the spot","Coming out of the turn","Landing in fourth, arms open"]},
      "steps": {"fr":[["Préparation","En quatrième position, genoux pliés, le poids entre les deux pieds. Un bras devant, l’autre ouvert."],["Relevé, retiré","Pousse dans le sol : la jambe d’appui monte, l’autre pied file au genou. Les bras se rassemblent devant toi."],["Le départ","Le corps part d’un bloc, bassin et épaules ensemble. La tête reste sur ton point le plus longtemps possible."],["Le regard","La tête fouette et revient la première sur ton point. Garde le retiré et le dos long pendant toute la rotation."],["La sortie","Le tour s’achève face à ton point. Le pied quitte le genou sans retomber d’un coup, la jambe d’appui reste tendue."],["Réception","Repose le pied derrière en quatrième, plié, et ouvre les bras. Tiens la fin deux temps."]],"en":[["Preparation","Fourth position, knees bent, weight between both feet. One arm in front, the other open."],["Relevé, retiré","Push into the floor: the standing leg rises, the other foot slides up to the knee. The arms gather in front of you."],["The start","The body turns as one block, hips and shoulders together. The head stays on your spot as long as it can."],["Spot","The head whips round and arrives first on your spot. Keep the retiré and a long back through the whole rotation."],["The exit","The turn ends facing your spot. The foot leaves the knee without dropping, the standing leg stays straight."],["Landing","Set the foot down behind in fourth, in plié, and open the arms. Hold the finish for two counts."]]},
      "items": {"pir":{"t":{"fr":"Pirouette en dehors","en":"Pirouette en dehors"},"img":"c-pir","m":{"fr":"3 min · TikTok","en":"3 min · TikTok"},"g":"Tours"},"chaine":{"t":{"fr":"Chaînés en diagonale","en":"Chaînés across the floor"},"img":"c-chaine","m":{"fr":"2 min · Instagram","en":"2 min · Instagram"},"g":"Tours"},"jete":{"t":{"fr":"Grand jeté, sans forcer le grand écart","en":"Grand jeté without forcing the split"},"img":"c-jete","m":{"fr":"4 min · Instagram","en":"4 min · Instagram"},"g":"Sauts"},"pdb":{"t":{"fr":"Port de bras lent","en":"Slow port de bras"},"img":"c-pdb","m":{"fr":"3 min · Instagram","en":"3 min · Instagram"},"g":"Échauffement"}},
      "groupNames": {"fr":{"Tours":"Tours","Sauts":"Sauts","Chorés":"Chorégraphies","Échauffement":"Échauffement"},"en":{"Tours":"Turns","Sauts":"Jumps","Chorés":"Choreography","Échauffement":"Warm-up"}},
      "session": {"title":{"fr":"Mardi : tours et sauts","en":"Tuesday: turns and jumps"},"format":{"fr":"2 passages · 30 s de repos","en":"2 rounds · 30 s rest"},"items":[["pdb","Dance",{"fr":"2 min","en":"2 min"}],["chaine","Dance",{"fr":"2 diagonales","en":"2 diagonals"}],["pir","Dance",{"fr":"8 / côté","en":"8 / side"}],["jete","Dance",{"fr":"4 diagonales","en":"4 diagonals"}]]}
    },
    "stretch": {
      "nb": "Yoga & stretching",
      "icon": "yoga",
      "col": "#2f7a4e",
      "url": "instagram.com/…",
      "mine": "yoga",
      "fk": "diag",
      "share": [4,"50% 50%"],
      "drawn": {"fr":"Démonstration générée d’après un reel Instagram : une autre personne, un autre lieu, les mêmes positions.","en":"Generated demo based on an Instagram reel: another person, another place, the same positions."},
      "crumb": "Yoga & stretching › Hanches",
      "crumbEn": "Yoga & stretching › Hips",
      "title": {"fr":"Étirement en diagonale","en":"Diagonal stretch"},
      "frames": ["st01","st02","st03","st04","st05","st06"],
      "alts": {"fr":["Talons joints, pieds ouverts à 90 degrés","Le pied recule en diagonale","Fente en diagonale, talon arrière levé","Le poids sur la jambe arrière","La main plonge vers la jambe arrière","La position tenue"],"en":["Heels together, feet at 90 degrees","The foot steps back on a diagonal","Diagonal lunge, back heel up","Weight on the back leg","The hand dives to the back leg","Holding the position"]},
      "steps": {"fr":[["Talons joints","Colle tes talons l’un contre l’autre et ouvre les pieds à 90 degrés."],["Pas en diagonale","Recule un pied en diagonale, la pointe derrière le talon, sur une ligne de deux fois la largeur de tes épaules."],["Talon arrière levé","Le pied arrière reste dans l’alignement, talon levé. Les deux jambes sont fléchies."],["Poids vers l’arrière","Mets l’essentiel du poids sur la jambe arrière, le buste droit."],["Plonger vers l’arrière","Touche la jambe arrière avec la main opposée : derrière le genou, puis le mollet ou le talon. Ne tourne pas le buste, imagine que tu plonges vers l’arrière."],["Tenir 10 secondes","10 répétitions de chaque côté ; à la dernière, garde la position 10 secondes. 3 tours."]],"en":[["Heels together","Bring your heels together and open your feet to 90 degrees."],["Diagonal step","Step one foot back on a diagonal, toes behind the heel, on a line twice your shoulder width."],["Back heel up","The back foot stays in line, heel lifted. Both legs are bent."],["Weight back","Put most of your weight on the back leg, torso upright."],["Dive back","Reach the back leg with the opposite hand: behind the knee, then the calf or the heel. Don't twist: imagine diving backwards."],["Hold 10 seconds","10 reps per side; on the last one, hold the position for 10 seconds. 3 rounds."]]},
      "items": {"diag":{"t":{"fr":"Étirement en diagonale","en":"Diagonal stretch"},"img":"st05","m":{"fr":"48 s · Instagram","en":"48 s · Instagram"},"g":"Hanches"},"sal":{"t":{"fr":"Salutation au soleil","en":"Sun salutation"},"img":"y2-salutation","m":{"fr":"5 min · YouTube","en":"5 min · YouTube"},"g":"Enchaînements"},"pigeon":{"t":{"fr":"Le pigeon","en":"Pigeon pose"},"img":"y2-pigeon","m":{"fr":"2 min · Instagram","en":"2 min · Instagram"},"g":"Hanches"},"hips":{"t":{"fr":"Flow hanches : squat large, cosaque, assis","en":"Hip flow: wide squat, cossack, floor sit"},"img":"t-flow-hanches","m":{"fr":"3 min · Instagram","en":"3 min · Instagram"},"g":"Hanches"}},
      "groupNames": {"fr":{"Hanches":"Hanches","Enchaînements":"Enchaînements"},"en":{"Hanches":"Hips","Enchaînements":"Flows"}},
      "session": {"title":{"fr":"Le matin : des hanches libres","en":"Morning: hip opener"},"format":{"fr":"Une fois · à ton rythme","en":"Once through · at your pace"},"items":[["sal","Yoga",{"fr":"3 tours","en":"3 rounds"}],["hips","Yoga",{"fr":"2 tours","en":"2 rounds"}],["diag","Yoga",{"fr":"3×10 / côté","en":"3×10 / side"}],["pigeon","Yoga",{"fr":"1 min / côté","en":"1 min / side"}]]}
    },
    "snow": {
      "nb": "Ski & snowboard",
      "icon": "snow",
      "col": "#a4521a",
      "url": "youtube.com/watch?v=…",
      "mine": "snow",
      "fk": "bsnp",
      "share": [4,"50% 50%"],
      "drawn": {"fr":"Démonstration générée d’après une vidéo YouTube : une autre rideuse, un autre snowpark, les mêmes positions.","en":"Generated demo based on a YouTube video: another rider, another snowpark, the same positions."},
      "crumb": "Ski & snowboard › Park",
      "title": {"fr":"Nose press sur un box","en":"Nose press on a box"},
      "frames": ["sb01","sb02","sb03","sb04","sb05","sb06"],
      "alts": {"fr":["L’approche du box","Le saut sur le box","À plat sur le box","Le poids passe devant","Nose press, l’arrière levé","La sortie en l’air"],"en":["Approaching the box","Popping onto the box","Flat on the box","Weight moves forward","Nose press, tail up","Off the end, in the air"]},
      "steps": {"fr":[["L’approche","Arrive droit sur le box, planche à plat, genoux fléchis, bras ouverts pour l’équilibre."],["Le saut","Petit ollie au bord du box : la planche se pose à plat, dans l’axe du box."],["Sur le box","Planche à plat, le poids centré entre les pieds, genoux souples, le regard vers le bout du box."],["Le poids devant","Avance le bassin et les épaules au-dessus du pied avant : la jambe avant se plie."],["Nose press","Appuie sur le nose : l’arrière de la planche se lève. Bras ouverts, tiens l’appui jusqu’au bout du box."],["La sortie","Au bout du box, saute en ramenant la planche à plat, puis pose-toi genoux fléchis."]],"en":[["The approach","Ride straight at the box, board flat, knees bent, arms out for balance."],["The pop","Small ollie at the edge of the box: the board lands flat, in line with the box."],["On the box","Board flat, weight centred between your feet, soft knees, eyes on the end of the box."],["Weight forward","Move your hips and shoulders over the front foot: the front leg bends."],["Nose press","Press the nose: the tail lifts. Arms out, hold the press to the end of the box."],["The exit","At the end of the box, pop and level the board, then land with bent knees."]]},
      "items": {"bsnp":{"t":{"fr":"Nose press sur un box","en":"Nose press on a box"},"img":"sb05","m":{"fr":"4 min · YouTube","en":"4 min · YouTube"},"g":"Park"},"ollie":{"t":{"fr":"L’ollie à plat","en":"The ollie on flat ground"},"img":"sbt-ollie","m":{"fr":"2 min · TikTok","en":"2 min · TikTok"},"g":"Bases"},"rail":{"t":{"fr":"50-50 sur un rail","en":"50-50 on a rail"},"img":"sbt-rail","m":{"fr":"3 min · Instagram","en":"3 min · Instagram"},"g":"Park"},"fs180":{"t":{"fr":"Frontside 180 sur un kicker","en":"Frontside 180 off a kicker"},"img":"sbt-180","m":{"fr":"6 min · YouTube","en":"6 min · YouTube"},"g":"Sauts"}},
      "groupNames": {"fr":{"Park":"Park","Bases":"Bases","Sauts":"Sauts"},"en":{"Park":"Park","Bases":"Basics","Sauts":"Jumps"}},
      "session": {"title":{"fr":"Samedi : snowpark","en":"Saturday: snowpark"},"format":{"fr":"Sur la piste, puis le park","en":"On the piste, then the park"},"items":[["ollie","Snow",{"fr":"5 à plat","en":"5 on flat"}],["bsnp","Snow",{"fr":"5 passages","en":"5 runs"}],["rail","Snow",{"fr":"5 passages","en":"5 runs"}],["fs180","Snow",{"fr":"3 essais","en":"3 tries"}]]}
    },
    "hiit": {
      "nb": "Strength",
      "icon": "strength",
      "col": "#5f7d1a",
      "url": "tiktok.com/@…/video/…",
      "mine": "strength",
      "fk": "hiit",
      "share": [5,"50% 50%"],
      "drawn": {"fr":"Démonstration générée et mise en scène : la même personne et la même salle dans les six étapes, sans vidéo réelle.","en":"Generated staged demo: the same person and room in all six steps, not footage from a real video."},
      "crumb": "Strength › HIIT",
      "title": {"fr":"Pompe, touches et squat sauté","en":"Push-up, taps and jump squat"},
      "frames": ["hi-plank","hi03","hi04","hi-foot","hi-tuck","hi06"],
      "alts": {"fr":["Planche, bras tendus","La pompe, poitrine près du sol","La touche d’épaule","La touche de pied, hanches hautes","Les pieds reviennent sous les hanches","Le squat sauté"],"en":["High plank, arms straight","The push-up, chest near the floor","The shoulder tap","The foot touch, hips high","Feet jump in under the hips","The jump squat"]},
      "steps": {"fr":[["Planche","Bras tendus sous les épaules, le corps aligné de la tête aux talons, pieds écartés de la largeur des hanches."],["Pompe","Descends la poitrine près du sol, coudes vers l’arrière, puis repousse. Le bassin ne s’affaisse pas."],["Touche d’épaule","En haut, touche l’épaule opposée d’une main, puis de l’autre. Les hanches restent face au sol."],["Touche de pied","Monte les hanches en V inversé et va toucher le pied opposé d’une main. Change de côté à chaque répétition."],["Pieds sous les hanches","Saute pour ramener les pieds près des mains, en squat profond, la poitrine qui se relève."],["Squat sauté","Pousse dans le sol et saute, bras au-dessus de la tête. Reviens en planche et enchaîne : 30 secondes, 10 s de repos, 5 tours."]],"en":[["Plank","Arms straight under the shoulders, body in one line from head to heels, feet hip-width apart."],["Push-up","Lower your chest close to the floor, elbows back, then push up. Don't let the hips sag."],["Shoulder tap","At the top, tap the opposite shoulder with one hand, then the other. Hips stay square to the floor."],["Foot touch","Lift the hips into an inverted V and reach one hand to the opposite foot. Switch sides every rep."],["Feet in","Jump the feet in next to the hands into a deep squat, chest lifting."],["Jump squat","Drive through the floor and jump, arms overhead. Back down to the plank and go again: 30 seconds, 10 s rest, 5 rounds."]]},
      "items": {"hiit":{"t":{"fr":"Pompe, touches et squat sauté","en":"Push-up, taps and jump squat"},"img":"hi04","m":{"fr":"1 min · TikTok","en":"1 min · TikTok"},"g":"HIIT"},"squat":{"t":{"fr":"Goblet squat","en":"Goblet squat"},"img":"n-str-1","m":{"fr":"3 min · YouTube","en":"3 min · YouTube"},"g":"Jambes"},"pushup":{"t":{"fr":"La pompe, sans creuser le dos","en":"The push-up, without sagging"},"img":"n-str-3","m":{"fr":"1 min · TikTok","en":"1 min · TikTok"},"g":"Haut du corps"},"dl":{"t":{"fr":"Soulevé de terre","en":"Deadlift"},"img":"n-str-2","m":{"fr":"5 min · YouTube","en":"5 min · YouTube"},"g":"Dos"}},
      "groupNames": {"fr":{"HIIT":"HIIT","Jambes":"Jambes","Haut du corps":"Haut du corps","Dos":"Dos"},"en":{"HIIT":"HIIT","Jambes":"Legs","Haut du corps":"Upper body","Dos":"Back"}},
      "session": {"title":{"fr":"Lundi : HIIT et force","en":"Monday: HIIT and strength"},"format":{"fr":"Force, puis HIIT · 60 s de repos","en":"Strength, then HIIT · 60 s rest"},"items":[["dl","Strength",{"fr":"3×5","en":"3×5"}],["squat","Strength",{"fr":"3×10","en":"3×10"}],["pushup","Strength",{"fr":"3×8","en":"3×8"}],["hiit","Strength",{"fr":"5 tours","en":"5 rounds"}]]}
    }
  };
  const YOGA = {
    "items": {
      "sal": {"t":{"fr":"Salutation au soleil : la montée des bras","en":"Sun salutation: the upward reach"},"g":{"fr":"Enchaînements","en":"Flows"},"img":"y2-salutation"},
      "chien": {"t":{"fr":"Chien tête en bas","en":"Downward dog"},"g":{"fr":"Dos","en":"Back"},"img":"y2-chien"},
      "corbeau": {"t":{"fr":"Le corbeau","en":"Crow pose"},"g":{"fr":"Épaules","en":"Shoulders"},"img":"y2-corbeau"},
      "guerrier": {"t":{"fr":"Guerrier II","en":"Warrior II"},"g":{"fr":"Jambes","en":"Legs"},"img":"y2-guerrier"},
      "pigeon": {"t":{"fr":"Le pigeon","en":"Pigeon pose"},"g":{"fr":"Hanches","en":"Hips"},"img":"y2-pigeon"}
    },
    "progress": {
      "nw": ["sal","chien"],
      "tr": ["corbeau"],
      "dn": [["guerrier",{"fr":"6 fois · mardi","en":"6 times · Tuesday"}],["pigeon",{"fr":"3 fois · jeudi dernier","en":"3 times · last Thursday"}]]
    }
  };
  const LIB = [["fight","Fight techniques",2],["dance","Dance",5],["pole","Pole dance",5],["yoga","Yoga & stretching",1],["pilates","Pilates",5],["barre","Barre",5],["strength","Strength",0],["climb","Climbing & bouldering",4],["kitesurf","Kitesurf",3],["surf","Surfing",3],["run","Running",4],["racket","Tennis & padel",4],["kitefoil","Kitefoil",3],["wingfoil","Wingfoil",3],["wakeboard","Wakeboard",3],["swim","Swimming",3],["bike","Cycling",4],["hike","Hiking & trail",4],["snow","Ski & snowboard",4],["ride","Horse riding",4],["golf","Golf",4],["mobility","Mobility & rehab",1],["prenatal","Prenatal & postnatal",5],["floor","Pelvic floor & core",5],["breath","Breathwork & meditation",1],["cook","Cooking",6],["nutrition","Nutrition & meal prep",6],["beauty","Beauty & skincare",7],["crafts","Sewing & crafts",7]];
  const PAL = ["#5f7d1a","#3f8f5f","#b4432f","#1d7a8c","#c2651d","#b23a6e","#8a6a12","#6b4fa3"];
  // @gen-end
  // The screens around the landing: sign-up / sign-in (a.*), #setup (s.*), #welcome (w.*), aria labels the mockup
  // leaves in French (aria.*). English is the app's copy as it was; French follows the mockup's tone (tu).
  const APP = {
    fr: {
      'a.in': 'Se connecter', 'a.up': 'Créer un compte', 'a.submitUp': 'Créer le compte', 'a.have': 'J’ai déjà un compte',
      'a.email': 'E-mail', 'a.pass': 'Mot de passe', 'a.backend': 'Serveur :', 'a.none': 'Aucun serveur choisi',
      'a.own': 'Utiliser mon propre Supabase', 'a.change': 'Changer d’instance', 'a.hosted': ' · Utiliser Reelbook hébergé',
      'a.ownh': 'Connecter ta propre instance', 'a.ownp': 'Indique une fois sur cet appareil les informations de ton projet Supabase. Guide d’installation :',
      'a.url': 'URL du projet', 'a.key': 'Clé anon', 'a.useown': 'Utiliser cette instance', 'a.cancel': 'Annuler', 'a.demo': 'Voir une démo',
      'demo.up': 'Démo · lecture seule · Créer un compte', 'demo.back': 'Démo · lecture seule · Revenir à mes carnets', // L38: the #demo banner
      'a.created': 'Compte créé. Confirme ton e-mail avec le lien reçu dans ta boîte, puis connecte-toi.',
      'a.fail': 'Connexion impossible.', 'a.e.up': 'Impossible de créer le compte.',
      'a.e.creds': 'E-mail ou mot de passe incorrect.', 'a.e.exists': 'Un compte existe déjà avec cet e-mail : connecte-toi plutôt.',
      'a.e.confirm': 'Confirme d’abord ton e-mail avec le lien reçu dans ta boîte, puis connecte-toi.',
      'a.e.weak': 'Ce mot de passe est trop faible : choisis-en un plus long.', 'a.e.email': 'Cette adresse e-mail n’est pas valide.',
      'a.e.rate': 'Trop d’essais : réessaie dans quelques minutes.', 'a.e.closed': 'Ce serveur ne prend pas de nouveaux comptes.',
      'a.e.offline': 'Le serveur n’a pas répondu : vérifie ta connexion et réessaie.',
      'a.badUrl': 'Cette URL n’est pas valide.', 'a.badProto': 'Indique une URL de projet en http ou https.',
      'a.badKey': 'Cela ne ressemble pas à une clé anon.',
      's.h1': 'Tes vidéos, en fiches',
      's.lead': 'Colle les vidéos que tu veux garder (Instagram, TikTok, YouTube, Facebook) : un geste, une technique, une recette. Claude Code fait de chacune une fiche avec photos et points clés, rangée dans tes carnets.',
      's.h2': 'Où vivra ton nouveau compte ?', 's.own': 'Mon propre projet Supabase',
      's.ownd': 'L’offre gratuite suffit. Tu lances un fichier SQL, puis tu colles ici l’URL du projet et la clé anon.',
      's.where': 'Les deux sont dans le tableau de bord Supabase, sous Project settings → API. La clé anon peut rester dans un navigateur : la sécurité au niveau des lignes garde tes données à toi. Guide d’installation :',
      's.use': 'Utiliser ce projet', 's.back': 'Retour', 's.have': 'Tu as déjà un compte ?', 's.unavailable': 'Pas encore disponible.',
      's.blurb': 'Gratuit pour l’instant. Une offre hébergée payante est prévue ; rien à configurer.',
      'w.eyebrow': 'Bienvenue dans Reelbook', 'w.h1': 'Comment ça marche',
      'w.1h': '1 · Garde des vidéos sur ton téléphone',
      'w.1p': 'Une vidéo vaut la peine d’être gardée : touche <b>+ Add a video</b> et colle le lien. Elle attend dans la file. Le téléphone ne fait rien de plus.',
      'w.2h': '2 · Claude en fait des fiches',
      'w.2p': 'De temps en temps, quand quelques vidéos attendent, tu lances le skill Reelbook sur ton ordinateur. Claude ouvre chaque vidéo, la regarde, choisit les images clés et écrit une fiche : photos, pourquoi c’est utile, points clés, les étapes dans l’ordre.',
      'w.need': 'Ce qu’il faut sur cet ordinateur',
      'w.need1': '<a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude Code</a> (terminal, application de bureau ou VS Code), abonnement Pro ou plus.',
      'w.need2': 'Chrome avec l’extension <a href="https://claude.com/chrome" target="_blank" rel="noopener">Claude in Chrome</a>.',
      'w.need3': 'Être connecté à Instagram, TikTok et/ou Facebook dans ce Chrome (YouTube ne demande pas de connexion).',
      'w.run': 'Comment se passe une séance de traitement',
      'w.run1': 'Ouvre Claude Code et tape <code>/reelbook</code>. Claude lit ta file et traite les vidéos une par une.',
      'w.run2': 'Garde Chrome ouvert, pas réduit, avec l’onglet de la vidéo devant : la vidéo ne se lit pas en arrière-plan.',
      'w.run3': 'Compte 10 à 15 minutes par fiche. Tu peux laisser l’ordinateur travailler.',
      'w.run4': 'Sur un Mac, il peut tourner chaque nuit à la place : <code>tools/nightly.sh install</code> dans le dossier Reelbook. Laisse le Mac branché avec Chrome ouvert ; un écran verrouillé ne gêne pas.',
      'w.3h': '3 · Prépare l’ordinateur, une seule fois',
      'w.3p': 'Colle une ligne dans un terminal. Elle installe le code, les outils Python et le skill, puis demande l’e-mail et le mot de passe que tu viens de choisir.',
      'w.3again': 'Tu retrouves ces lignes à tout moment dans les réglages.', 'w.done': 'Ouvrir mes carnets',
      'w.copy': 'Copier', 'w.send': 'Envoyer à mon ordinateur'
    },
    en: {
      'a.in': 'Sign in', 'a.up': 'Create an account', 'a.submitUp': 'Create account', 'a.have': 'I already have an account',
      'a.email': 'Email', 'a.pass': 'Password', 'a.backend': 'Backend:', 'a.none': 'No backend selected',
      'a.own': 'Use my own Supabase', 'a.change': 'Change instance', 'a.hosted': ' · Use Reelbook hosted',
      'a.ownh': 'Connect your own instance', 'a.ownp': 'Enter your Supabase project details once on this device. Setup guide:',
      'a.url': 'Project URL', 'a.key': 'Anon key', 'a.useown': 'Use this instance', 'a.cancel': 'Cancel', 'a.demo': 'See a demo',
      'demo.up': 'Demo · read only · Create an account', 'demo.back': 'Demo · read only · Back to my notebooks', // L38: the #demo banner
      'a.created': 'Account created. Check your inbox to confirm your email, then sign in.',
      'a.fail': 'Could not sign in.', 'a.e.up': 'Could not create the account.',
      'a.e.creds': 'Wrong email or password.', 'a.e.exists': 'An account already exists with this email: sign in instead.',
      'a.e.confirm': 'Confirm your email first with the link in your inbox, then sign in.',
      'a.e.weak': 'That password is too weak: choose a longer one.', 'a.e.email': 'That email address is not valid.',
      'a.e.rate': 'Too many attempts: try again in a few minutes.', 'a.e.closed': 'This server does not take new accounts.',
      'a.e.offline': 'The server did not answer: check your connection and try again.',
      'a.badUrl': 'That URL is not valid.', 'a.badProto': 'Use an http or https project URL.',
      'a.badKey': 'That does not look like an anon key.',
      's.h1': 'Your videos, as sheets',
      's.lead': 'Paste the videos you want to keep (Instagram, TikTok, YouTube, Facebook): a move, a technique, a recipe. Claude Code turns each one into a sheet with photos and key points, filed in your notebooks.',
      's.h2': 'Where should your new account live?', 's.own': 'My own Supabase project',
      's.ownd': 'Free tier is enough. You run one SQL file, then paste the project URL and anon key here.',
      's.where': 'Both are in your Supabase dashboard under Project settings → API. The anon key is safe to keep in a browser: row level security keeps your data yours. Setup guide:',
      's.use': 'Use this project', 's.back': 'Back', 's.have': 'Already have an account?', 's.unavailable': 'Not available yet.',
      's.blurb': null,
      'w.eyebrow': 'Welcome to Reelbook', 'w.h1': 'How it works',
      'w.1h': '1 · Save videos on your phone',
      'w.1p': 'A video is worth keeping: tap <b>+ Add a video</b> and paste the link. It waits in the queue. That is all the phone does.',
      'w.2h': '2 · Claude turns them into sheets',
      'w.2p': 'Every now and then, when a few videos are waiting, you run the Reelbook skill on your computer. Claude opens each video, watches it, picks the key frames and writes a sheet: photos, why it matters, key points, the steps in order.',
      'w.need': 'What you need on that computer',
      'w.need1': '<a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude Code</a> (terminal, desktop app or VS Code), Pro plan or above.',
      'w.need2': 'Chrome with the <a href="https://claude.com/chrome" target="_blank" rel="noopener">Claude in Chrome</a> extension.',
      'w.need3': 'Being signed in to Instagram, TikTok and/or Facebook in that Chrome (YouTube needs no sign-in).',
      'w.run': 'How a run goes',
      'w.run1': 'Open Claude Code and type <code>/reelbook</code>. Claude reads your queue and processes the videos one by one.',
      'w.run2': 'Keep Chrome open, not minimised, with the video tab in front: the video does not play in the background.',
      'w.run3': 'Expect 10 to 15 minutes per sheet. You can leave the computer to it.',
      'w.run4': 'On a Mac, it can run every night instead: <code>tools/nightly.sh install</code> in the Reelbook folder. Leave the Mac plugged in with Chrome open; a locked screen is fine.',
      'w.3h': '3 · Set up the computer, once',
      'w.3p': 'Paste one line in a terminal. It installs the code, the Python tools and the skill, then asks for the email and password you just chose.',
      'w.3again': 'You can find these lines again anytime in Settings.', 'w.done': 'Open my notebooks',
      'w.copy': 'Copy', 'w.send': 'Send to my computer'
    }
  };
  // s.blurb: English is the blurb of config.js (a fork writes its own); French only replaces it.
  const DICT = {fr: Object.assign({}, LANDING.fr, APP.fr), en: Object.assign({}, LANDING.en, APP.en)};
  delete DICT.en['s.blurb'];

  const STORE = 'rb.lang', EX_STORE = 'rb.landing.ex';
  const pickLang = (saved, nav) => (saved === 'fr' || saved === 'en') ? saved : /^fr(?:[-_]|$)/i.test(String(nav || '')) ? 'fr' : 'en';
  const ls = {
    get: k => { try { return win.localStorage ? win.localStorage.getItem(k) : null; } catch (e) { return null; } },
    set: (k, v) => { try { if (win.localStorage) win.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  let lang = pickLang(ls.get(STORE), win.navigator && win.navigator.language);
  const t = k => { const v = DICT[lang][k]; return v != null ? v : DICT.en[k]; };
  const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k] == null ? '' : String(o[k]));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const $ = id => doc ? doc.getElementById(id) : null;
  const all = (sel, root) => { const r = root || doc; return r && r.querySelectorAll ? Array.prototype.slice.call(r.querySelectorAll(sel)) : []; };
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
  const setHtml = (id, v) => { const el = $(id); if (el) el.innerHTML = v; };
  const toggle = (el, c, on) => { if (el && el.classList && el.classList.toggle) el.classList.toggle(c, on); };

  // ---------- pictures: assets/<folder>/<name>.jpg (frame) and <name>-t.jpg (thumbnail) ----------
  const DIR = n => /^(k0|f-|t-(?!flow))/.test(n) ? 'mma' : /^(d0|c-)/.test(n) ? 'dance' : /^st/.test(n) ? 'stretch' : /^sb/.test(n) ? 'snow' : /^hi/.test(n) ? 'hiit' : /^n-/.test(n) ? 'notebooks' : 'yoga';
  const full = n => 'assets/' + DIR(n) + '/' + n + '.jpg';
  const thumb = n => 'assets/' + DIR(n) + '/' + n + '-t.jpg';
  const img = (src, eager, style) => '<img src="' + src + '" alt=""' + (eager ? '' : ' loading="lazy" decoding="async"') + (style ? ' style="' + style + '"' : '') + '>';

  // the mockup's three drawn pictograms (the route's notebook badge); the others are the notebooks' (icons.svg)
  const IC = {
    fight: '<path d="M8.5 15V8.5A4.5 4.5 0 0 1 13 4h.5A4.5 4.5 0 0 1 18 8.5V12a3 3 0 0 1-3 3z"/><path d="M8.5 13H7a2.25 2.25 0 0 1 0-4.5h1.5M8.5 10.75H12"/><rect x="8.5" y="15" width="9" height="5" rx="1"/>',
    dance: '<path d="M9 18V5.5l10-2V16M9 9.5l10-2"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    yoga: '<path d="M12 4.5c2.6 2.9 2.6 8.1 0 11-2.6-2.9-2.6-8.1 0-11z"/><path d="M12 15.5c-4 0-7-2.4-7.6-6 3.2 0 6 2 7.6 6zM12 15.5c4 0 7-2.4 7.6-6-3.2 0-6 2-7.6 6z"/><path d="M5 19.5h14"/>'
  };
  const nbIco = id => '<svg aria-hidden="true"><use href="icons.svg#nb-' + id + '"/></svg>';
  const icon = k => IC[k] ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>' : nbIco(k);

  // « Tout au même endroit »: the app home on a tablet (six notebooks) and the Yoga notebook open on a phone
  const T = (fr, en) => ({fr, en});
  const SUB = {
    fight: T('Frappes, défense, clinch.', 'Striking, defence, clinch.'), yoga: T('Postures, étirements, respiration.', 'Poses, stretches, breathing.'),
    dance: T('Pas, combinaisons, musicalité.', 'Steps, combos, musicality.'), snow: T('Park, carving, hors-piste.', 'Park, carving, off-piste.'),
    cook: T('Techniques, recettes, gestes.', 'Techniques, recipes, skills.'), strength: T('Mouvements, programmes, charges.', 'Lifts, programs, loads.')
  };
  const NBS = [['fight', 'Fight techniques', 2, 8, ['f-nuque', 'f-osoto', 'f-cravate']], ['yoga', 'Yoga & stretching', 1, 14, ['y2-salutation', 'y2-chien', 'y2-guerrier']],
    ['dance', 'Dance', 5, 12, ['c-pir', 'c-chaine', 'c-jete']], ['snow', 'Ski & snowboard', 4, 11, ['sb05', 'sb03', 'sb01']],
    ['cook', 'Cooking', 6, 23, ['n-cook-1', 'n-cook-2', 'n-cook-3']], ['strength', 'Strength', 0, 21, ['n-str-1', 'n-str-2', 'n-str-3']]];
  const PHONE = [[T('Postures', 'Poses'), 5, ['y-guerrier', 'y-corbeau', 'y-pigeon']], [T('Enchaînements', 'Flows'), 4, ['y2-salutation', 'y-salutation', 'y2-chien']],
    [T('Dos', 'Back'), 2, ['y-chien', 'y2-guerrier', 'y-pigeon']], [T('Hanches', 'Hips'), 3, ['y-pigeon', 't-flow-hanches', 'y-guerrier']]];

  let ex = EX[ls.get(EX_STORE)] ? ls.get(EX_STORE) : 'mma', step = 0, timer = null, paused = false;
  const tr = o => o && typeof o === 'object' && ('fr' in o) ? o[lang] : o;
  const X = () => EX[ex];
  const nF = () => X().frames.length;
  const frame = (i, eager, style) => img(full(X().frames[i]), eager, style);
  const pic = key => '<div class="lp-pic">' + img(thumb(X().items[key].img)) + '</div>';
  const gname = g => { const e = X(); return (e.groupNames && e.groupNames[lang][g]) || g; };

  // ---------- step 2: the small animated sheet ----------
  const shotEl = $('lp-shot'), shotStatic = shotEl && typeof shotEl.innerHTML === 'string' ? shotEl.innerHTML : '';
  const show = k => {
    step = k; const e = X();
    all('div', $('lp-shot')).forEach((d, j) => toggle(d, 'lp-on', j === k));
    all('button', $('lp-thumbs')).forEach((b, j) => b.setAttribute('aria-current', String(j === k)));
    setText('lp-num', k + 1);
    setText('lp-stepName', e.steps[lang][k][0]); setText('lp-cue', e.steps[lang][k][1]);
  };
  const ppLabel = () => { const pp = $('lp-pp'); if (!pp) return; toggle(pp, 'lp-paused', paused); pp.setAttribute('aria-label', t(paused ? 'ui.play' : 'ui.pause')); };
  const buildPlayer = () => {
    const e = X(), N = nF(), alts = tr(e.alts);
    if (step >= N) step = 0;
    setHtml('lp-shot', shotStatic + e.frames.map((f, i) => '<div role="img" aria-label="' + esc(alts[i]) + '"' + (i === step ? ' class="lp-on"' : '') + '>' + frame(i, i === step) + '</div>').join(''));
    setHtml('lp-thumbs', e.frames.map((f, i) => '<button type="button" data-i="' + i + '" aria-label="' + (i + 1) + ' / ' + N + ' · ' + esc(alts[i]) + '" aria-current="' + (i === step) + '"></button>').join(''));
    setText('lp-pCrumb', lang === 'en' && e.crumbEn ? e.crumbEn : e.crumb);
    setText('lp-pTitle', tr(e.title));
    setText('lp-drawn', tr(e.drawn));
    ppLabel(); show(step);
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  // ---------- the interface fragments (tablet and phone, sessions, progress, route) ----------
  const renderAll = () => {
    const e = X(), intro = $('intro');
    if (intro) { intro.setAttribute('data-ex', ex); if (intro.style && intro.style.setProperty) intro.style.setProperty('--nb', e.col); }
    buildPlayer();
    const sheets = n => fill(t('ui.sheets'), {n});
    const nbs = NBS.filter(n => n[0] === e.mine).concat(NBS.filter(n => n[0] !== e.mine));
    const tab = '<div class="lp-dv-tab"><div class="lp-dv-bar"><b>reelbook</b><span>' + t('ui.nbs') + '</span></div><div class="lp-dv-add">' + t('ui.paste') + '<i>+</i></div><div class="lp-dv-grid">' + nbs.map(n =>
      '<div class="lp-dv-nb" style="--t:' + PAL[n[2]] + '"><div class="lp-dv-cv"><i>' + nbIco(n[0]) + '</i><span><small>' + sheets(n[3]) + '</small><b>' + esc(n[1]) + '</b></span></div><p class="lp-dv-sub">' + tr(SUB[n[0]]) + '</p><div class="lp-dv-th">' + n[4].map(f => img(thumb(f))).join('') + '</div></div>').join('') + '</div></div>';
    const prow = (g, n, fs) => '<div class="lp-dv-g"><b>' + tr(g) + ' <span>' + n + '</span></b><div class="lp-dv-row">' + fs.map(f => img(thumb(f))).join('') + '</div></div>';
    const ph = '<div class="lp-dv-ph" style="--t:' + PAL[1] + '"><div class="lp-dv-cv"><i>' + nbIco('yoga') + '</i><span><small>' + sheets(14) + '</small><b>Yoga &amp; stretching</b></span></div>' + PHONE.map(r => prow(r[0], r[1], r[2])).join('') + '</div>';
    setHtml('lp-nbUi', '<div class="lp-dv-stage">' + tab + ph + '</div><figcaption>' + t('ui.devices') + '</figcaption>');
    const ss = e.session;
    setHtml('lp-sessionUi', '<span class="lp-meta">' + t('ui.session') + ' · ' + esc(e.nb) + '</span><div class="lp-st">' + tr(ss.title) + '</div><span class="lp-meta">' + tr(ss.format) + '</span>' +
      '<ol>' + ss.items.map(r => { const it = e.items[r[0]]; return '<li>' + pic(r[0]) + '<span><b>' + tr(it.t) + '</b><small><i>' + r[1] + '</i>' + gname(it.g) + '</small></span><span class="lp-dose">' + tr(r[2]) + '</span></li>'; }).join('') + '</ol>' +
      '<span class="lp-done">' + t('ui.done') + '</span>');
    setHtml('lp-sessionMini', '<span class="lp-m">' + t('ui.session') + ' · ' + tr(ss.format) + '</span><b class="lp-st">' + tr(ss.title) + '</b>' +
      '<ol>' + ss.items.slice(0, 3).map(r => '<li>' + pic(r[0]) + '<span>' + tr(e.items[r[0]].t) + '</span><span class="lp-dose">' + tr(r[2]) + '</span></li>').join('') + '</ol>' +
      '<span class="lp-done">' + t('ui.done') + '</span>');
    setHtml('lp-seq', e.frames.map((f, q) => '<div data-frame="' + q + '"></div>').join(''));
    const p = YOGA.progress;
    const it2 = (k, tag) => { const it = YOGA.items[k]; return '<div class="lp-it"><div class="lp-pic">' + img(thumb(it.img)) + '</div><span><b>' + tr(it.t) + '</b><small class="lp-ynb">Yoga &amp; stretching · ' + tr(it.g) + '</small>' + tag + '</span></div>'; };
    const shelf = (h, d, rows) => '<div data-ui class="lp-shelf"><h3>' + h + '</h3><p>' + d + '</p><div class="lp-items">' + rows + '</div></div>';
    setHtml('lp-progressUi',
      shelf(t('ui.nw.h'), t('ui.nw.p'), p.nw.map(k => it2(k, '<span class="lp-tag-new">' + t('ui.new') + '</span>')).join('')) +
      shelf(t('ui.tr.h'), t('ui.tr.p'), p.tr.map(k => it2(k, '<span class="lp-tag-try">' + t('ui.tr.tag') + '</span>')).join('')) +
      shelf(t('ui.dn.h'), t('ui.dn.p'), p.dn.map(r => it2(r[0], '<span class="lp-tag-done">' + tr(r[1]) + '</span>')).join('')));
    all('#intro [data-frame]').forEach(el => { el.innerHTML = frame(+el.getAttribute('data-frame')); });
    const sh = e.share || [4, '50% 50%'];
    all('#intro [data-share]').forEach(el => { el.innerHTML = frame(sh[0], false, 'object-position:' + sh[1]); });
    setText('lp-rUrl', e.url);
    const fk = e.fk;
    setHtml('lp-routeNb', '<div class="lp-h"><span class="lp-ui-badge">' + icon(e.icon) + '</span>' + esc(e.nb) + '</div><div class="lp-g">' + gname(e.items[fk].g) + '</div>' + pic(fk) + '<b>' + tr(e.items[fk].t) + '</b><span class="lp-tag-new">' + t('ui.new') + '</span>');
    all('#intro .lp-ex button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-ex') === ex)));
  };

  // « Tes activités, tes carnets »: the 29 notebooks of config.js, twice for the endless band (the copy hidden)
  const renderLib = () => {
    const one = LIB.map(l => '<span class="lp-lib-t" role="listitem"><i style="background:' + PAL[l[2]] + '">' + nbIco(l[0]) + '</i>' + esc(l[1]) + '</span>').join('');
    setHtml('lp-lib', '<div class="lp-set" role="list">' + one + '</div><div class="lp-set" aria-hidden="true">' + one + '</div>');
  };

  // ---------- the beta (beta_seats(), L32: {taken, total, open} or null) ----------
  let seatData = null;
  const seatsOf = d => {
    const o = Array.isArray(d) ? d[0] : d;
    if (!o || typeof o !== 'object' || o.taken == null || o.total == null) return null;
    const taken = Number(o.taken), total = Number(o.total);
    if (!(Number.isFinite(taken) && Number.isFinite(total) && total > 0 && taken >= 0)) return null;
    const tot = Math.round(total), tk = Math.min(Math.round(taken), tot);
    return {taken: tk, total: tot, full: tk >= tot || o.open === false};
  };
  const isFull = () => !!(seatData && seatData.full);
  // The waiting list (its table and its sending) comes with L31. Until then a full beta promises no sign-up: the card
  // says the beta is full, without the form, the hero line without « join the waiting list », the buttons lead to
  // step 1, where « On my own Supabase » stays open. L31 sets this to true once « Notify me » records something.
  const WAITLIST = false;
  // « Create my notebook » of step 1 hides on a full beta until « On my own Supabase » is picked
  const syncCta = () => { const cta = $('intro-signup'), own = $('lp-host-own'); if (cta) cta.hidden = isFull() && !(own && own.checked); };
  const paintSeats = () => {
    const s = seatData, fullB = isFull(), n = s ? fill(t('seats'), s) : '';
    const bar = $('lp-seatsBar');
    if (bar) { bar.hidden = !s; const i = bar.querySelector ? bar.querySelector('i') : null; if (s && i && i.style) i.style.width = Math.round(100 * s.taken / s.total) + '%'; }
    setText('lp-betaLine', fullB ? t(WAITLIST ? 'beta.full' : 'beta.closed') : s ? t('beta') + ' · ' + n : t('beta'));
    const line = $('lp-seatline'); if (line) { line.hidden = !s; line.textContent = n; }
    if (fullB) { const o = $('lp-host-hosted-opt'), r = $('lp-host-hosted'); if (o) o.hidden = true; if (r) r.checked = false; }
    const card = $('lp-host-full'); if (card) card.hidden = !fullB;
    if (s) { setText('lp-wlH', fill(t('wl.h'), s)); setText('lp-lockN', s.total); }
    const wl = $('lp-wl'), wlp = $('lp-wlP'); if (wl) wl.hidden = !WAITLIST; if (wlp) wlp.hidden = !WAITLIST;
    toggle($('lp-installList'), 'lp-full', fullB);
    setText('intro-signup', t(fullB ? 'i1.cta.full' : 'i1.cta'));
    all('#intro [data-k="cta"]').forEach(b => { b.textContent = t(fullB && WAITLIST ? 'cta.full' : 'cta'); });
    syncCta();
  };
  const seats = d => { seatData = seatsOf(d); paintSeats(); return !!seatData; };

  // ---------- language ----------
  const listeners = [];
  const apply = () => {
    if (doc && doc.documentElement) doc.documentElement.lang = lang;
    all('[data-k]').forEach(el => { const v = t(el.getAttribute('data-k')); if (v != null) el.innerHTML = v; });
    all('[data-ka]').forEach(el => { const v = t(el.getAttribute('data-ka')); if (v != null) el.setAttribute('aria-label', v); });
    all('#intro .lp-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)));
    if ($('intro')) { renderLib(); renderAll(); paintSeats(); }
  };
  const setLang = l => {
    if (l !== 'fr' && l !== 'en') return;
    lang = l; ls.set(STORE, l); apply();
    listeners.forEach(fn => { try { fn(lang); } catch (e) { /* a listener never stops the others */ } });
  };
  const setExample = x => { if (!EX[x]) return; ex = x; step = 0; ls.set(EX_STORE, x); renderAll(); };

  // ---------- page behaviour (only where the landing is in the page) ----------
  const reduce = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const intro = $('intro');
  const on = (el, type, fn, opts) => { if (el && el.addEventListener) el.addEventListener(type, fn, opts); };
  const shown = () => intro && !intro.hidden;
  const live = v => { const cue = $('lp-cue'); if (cue) cue.setAttribute('aria-live', v); };
  const start = () => {
    stop(); live('off');
    if (typeof setInterval === 'function') timer = setInterval(() => { if (shown() && !(doc && doc.hidden)) show((step + 1) % nF()); }, 2600);
  };
  if (intro) {
    all('#intro .lp-lang button').forEach(b => on(b, 'click', () => setLang(b.getAttribute('data-lang'))));
    all('#intro .lp-ex button').forEach(b => on(b, 'click', () => setExample(b.getAttribute('data-ex'))));
    on($('lp-thumbs'), 'click', ev => { const b = ev.target && ev.target.closest ? ev.target.closest('button[data-i]') : null; if (b) { stop(); live('polite'); show(+b.getAttribute('data-i')); } });
    // in-page links scroll; the app routes on location.hash, so the hash never changes here. #signin, #signup and
    // #shortcut are the app's (its listeners on #intro-signin, #intro-signup and #intro-shortcut).
    on(intro, 'click', ev => {
      const pp = ev.target && ev.target.closest ? ev.target.closest('#lp-pp') : null;
      if (pp) {
        paused = !paused; toggle($('lp-top'), 'lp-anim-off', paused);
        if (paused) { stop(); live('polite'); } else start();
        ppLabel(); return;
      }
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
      if (!a) return;
      ev.preventDefault();
      const h = a.getAttribute('href'), behavior = reduce ? 'auto' : 'smooth';
      if (h === '#lp-top') { if (win.scrollTo) win.scrollTo({top: 0, behavior}); return; }
      const target = h.indexOf('#lp-') === 0 ? $(h.slice(1)) : null;
      if (target && target.scrollIntoView) target.scrollIntoView({behavior, block: 'start'});
    });
    on(intro, 'submit', ev => ev.preventDefault());
    on($('lp-host-own'), 'change', syncCta); on($('lp-host-hosted'), 'change', syncCta);
    // step 2: macOS / Linux or Windows
    const osb = all('#intro .lp-os button');
    osb.forEach(b => on(b, 'click', () => {
      osb.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      all('#intro [data-os-pane]').forEach(el => { el.hidden = el.getAttribute('data-os-pane') !== b.getAttribute('data-os'); });
    }));
    // « Copy the line » (the pane in view): the clipboard API, else the page's copy command on the selected line;
    // when neither copies, the line stays selected and a message says to copy it by hand.
    on($('lp-copy'), 'click', ev => {
      const b = ev.currentTarget || ev.target, pre = all('#intro pre[data-os-pane]').filter(p => !p.hidden)[0], msg = $('lp-copyMsg'), label = t('i2.copy');
      if (!pre) return;
      const say = k => { if (msg) { msg.hidden = !k; msg.textContent = k ? t(k) : ''; } };
      const copied = () => { say(null); b.textContent = t('ui.copied'); setTimeout(() => { b.textContent = label; }, 1600); };
      const byHand = () => {
        let ok = false;
        try {
          const range = doc.createRange(), sel = win.getSelection();
          range.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(range);
          ok = !!(doc.execCommand && doc.execCommand('copy'));
        } catch (e) { ok = false; }
        if (ok) copied(); else say('ui.copyHand');
      };
      const clip = win.navigator && win.navigator.clipboard;
      if (!clip || typeof clip.writeText !== 'function') { byHand(); return; }
      Promise.resolve().then(() => clip.writeText(pre.textContent.trim())).then(copied, byHand);
    });
    // the bar: a shadow once scrolled, the section in view underlined
    const bar = $('lp-topbar'), links = all('#lp-topbar nav a');
    const spy = () => {
      if (!shown() || !doc.documentElement) return;
      const y = (win.scrollY || 0) + 120;
      let cur = null;
      links.forEach(a => { const el = $(a.getAttribute('href').slice(1)); if (el && el.getBoundingClientRect && el.getBoundingClientRect().top + (win.scrollY || 0) <= y) cur = a; });
      if ((win.innerHeight || 0) + (win.scrollY || 0) >= doc.documentElement.scrollHeight - 4) cur = links[links.length - 1];
      links.forEach(a => { if (a === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      toggle(bar, 'lp-scrolled', (win.scrollY || 0) > 4);
    };
    on(win, 'scroll', spy, {passive: true}); on(win, 'resize', spy);
  }
  apply();
  if (intro) { if (!reduce) start(); else live('polite'); }

  win.RBL = {
    DICT, pickLang, t, fill, setLang, setExample, seats, apply,
    examples: Object.keys(EX),
    get lang() { return lang; }, get example() { return ex; }, get step() { return step; }, get full() { return isFull(); },
    onChange: fn => { if (typeof fn === 'function') listeners.push(fn); }
  };
})();
