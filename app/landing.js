// Reelbook landing and language (L30, decision 13).
// - The landing (#intro in index.html): the first screen of a device that has never signed in, the mockup
//   docs/audit-design/mockups/p6-landing.html. Its copy is the mockup's, word for word, French and English.
// - The FR / EN dictionary of the screens a newcomer sees: the landing, sign-up / sign-in and their messages, #setup,
//   #welcome. The rest of the app stays English (L35 later). Static text carries data-k="<key>" (data-ka for an
//   aria-label); the app script asks window.RBL.t(key) for what it writes itself.
// - Language: the choice saved in localStorage rb.lang (not per user: it is chosen before signing in), else
//   navigator.language, else English. <html lang> follows.
// - Pictures (decision 19): dance, Laurent's generated images in assets/dance/; MMA, drawings until
//   assets/mma/image-map.json lists generated photos (then those, with no code change). Never a frame from a
//   third-party video. The original-video links of the examples point nowhere.
// - The seats line comes from beta_seats() (L32), asked by the app script on the hosted backend: RBL.seats(data);
//   hidden when the function is missing, fails or answers null.
// The vm harness of tests/auth-flow.test.cjs does not load this file: the app script falls back to English.
// tests/landing.test.cjs runs it with a small fake DOM, so every newer DOM API here is guarded.
(function () {
  'use strict';
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : {};

  const LANDING = {
    fr: {
      "h1": "Du reel au geste.",
      "sub": "Reelbook réunit tes vidéos de technique dans un carnet d'entraînement. Chaque vidéo devient une fiche image par image, facile à retrouver et à assembler en séances.",
      "cta": "Créer mon carnet",
      "cta2": "Voir comment ça marche",
      "beta": "Gratuit pendant la bêta",
      "fit": "Pour TikTok, Instagram, YouTube et Facebook. Fonctionne avec ton abonnement Claude.",
      "ex.l": "Voir un exemple :",
      "ex.dance": "Danse",
      "p.scrub": "Fais défiler le geste",
      "drawn": "Vue danse : images de démonstration générées, pas une vraie vidéo.",
      "v1.h": "Tout au même endroit.",
      "v1.p": "Le reel de ton coach sur Instagram, la vidéo YouTube d'une championne, le TikTok repéré dans le métro : tout arrive au même endroit, rangé par activité et par thème.",
      "v6.h": "Tes activités, tes carnets.",
      "v6.p": "Reelbook connaît déjà une trentaine d'activités et range chaque fiche tout seul dans le bon carnet. La tienne n'y est pas ? Crée ton carnet et décris-le en une phrase : Claude s'en sert pour trier.",
      "v6.cap": "Les carnets intégrés, choisis en un tap. Les groupes à l'intérieur (Tours, Clinch, Transitions…) se créent au fil des fiches.",
      "cu.h": "Ton propre carnet",
      "cu.n": "Nom du carnet",
      "cu.d": "Ce qui va dedans",
      "cu.hint": "Écrit pour Claude : de quoi parlent les vidéos et comment tu veux les ranger.",
      "cu.b": "Créer le carnet",
      "v2.h": "Le bon geste au bon moment.",
      "v5.h": "Tes notes, à côté du geste.",
      "v5.p": "Une correction du coach, une sensation, le côté qui coince : tu l'écris dans la fiche, elle s'enregistre toute seule. Et le lien vers la vidéo d'origine reste toujours là, pour la revoir au besoin.",
      "v3.h": "Tes fiches font tes séances.",
      "v3.p": "Pioche dans tous tes carnets et mélange-les : la technique, la mobilité, l'échauffement dans la même séance. Mets les exercices dans l'ordre, donne à chacun son dosage, puis suis la séance fiche après fiche.",
      "v4.h": "Ta progression, fiche par fiche.",
      "v4.p": "Les nouvelles fiches t'attendent en haut de l'accueil, celles que tu n'as jamais essayées remontent d'elles-mêmes, et chaque « Fait aujourd'hui » s'ajoute au compteur de la fiche.",
      "how.h": "Un skill Claude fait le travail.",
      "how.p": "Reelbook est un skill pour Claude Code. Avec l'extension Claude in Chrome, il ouvre les vidéos que tu lui as envoyées, les découpe en séquence d'images et range chaque fiche dans ton carnet.",
      "r1.h": "Tu envoies la vidéo",
      "r1.p": "Depuis TikTok ou Instagram : Partager, puis Reelbook. Elle rejoint ta file.",
      "t.l1": "3 vidéos dans la file",
      "t.l2": "ouverture dans Chrome",
      "r2.h": "Claude s'en charge",
      "r2.p": "Tape <code>/reelbook</code> dans Claude Code, ou laisse-le tourner la nuit sur ton Mac.",
      "r3.h": "Chrome ouvre et analyse",
      "r3.p": "L'extension Claude in Chrome lit la vidéo comme toi : le geste, les consignes, les sous-titres.",
      "r4.h": "Le geste, découpé",
      "r4.p": "Les moments clés deviennent une séquence d'images, avec les points à retenir, un dosage et le lien vers la vidéo.",
      "r5.h": "Rangée dans ton carnet",
      "r5.p": "Dans le bon carnet, le bon groupe. Prête à être retrouvée, annotée, ajoutée à une séance.",
      "inst.h": "Installer Reelbook.",
      "inst.p": "Trois choses à faire une fois : ton compte, le skill sur ton ordinateur, l'app sur ton téléphone.",
      "i1.h": "Crée ton carnet",
      "i1.p": "Choisis où vivent tes fiches. Tu peux changer plus tard.",
      "i1.a": "Chez Reelbook",
      "i1.ad": "Rien à configurer. Gratuit pendant la bêta : 300 fiches, 200 Mo de photos, 10 vidéos par jour.",
      "i1.b": "Sur mon Supabase",
      "i1.bd": "Ton propre projet, tes limites. Un fichier SQL à lancer, puis l'adresse et la clé.",
      "i1.cta": "Créer mon carnet",
      "i2.h": "Installe le skill",
      "i2.n": "Il te faut Claude Pro ou plus avec Claude Code, et Chrome avec l'extension Claude in Chrome.",
      "i2.p": "Colle cette ligne dans le Terminal. Elle installe le skill <code>/reelbook</code> et le relie à ton carnet.",
      "i2.copy": "Copier la ligne",
      "i3.h": "Ajoute-le au téléphone",
      "i3.p": "Mets Reelbook sur ton écran d'accueil, puis le raccourci « Envoyer à Reelbook » dans le menu Partager de l'iPhone.",
      "i3.p2": "Sur Android, colle simplement le lien dans l'app.",
      "i3.cta": "Ajouter le raccourci",
      "d.h": "Au quotidien.",
      "d1.v": "Envoie",
      "d1.p": "Une technique te plaît dans ton fil : Partager, Reelbook. Dix secondes, et tu continues à scroller.",
      "d2.v": "Lance",
      "d2.p": "<code>/reelbook</code> dans Claude Code quand tu veux, ou chaque nuit tout seul. Le matin, tes fiches sont là.",
      "d3.v": "Organise",
      "d3.p": "Déplace une fiche d'un groupe à l'autre, ajoute tes notes, compose une séance à partir de plusieurs carnets.",
      "d4.v": "Entraîne-toi",
      "d4.p": "Ouvre la fiche ou la séance sur ton téléphone : le geste d'abord, en images, puis les détails. Coche « Fait aujourd'hui ».",
      "c.p": "Tes vidéos de technique, enfin prêtes pour l'entraînement. Gratuit pendant la bêta, 50 places.",
      "foot": "Les fiches sont faites pour un usage personnel et gardent toujours le lien vers la vidéo et son auteur.",
      "seats": "{taken} places prises sur {total}",
      "drawn.mma": "Vue MMA : dessins provisoires, pas une vraie vidéo.",
      "drawn.mma.photo": "Vue MMA : images de démonstration générées, pas une vraie vidéo.",
      "ui.gear": "Matériel",
      "ui.time": "Durée",
      "ui.notes": "Tes notes",
      "ui.saved": "Enregistré",
      "ui.orig": "Revoir la vidéo d’origine",
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
      "ui.more": "+ 15 autres",
      "ui.copied": "Copiée",
      "ui.copyHand": "La copie n’a pas marché : la ligne est sélectionnée, copie-la à la main (⌘C ou Ctrl+C).",
      "cu.name": "Cerceau aérien",
      "cu.desc": "Montées, figures et enchaînements au cerceau aérien, du débutant au confirmé. Un groupe par famille de figures."
    },
    en: {
      "h1": "From reel to move.",
      "sub": "Reelbook gathers your technique videos into a training notebook. Each video becomes a frame-by-frame sheet, easy to find and to build sessions from.",
      "cta": "Create my notebook",
      "cta2": "See how it works",
      "beta": "Free during the beta",
      "fit": "For TikTok, Instagram, YouTube and Facebook. Runs on your Claude plan.",
      "ex.l": "See an example:",
      "ex.dance": "Dance",
      "p.scrub": "Scrub through the move",
      "drawn": "Dance view: generated demo images, not a real video.",
      "v1.h": "All in one place.",
      "v1.p": "Your coach’s reel on Instagram, a champion’s YouTube breakdown, the TikTok you caught on the train: it all lands in one place, filed by activity and by theme.",
      "v6.h": "Your sports, your notebooks.",
      "v6.p": "Reelbook already knows about thirty activities and files each sheet in the right notebook on its own. Yours isn’t there? Create a notebook and describe it in a sentence: Claude uses it to sort.",
      "v6.cap": "Built-in notebooks, one tap to add. The groups inside (Turns, Clinch, Transitions…) grow as sheets arrive.",
      "cu.h": "Your own notebook",
      "cu.n": "Notebook name",
      "cu.d": "What goes in it",
      "cu.hint": "Written for Claude: what the videos are about and how you want them grouped.",
      "cu.b": "Create notebook",
      "v2.h": "Right move, right time.",
      "v5.h": "Your notes, next to the move.",
      "v5.p": "A correction from your coach, a feeling, the side that sticks: write it in the sheet and it saves itself. And the link to the original video is always there, to watch it again when you need to.",
      "v3.h": "Sheets become sessions.",
      "v3.p": "Pick from all your notebooks and mix them: technique, mobility and warm-up in the same session. Put the exercises in order, give each one its dose, then follow the session sheet by sheet.",
      "v4.h": "Your progress, sheet by sheet.",
      "v4.p": "New sheets wait at the top of the home page, the ones you never tried come back up on their own, and every « Done today » adds to the sheet’s count.",
      "how.h": "A Claude skill does the work.",
      "how.p": "Reelbook is a skill for Claude Code. With the Claude in Chrome extension, it opens the videos you sent, cuts each one into a sequence of frames and files the sheet in your notebook.",
      "r1.h": "You send the video",
      "r1.p": "From TikTok or Instagram: Share, then Reelbook. It joins your queue.",
      "t.l1": "3 videos queued",
      "t.l2": "opening in Chrome",
      "r2.h": "Claude takes over",
      "r2.p": "Type <code>/reelbook</code> in Claude Code, or let it run overnight on your Mac.",
      "r3.h": "Chrome opens and reads it",
      "r3.p": "The Claude in Chrome extension watches the video the way you would: the move, the cues, the captions.",
      "r4.h": "The move, cut into frames",
      "r4.p": "The key moments become a sequence of images, with the points to remember, a dose and the link to the video.",
      "r5.h": "Filed in your notebook",
      "r5.p": "Right notebook, right group. Ready to find, annotate and add to a session.",
      "inst.h": "Set up Reelbook.",
      "inst.p": "Three things to do once: your account, the skill on your computer, the app on your phone.",
      "i1.h": "Create your notebook",
      "i1.p": "Choose where your sheets live. You can change it later.",
      "i1.a": "With Reelbook",
      "i1.ad": "Nothing to set up. Free during the beta: 300 sheets, 200 MB of photos, 10 videos a day.",
      "i1.b": "On my own Supabase",
      "i1.bd": "Your own project, your limits. Run one SQL file, then paste the URL and key.",
      "i1.cta": "Create my notebook",
      "i2.h": "Install the skill",
      "i2.n": "You need Claude Pro or above with Claude Code, and Chrome with the Claude in Chrome extension.",
      "i2.p": "Paste this line in Terminal. It installs the <code>/reelbook</code> skill and links it to your notebook.",
      "i2.copy": "Copy the line",
      "i3.h": "Add it to your phone",
      "i3.p": "Put Reelbook on your home screen, then the « Send to Reelbook » shortcut in the iPhone Share menu.",
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
      "d4.p": "Open the sheet or the session on your phone: the move first, in pictures, then the details. Tick « Done today ».",
      "c.p": "Your technique videos, ready for training at last. Free during the beta, 50 spots.",
      "foot": "Sheets are made for personal use and always keep the link to the video and its author.",
      "seats": "{taken} of {total} spots taken",
      "drawn.mma": "MMA view: placeholder drawings, not a real video.",
      "drawn.mma.photo": "MMA view: generated demo images, not a real video.",
      "ui.gear": "Gear",
      "ui.time": "Time",
      "ui.notes": "Your notes",
      "ui.saved": "Saved",
      "ui.orig": "Watch the original video",
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
      "ui.more": "+ 15 more",
      "ui.copied": "Copied",
      "ui.copyHand": "Copying did not work: the line is selected, copy it by hand (⌘C or Ctrl+C).",
      "cu.name": "Aerial hoop",
      "cu.desc": "Climbs, poses and sequences on the aerial hoop, beginner to advanced. One group per family of poses."
    }
  };
  // The screens around the landing: sign-up / sign-in (a.*), #setup (s.*), #welcome (w.*), aria labels the mockup
  // leaves in French (aria.*). English is the app's copy as it was; French follows the mockup's tone (tu).
  const APP = {
    fr: {
      'aria.sections': 'Sections', 'aria.ex': 'Exemple', 'aria.sheet': 'Une fiche Reelbook', 'aria.nb': 'Un carnet Reelbook',
      'aria.create': 'Créer un carnet', 'aria.search': 'La recherche de Reelbook', 'aria.notes': 'Une fiche avec ses notes', 'aria.session': 'Une séance Reelbook',
      'a.in': 'Se connecter', 'a.up': 'Créer un compte', 'a.submitUp': 'Créer le compte', 'a.have': 'J’ai déjà un compte',
      'a.email': 'E-mail', 'a.pass': 'Mot de passe', 'a.backend': 'Serveur :', 'a.none': 'Aucun serveur choisi',
      'a.own': 'Utiliser mon propre Supabase', 'a.change': 'Changer d’instance', 'a.hosted': ' · Utiliser Reelbook hébergé',
      'a.ownh': 'Connecter ta propre instance', 'a.ownp': 'Indique une fois sur cet appareil les informations de ton projet Supabase. Guide d’installation :',
      'a.url': 'URL du projet', 'a.key': 'Clé anon', 'a.useown': 'Utiliser cette instance', 'a.cancel': 'Annuler', 'a.demo': 'Voir une démo',
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
      'aria.sections': 'Sections', 'aria.ex': 'Example', 'aria.sheet': 'A Reelbook sheet', 'aria.nb': 'A Reelbook notebook',
      'aria.create': 'Create a notebook', 'aria.search': 'Reelbook search', 'aria.notes': 'A sheet with its notes', 'aria.session': 'A Reelbook session',
      'a.in': 'Sign in', 'a.up': 'Create an account', 'a.submitUp': 'Create account', 'a.have': 'I already have an account',
      'a.email': 'Email', 'a.pass': 'Password', 'a.backend': 'Backend:', 'a.none': 'No backend selected',
      'a.own': 'Use my own Supabase', 'a.change': 'Change instance', 'a.hosted': ' · Use Reelbook hosted',
      'a.ownh': 'Connect your own instance', 'a.ownp': 'Enter your Supabase project details once on this device. Setup guide:',
      'a.url': 'Project URL', 'a.key': 'Anon key', 'a.useown': 'Use this instance', 'a.cancel': 'Cancel', 'a.demo': 'See a demo',
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
    get: k => { try { return win.localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { win.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  let lang = pickLang(ls.get(STORE), win.navigator && win.navigator.language);
  const t = k => { const v = DICT[lang][k]; return v != null ? v : DICT.en[k]; };
  const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k] == null ? '' : String(o[k]));
  const $ = id => doc ? doc.getElementById(id) : null;
  const all = (sel, root) => { const r = root || doc; return r && r.querySelectorAll ? Array.prototype.slice.call(r.querySelectorAll(sel)) : []; };
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
  const setHtml = (id, v) => { const el = $(id); if (el) el.innerHTML = v; };

  // ---------- drawings (the mockup's pictograms; MMA poses added) ----------
  const IC = {
    fight: '<path d="M8.5 15V8.5A4.5 4.5 0 0 1 13 4h.5A4.5 4.5 0 0 1 18 8.5V12a3 3 0 0 1-3 3z"/><path d="M8.5 13H7a2.25 2.25 0 0 1 0-4.5h1.5M8.5 10.75H12"/><rect x="8.5" y="15" width="9" height="5" rx="1"/>',
    dance: '<path d="M9 18V5.5l10-2V16M9 9.5l10-2"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    yoga: '<path d="M12 4.5c2.6 2.9 2.6 8.1 0 11-2.6-2.9-2.6-8.1 0-11z"/><path d="M12 15.5c-4 0-7-2.4-7.6-6 3.2 0 6 2 7.6 6zM12 15.5c4 0 7-2.4 7.6-6-3.2 0-6 2-7.6 6z"/><path d="M5 19.5h14"/>',
    pole: '<path d="M12 3v18M9 3h6M8 21h8"/><path d="M14.5 8.4c2 .4 3.5 1.2 3.5 2.1 0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5c0-.9 1.5-1.7 3.5-2.1"/>',
    dot: '<circle cx="12" cy="12" r="4"/>'
  };
  const icon = k => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[k] || IC.dot) + '</svg>';
  // silhouettes in a 60 x 80 box: head, neck, pelvis, legs l / r (knee, foot), arms a / b (elbow, hand)
  const GUARD = {a: [[22, 28], [26, 17]], b: [[38, 28], [34, 17]]};
  const DP = {
    passe: {h: [30, 10], n: [30, 19], p: [30, 42], l: [[30, 58], [30, 76]], r: [[41, 51], [31, 57]], a: [[22, 29], [27, 35]], b: [[38, 29], [33, 35]]},
    jete: {h: [35, 15], n: [33, 23], p: [30, 40], l: [[42, 38], [57, 35]], r: [[18, 43], [4, 40]], a: [[40, 18], [47, 10]], b: [[25, 24], [15, 19]], air: 1},
    chaine: {h: [30, 10], n: [30, 19], p: [30, 42], l: [[29, 58], [29, 76]], r: [[31, 58], [31, 76]], a: [[22, 29], [27, 35]], b: [[38, 29], [33, 35]], arc: 1},
    fouette: {h: [30, 10], n: [30, 19], p: [30, 42], l: [[30, 58], [30, 76]], r: [[44, 44], [55, 40]], a: [[21, 26], [11, 27]], b: [[39, 26], [49, 27]]},
    heels: {h: [27, 12], n: [28, 21], p: [33, 44], l: [[28, 58], [25, 76]], r: [[38, 58], [37, 76]], a: [[21, 14], [27, 5]], b: [[41, 32], [36, 42]]},
    pdb: {h: [30, 12], n: [30, 21], p: [30, 44], l: [[28, 58], [27, 76]], r: [[32, 58], [33, 76]], a: [[23, 8], [29, 1]], b: [[37, 8], [31, 1]]},
    hipflow: {h: [30, 22], n: [30, 30], p: [30, 52], l: [[17, 58], [15, 76]], r: [[43, 58], [45, 76]], a: [[24, 40], [30, 46]], b: [[36, 40], [30, 46]]},
    guard: Object.assign({h: [30, 12], n: [30, 21], p: [30, 44], l: [[24, 58], [19, 76]], r: [[37, 58], [42, 76]]}, GUARD),
    cross: Object.assign({h: [30, 12], n: [30, 21], p: [30, 44], l: [[33, 59], [38, 76]], r: [[27, 59], [22, 76]]}, GUARD),
    turn: Object.assign({h: [30, 11], n: [30, 20], p: [30, 43], l: [[31, 59], [33, 76]], r: [[29, 59], [27, 76]], arc: 1}, GUARD),
    knee: Object.assign({h: [29, 12], n: [29, 21], p: [30, 44], l: [[30, 60], [30, 76]], r: [[43, 44], [41, 59]], arc: 2}, GUARD),
    kick: {h: [17, 20], n: [22, 26], p: [32, 44], l: [[31, 60], [30, 76]], r: [[45, 38], [58, 31]], a: [[15, 33], [11, 41]], b: [[21, 31], [27, 24]]},
    pad: {h: [17, 20], n: [22, 26], p: [32, 44], l: [[31, 60], [30, 76]], r: [[45, 38], [56, 32]], a: [[15, 33], [11, 41]], b: [[21, 31], [27, 24]], pad: 1},
    neck: {h: [33, 13], n: [31, 22], p: [29, 44], l: [[28, 60], [27, 76]], r: [[41, 47], [44, 60]], a: [[40, 20], [47, 13]], b: [[41, 25], [48, 18]]},
    osoto: {h: [33, 12], n: [32, 21], p: [30, 44], l: [[29, 60], [28, 76]], r: [[40, 58], [53, 66]], a: [[40, 24], [48, 21]], b: [[24, 28], [33, 32]]},
    crav: {h: [40, 27], n: [35, 30], p: [26, 46], l: [[22, 60], [19, 76]], r: [[33, 61], [37, 76]], a: [[43, 38], [49, 30]], b: [[30, 39], [38, 42]]},
    foot: Object.assign({h: [31, 12], n: [31, 21], p: [31, 45], l: [[22, 58], [13, 74]], r: [[39, 58], [45, 76]]}, GUARD)
  };
  const PAL = {
    mma: {fields: ['#f4e2dc', '#ebe6dc', '#f2e5d3'], ink: '#4a1c13'},
    dance: {fields: ['#f6dfe8', '#ece3f6', '#fbe7dc'], ink: '#6e1f45'}
  };
  const dfig = (k, tx, ty, s, ink) => {
    const P = DP[k], L = (a, b) => 'M' + a[0] + ' ' + a[1] + 'L' + b[0] + ' ' + b[1];
    const d = L(P.n, P.p) + L(P.p, P.l[0]) + L(P.l[0], P.l[1]) + L(P.p, P.r[0]) + L(P.r[0], P.r[1]) + L(P.n, P.a[0]) + L(P.a[0], P.a[1]) + L(P.n, P.b[0]) + L(P.b[0], P.b[1]);
    let x = '<g transform="translate(' + tx + ' ' + ty + ') scale(' + s + ')">';
    if (P.arc) x += '<path d="' + (P.arc === 1 ? 'M10 30 Q30 18 50 30' : 'M50 30 Q30 18 10 30') + '" fill="none" stroke="#c54b38" stroke-width="2.2" stroke-dasharray="3 4" stroke-linecap="round"/>';
    if (P.pad) x += '<rect x="56" y="20" width="9" height="18" rx="3" fill="#c54b38"/>';
    x += '<path d="' + d + '" fill="none" stroke="' + ink + '" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>';
    x += '<circle cx="' + P.h[0] + '" cy="' + P.h[1] + '" r="6.6" fill="' + ink + '"/>';
    return x + '</g>';
  };
  const dframe = (k, i, pal) => '<svg viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect x="-200" y="-200" width="480" height="500" fill="' + pal.fields[i % 3] + '"/>' +
    '<ellipse cx="40" cy="' + (DP[k].air ? 95 : 93) + '" rx="' + (DP[k].air ? 14 : 20) + '" ry="2.6" fill="' + pal.ink + '" opacity=".14"/>' + dfig(k, 10, DP[k].air ? 6 : 14, 1, pal.ink) + '</svg>';
  const dthumb = (k, i, pal) => '<svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect x="-200" y="-200" width="520" height="480" fill="' + pal.fields[i % 3] + '"/>' +
    '<ellipse cx="60" cy="76" rx="16" ry="2" fill="' + pal.ink + '" opacity=".14"/>' + dfig(k, 33, DP[k].air ? -2 : 1, 0.92, pal.ink) + '</svg>';

  // ---------- the two examples (the mockup's data; MMA drawn, its third-party names replaced by [compte]) ----------
  const T = (fr, en) => ({fr, en});
  const DANCE = 'assets/dance/';
  const EX = {
    mma: {
      nb: 'Fight techniques', icon: 'fight', count: T('5 fiches', '5 sheets'), url: 'instagram.com/reel/…',
      crumb: 'Fight techniques › Kicks & knees', title: T('Coup de pied tournant au foie', 'Spinning kick to the liver'),
      src: T('Vidéo d’origine : [compte] sur Instagram ↗', 'Original video: [account] on Instagram ↗'),
      poses: ['guard', 'cross', 'turn', 'knee', 'kick', 'pad'],
      alts: T(['En garde, face à la cible', 'Les pieds croisés', 'Le tour', 'Le genou monte', 'Le coup de pied', 'Sur la pao'], ['On guard', 'Feet crossed', 'The turn', 'Knee up', 'The kick', 'On the pad']),
      steps: {fr: [['Départ', 'En garde, pieds écartés, face à la cible. Si tu tournes comme ça, tu perds l\'équilibre : il faut le préparer.'], ['Croise les pieds', 'Premier temps : les pieds se croisent, avant de tourner. Le regard reste sur la cible.'], ['Le tour', 'Tu tournes sur les pieds croisés, équilibré, le regard déjà tourné vers la cible.'], ['Le genou monte', 'Le genou se lève pendant que tu finis le tour, le haut du corps accompagne.'], ['Le coup', 'La jambe part tendue vers la cible, le buste bascule : le pied vise le foie.'], ['Sur la pao', 'Même geste sur la pao tenue par un partenaire : tour, regard et coup n\'en font plus qu\'un.']],
        en: [['Start', 'On guard, feet apart, facing the target. Turn from here and you lose your balance: set it up first.'], ['Cross your feet', 'First beat: the feet cross before you turn. Your eyes stay on the target.'], ['The turn', 'You turn on crossed feet, balanced, eyes already back on the target.'], ['Knee up', 'The knee lifts as you finish the turn, the upper body follows.'], ['The kick', 'The leg shoots out at the target, the torso tips back: the foot aims for the liver.'], ['On the pad', 'Same move on a pad held by a partner: turn, look and kick become one.']]},
      items: {
        neck: {t: T('Prise de nuque : le genou à la ceinture', 'Neck clinch: knee to the belt'), pose: 'neck', m: T('10 min · Instagram', '10 min · Instagram'), g: 'Clinch & grappling'},
        osoto: {t: T('Osoto gari en MMA', 'Osoto gari for MMA'), pose: 'osoto', m: T('10 min · Instagram', '10 min · Instagram'), g: 'Clinch & grappling'},
        crav: {t: T('Sortir d’une cravate debout', 'Escaping a standing headlock'), pose: 'crav', m: T('5 min · Instagram', '5 min · Instagram'), g: 'Clinch & grappling'},
        kick: {t: T('Coup de pied tournant au foie', 'Spinning kick to the liver'), pose: 'kick', m: T('6 min · Instagram', '6 min · Instagram'), g: 'Kicks & knees'},
        foot: {t: T('Footwork boxe : le pas dans le cerceau', 'Boxing footwork: the hoop step'), pose: 'foot', m: T('4 combinaisons · YouTube', '4 combos · YouTube'), g: 'Footwork'},
        hips: {t: T('Flow hanches : squat large, cosaque, assis', 'Hip flow: wide squat, cossack, floor sit'), pose: 'hipflow', m: T('3 min · Instagram', '3 min · Instagram'), g: 'Hips'}
      },
      groups: [['Clinch & grappling', ['neck', 'osoto', 'crav']]], pair: [['Kicks & knees', ['kick']], ['Footwork', ['foot']]],
      search: {q: T('clinch', 'clinch'), chip: T('Zone : haut du corps', 'Zone: upper body'), mark: T('Clinch', 'Clinch'), res: ['neck', 'crav', 'osoto'], note: T('ta note : « garder les coudes serrés »', 'your note: « keep the elbows tight »'),
        lede: T('Tu prépares le sparring de jeudi. Tape « clinch », filtre par zone ou par matériel : les fiches sortent, avec les notes que tu y as laissées la dernière fois.', 'Thursday is sparring. Type « clinch », filter by body zone or gear: your sheets come up, with the notes you left on them last time.')},
      session: {title: T('Jeudi : clinch et kicks', 'Thursday: clinch and kicks'), format: T('3 tours · 60 s de repos', '3 rounds · 60 s rest'),
        items: [['foot', 'Fight', T('3 min', '3 min')], ['hips', 'Yoga', T('2 tours', '2 rounds')], ['neck', 'Fight', T('3×5 / côté', '3×5 / side')], ['kick', 'Fight', T('8 / côté', '8 / side')]]},
      progress: {nw: ['kick', 'foot'], tr: ['crav'], dn: [['osoto', T('6 fois · mardi', '6 times · Tuesday')], ['neck', T('3 fois · jeudi dernier', '3 times · last Thursday')]]},
      note: {frame: 2, step: T('Le tour', 'The turn'), text: T('Croiser plus serré, sinon je pars côté gauche.\nCoach : regarder la cible AVANT de tourner.', 'Cross tighter, or I drift to the left.\nCoach: look at the target BEFORE turning.'),
        who: T('[compte] · Instagram', '[account] · Instagram'), done: T('fois, la dernière mardi', 'times, last on Tuesday'), n: 6}
    },
    dance: {
      nb: 'Dance', icon: 'dance', count: T('5 fiches', '5 sheets'), url: 'tiktok.com/@…/video/…',
      crumb: 'Dance › Tours', crumbEn: 'Dance › Turns', title: T('Pirouette en dehors', 'Pirouette en dehors'),
      src: T('Vidéo d’origine : [compte] sur TikTok ↗', 'Original video: [account] on TikTok ↗'),
      frames: ['01-preparation-v2', '02-montee-retire', '03-premier-quart', '04-rotation-regard', '05-sortie', '06-reception-v2'].map(f => DANCE + 'pirouette-en-dehors/' + f + '.jpg'),
      alts: T(['Préparation en quatrième', 'Montée en retiré', 'Début du tour', 'Rotation, le regard sur son point', 'Sortie du tour', 'Réception en quatrième, bras ouverts'], ['Preparation in fourth', 'Rising into retiré', 'Start of the turn', 'Rotation, eyes on the spot', 'Coming out of the turn', 'Landing in fourth, arms open']),
      steps: {fr: [['Préparation', 'En quatrième position, genoux pliés, le poids entre les deux pieds. Un bras devant, l\'autre ouvert.'], ['Relevé, retiré', 'Pousse dans le sol : la jambe d\'appui monte, l\'autre pied file au genou. Les bras se rassemblent devant toi.'], ['Le départ', 'Le corps part d\'un bloc, bassin et épaules ensemble. La tête reste sur ton point le plus longtemps possible.'], ['Le regard', 'La tête fouette et revient la première sur ton point. Garde le retiré et le dos long pendant toute la rotation.'], ['La sortie', 'Le tour s\'achève face à ton point. Le pied quitte le genou sans tomber, la jambe d\'appui reste tendue.'], ['Réception', 'Repose le pied derrière en quatrième, plié, et ouvre les bras. Tiens la fin deux temps.']],
        en: [['Preparation', 'Fourth position, knees bent, weight between both feet. One arm in front, the other open.'], ['Relevé, retiré', 'Push into the floor: the standing leg rises, the other foot slides up to the knee. The arms gather in front of you.'], ['The start', 'The body turns as one block, hips and shoulders together. The head stays on your spot as long as it can.'], ['Spot', 'The head whips round and arrives first on your spot. Keep the retiré and a long back through the whole rotation.'], ['The exit', 'The turn ends facing your spot. The foot leaves the knee without dropping, the standing leg stays straight.'], ['Landing', 'Set the foot down behind in fourth, in plié, and open the arms. Hold the finish for two counts.']]},
      items: {
        pir: {t: T('Pirouette en dehors', 'Pirouette en dehors'), pose: 'passe', img: DANCE + 'pirouette-en-dehors/card.jpg', m: T('3 min · TikTok', '3 min · TikTok'), g: 'Tours'},
        chaine: {t: T('Chaînés en diagonale', 'Chaînés across the floor'), pose: 'chaine', img: DANCE + 'chaines-en-diagonale-card.jpg', m: T('2 min · Instagram', '2 min · Instagram'), g: 'Tours'},
        fouette: {t: T('Fouetté : la préparation', 'Fouetté: the preparation'), pose: 'fouette', img: DANCE + 'fouette-preparation-card.jpg', m: T('5 min · YouTube', '5 min · YouTube'), g: 'Tours'},
        jete: {t: T('Grand jeté, sans forcer le grand écart', 'Grand jeté without forcing the split'), pose: 'jete', img: DANCE + 'grand-jete-card.jpg', m: T('4 min · Instagram', '4 min · Instagram'), g: 'Sauts'},
        heels: {t: T('Combo heels en 8 temps', 'Heels combo in 8 counts'), pose: 'heels', img: DANCE + 'combo-heels-card.jpg', m: T('1 min · TikTok', '1 min · TikTok'), g: 'Chorés'},
        pdb: {t: T('Port de bras lent', 'Slow port de bras'), pose: 'pdb', img: DANCE + 'port-de-bras-lent-card.jpg', m: T('3 min · Instagram', '3 min · Instagram'), g: 'Échauffement'},
        hips: {t: T('Flow hanches : squat large, cosaque, assis', 'Hip flow: wide squat, cossack, floor sit'), pose: 'hipflow', m: T('3 min · Instagram', '3 min · Instagram'), g: 'Hips'}
      },
      groupNames: {fr: {Tours: 'Tours', Sauts: 'Sauts', Chorés: 'Chorégraphies', Échauffement: 'Échauffement'}, en: {Tours: 'Turns', Sauts: 'Jumps', Chorés: 'Choreography', Échauffement: 'Warm-up'}},
      groups: [['Tours', ['pir', 'chaine', 'fouette']]], pair: [['Sauts', ['jete']], ['Chorés', ['heels']]],
      search: {q: T('tour', 'turn'), chip: T('Zone : jambes', 'Zone: legs'), mark: T('Tours', 'Turns'), res: ['pir', 'chaine', 'fouette'], note: T('ta note : « spot sur la porte, pas sur le miroir »', 'your note: « spot on the door, not the mirror »'),
        lede: T('Le cours de mardi approche. Tape « tour », filtre par zone ou par durée : les fiches sortent, avec les notes que tu y as laissées la dernière fois.', 'Tuesday’s class is coming. Type « turn », filter by body zone or time: your sheets come up, with the notes you left on them last time.')},
      session: {title: T('Mardi : tours et sauts', 'Tuesday: turns and jumps'), format: T('2 passages · 30 s de repos', '2 rounds · 30 s rest'),
        items: [['pdb', 'Dance', T('2 min', '2 min')], ['hips', 'Yoga', T('2 tours', '2 rounds')], ['pir', 'Dance', T('8 / côté', '8 / side')], ['jete', 'Dance', T('4 diagonales', '4 diagonals')]]},
      progress: {nw: ['pir', 'heels'], tr: ['fouette'], dn: [['chaine', T('6 fois · mardi', '6 times · Tuesday')], ['jete', T('3 fois · jeudi dernier', '3 times · last Thursday')]]},
      note: {frame: 3, step: T('Le regard', 'Spot'), text: T('Spot sur la porte du studio, pas sur le miroir.\nCôté gauche : mon retiré descend, le garder au genou.', 'Spot on the studio door, not the mirror.\nLeft side: my retiré drops, keep it at the knee.'),
        who: T('[compte] · TikTok', '[account] · TikTok'), done: T('fois, la dernière mardi', 'times, last on Tuesday'), n: 6}
    }
  };
  const LIB = [['Fight techniques', 'fight', '#b4432f'], ['Dance', 'dance', '#b23a6e'], ['Pole dance', 'pole', '#b23a6e'], ['Yoga & stretching', 'yoga', '#3f8f5f'], ['Pilates', 'dot', '#b23a6e'], ['Barre', 'dot', '#b23a6e'], ['Strength', 'dot', '#5f7d1a'], ['Climbing & bouldering', 'dot', '#c2651d'], ['Kitesurf', 'dot', '#1d7a8c'], ['Surfing', 'dot', '#1d7a8c'], ['Running', 'dot', '#c2651d'], ['Tennis & padel', 'dot', '#c2651d'], ['Mobility & rehab', 'dot', '#3f8f5f'], ['Cooking', 'dot', '#8a6a12']];

  // MMA photos (decision 19, updated): assets/mma/image-map.json lists the generated files once they exist; a step
  // photo is used when all six are listed, a card photo when its item is listed. Relative paths only.
  const MMA = 'assets/mma/';
  const mma = {steps: [], cards: {}};
  const safePath = p => typeof p === 'string' && /^[\w-]+(?:\/[\w-]+)*\.(?:jpe?g|png|webp)$/i.test(p);
  const readManifest = m => {
    const steps = m && Array.isArray(m.steps) && m.steps.length === 6 && m.steps.every(safePath) ? m.steps.slice() : [];
    const cards = {};
    if (m && m.cards && typeof m.cards === 'object') for (const k of Object.keys(m.cards)) if (EX.mma.items[k] && safePath(m.cards[k])) cards[k] = m.cards[k];
    mma.steps = steps; mma.cards = cards;
  };

  let ex = ls.get(EX_STORE) === 'dance' ? 'dance' : 'mma', step = 0, timer = null;
  const tr = o => o && typeof o === 'object' && ('fr' in o) ? o[lang] : o;
  const X = () => EX[ex];
  const pal = () => PAL[ex];
  const img = src => '<img src="' + src + '" alt="" loading="lazy" decoding="async">';
  const frame = i => {
    const e = X();
    if (e.frames) return img(e.frames[i]);
    if (mma.steps.length === 6) return img(MMA + mma.steps[i]);
    return dframe(e.poses[i], i, pal());
  };
  const itemImg = key => { const it = X().items[key]; return it.img || (mma.cards[key] ? MMA + mma.cards[key] : ''); };
  const pic = (key, i) => { const src = itemImg(key); return '<div class="lp-pic">' + (src ? img(src) : dthumb(X().items[key].pose, i || 0, pal())) + '</div>'; };
  const gname = g => { const e = X(); return (e.groupNames && e.groupNames[lang][g]) || g; };
  const card = (key, i) => { const it = X().items[key]; return '<div class="lp-card">' + pic(key, i) + '<b>' + tr(it.t) + '</b><small>' + tr(it.m) + '</small></div>'; };
  const drawnText = () => ex === 'dance' ? t('drawn') : mma.steps.length === 6 ? t('drawn.mma.photo') : t('drawn.mma');

  // ---------- the sheet player of the hero ----------
  const show = k => {
    step = k; const e = X();
    all('#lp-shot > div').forEach((d, j) => d.classList.toggle('lp-on', j === k));
    all('#lp-thumbs > button').forEach((b, j) => b.setAttribute('aria-current', String(j === k)));
    setText('lp-num', k + 1); setText('lp-scrubN', (k + 1) + ' / 6');
    setText('lp-stepName', e.steps[lang][k][0]); setText('lp-cue', e.steps[lang][k][1]);
    const s = $('lp-scrub'); if (s) s.value = String(k + 1);
  };
  const buildPlayer = () => {
    const e = X(), alts = tr(e.alts);
    let shot = '<span class="lp-num" id="lp-num" aria-hidden="true">' + (step + 1) + '</span>', th = '';
    for (let i = 0; i < 6; i++) {
      shot += '<div role="img" aria-label="' + alts[i] + '"' + (i === step ? ' class="lp-on"' : '') + '>' + frame(i) + '</div>';
      th += '<button type="button" data-i="' + i + '" aria-label="' + (i + 1) + ' / 6 · ' + alts[i] + '" aria-current="' + (i === step) + '">' + frame(i) + '</button>';
    }
    setHtml('lp-shot', shot); setHtml('lp-thumbs', th);
    setText('lp-pCrumb', lang === 'en' && e.crumbEn ? e.crumbEn : e.crumb);
    setText('lp-pTitle', tr(e.title)); setText('lp-pSrc', tr(e.src)); setText('lp-drawn', drawnText());
    show(step);
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  // ---------- the interface fragments (notebook, search, notes, session, progress, route) ----------
  const renderAll = () => {
    const e = X(), intro = $('intro');
    if (intro) intro.setAttribute('data-ex', ex);
    buildPlayer();
    let h = '<div class="lp-ui-head"><span class="lp-ui-badge">' + icon(e.icon) + '</span><span class="lp-ui-title">' + e.nb + '</span><span class="lp-ui-count">' + tr(e.count) + '</span></div>';
    e.groups.forEach(g => { h += '<div class="lp-grp"><div class="lp-grp-h">' + gname(g[0]) + ' <span>' + g[1].length + '</span></div><div class="lp-row">' + g[1].map((k, i) => card(k, i)).join('') + '</div></div>'; });
    h += '<div class="lp-grp-pair">' + e.pair.map((g, j) => '<div class="lp-grp"><div class="lp-grp-h">' + gname(g[0]) + ' <span>' + g[1].length + '</span></div>' + g[1].map(k => card(k, j + 3)).join('') + '</div>').join('') + '</div>';
    setHtml('lp-nbUi', h);
    const s = e.search, mk = tr(s.mark);
    setText('lp-v2p', tr(s.lede));
    setHtml('lp-searchUi', '<div class="lp-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>' + tr(s.q) + '</span><span class="lp-caret" aria-hidden="true"></span></div>' +
      '<div class="lp-chips"><span class="lp-on">' + tr(s.chip) + '</span><span>' + t('ui.gear') + '</span><span>' + t('ui.time') + '</span><span>Type</span></div>' +
      '<div class="lp-res">' + s.res.map((k, i) => { const it = e.items[k], g = gname(it.g), gm = g.indexOf(mk) === 0 ? '<mark>' + mk + '</mark>' + g.slice(mk.length) : g;
        return '<a href="#">' + pic(k, i) + '<span><b>' + tr(it.t) + '</b><small>' + gm + ' · ' + (i === 0 ? tr(s.note) : tr(it.m)) + '</small></span></a>'; }).join('') + '</div>');
    const n = e.note;
    setHtml('lp-notesUi', '<div class="lp-ph">' + frame(n.frame) + '<b>' + (n.frame + 1) + ' · ' + tr(n.step) + '</b></div>' +
      '<div class="lp-r"><span class="lp-t">' + tr(e.title) + '</span>' +
      '<label for="lp-noteTa">' + t('ui.notes') + '</label><textarea id="lp-noteTa" readonly>' + tr(n.text) + '</textarea>' +
      '<span class="lp-saved">' + t('ui.saved') + '</span>' +
      '<a class="lp-orig" href="#"><span class="lp-play"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg></span><span><b>' + t('ui.orig') + '</b><small>' + tr(n.who) + '</small></span></a>' +
      '<div class="lp-count"><b>' + n.n + '</b><span>' + tr(n.done) + '</span></div></div>');
    const ss = e.session;
    setHtml('lp-sessionUi', '<span class="lp-meta">' + t('ui.session') + ' · ' + e.nb + '</span><div class="lp-st">' + tr(ss.title) + '</div><span class="lp-meta">' + tr(ss.format) + '</span>' +
      '<ol>' + ss.items.map((r, i) => { const it = e.items[r[0]]; return '<li>' + pic(r[0], i) + '<span><b>' + tr(it.t) + '</b><small><i>' + r[1] + '</i>' + gname(it.g) + '</small></span><span class="lp-dose">' + tr(r[2]) + '</span></li>'; }).join('') + '</ol>' +
      '<button class="lp-done" type="button">' + t('ui.done') + '</button>');
    const p = e.progress;
    const shelf = (title, desc, rows) => '<div data-ui class="lp-shelf"><h3>' + title + '</h3><p>' + desc + '</p><div class="lp-items">' + rows + '</div></div>';
    const it2 = (k, i, tag) => '<div class="lp-it">' + pic(k, i) + '<span><b>' + tr(e.items[k].t) + '</b>' + tag + '</span></div>';
    setHtml('lp-progressUi',
      shelf(t('ui.nw.h'), t('ui.nw.p'), p.nw.map((k, i) => it2(k, i, '<span class="lp-tag-new">' + t('ui.new') + '</span>')).join('')) +
      shelf(t('ui.tr.h'), t('ui.tr.p'), p.tr.map((k, i) => it2(k, i + 2, '<span class="lp-tag-try">' + t('ui.tr.tag') + '</span>')).join('')) +
      shelf(t('ui.dn.h'), t('ui.dn.p'), p.dn.map((r, i) => it2(r[0], i + 3, '<span class="lp-tag-done">' + tr(r[1]) + '</span>')).join('')));
    all('#intro [data-frame]').forEach(el => { el.innerHTML = frame(+el.getAttribute('data-frame')); });
    setText('lp-rUrl', e.url);
    const fk = ex === 'mma' ? 'kick' : 'pir';
    setHtml('lp-routeNb', '<div class="lp-h"><span class="lp-ui-badge">' + icon(e.icon) + '</span>' + e.nb + '</div><div class="lp-g">' + gname(e.items[fk].g) + '</div>' + pic(fk, 0) + '<b>' + tr(e.items[fk].t) + '</b><span class="lp-tag-new">' + t('ui.new') + '</span>');
    all('#intro .lp-ex button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-ex') === ex)));
  };
  const renderLib = () => setHtml('lp-lib', LIB.map(l => '<span><i style="background:' + l[2] + '">' + icon(l[1]) + '</i>' + l[0] + '</span>').join('') + '<span class="lp-more">' + t('ui.more') + '</span>');

  // ---------- seats (beta_seats(), L32: {taken, total, open} or null) ----------
  let seatData = null;
  const seatsOf = d => {
    const o = Array.isArray(d) ? d[0] : d;
    if (!o || typeof o !== 'object' || o.taken == null || o.total == null) return null;
    const taken = Number(o.taken), total = Number(o.total);
    return Number.isFinite(taken) && Number.isFinite(total) && total > 0 && taken >= 0 ? {taken: Math.min(Math.round(taken), total), total: Math.round(total)} : null;
  };
  const paintSeats = () => {
    const s = seatData;
    all('[data-seats-line]').forEach(el => { el.hidden = !s; });
    all('[data-seats]').forEach(el => { el.textContent = s ? fill(t('seats'), s) : ''; });
    all('[data-seats-bar]').forEach(el => {
      el.hidden = !s;
      const bar = el.querySelector ? el.querySelector('i') : null;
      if (s && bar && bar.style) bar.style.width = Math.round(100 * s.taken / s.total) + '%';
    });
  };
  const seats = d => { seatData = seatsOf(d); paintSeats(); return !!seatData; };

  // ---------- language ----------
  const listeners = [];
  const apply = () => {
    if (doc && doc.documentElement) doc.documentElement.lang = lang;
    all('[data-k]').forEach(el => { const v = t(el.getAttribute('data-k')); if (v != null) el.innerHTML = v; });
    all('[data-ka]').forEach(el => { const v = t(el.getAttribute('data-ka')); if (v != null) el.setAttribute('aria-label', v); });
    all('#intro .lp-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)));
    // the « Your own notebook » example: translated while it holds an example, kept once the visitor has typed in it
    const example = (el, k) => el && (el.value === DICT.fr[k] || el.value === DICT.en[k]);
    const name = $('lp-cuName'), desc = $('lp-cuDesc');
    if (example(name, 'cu.name')) name.value = t('cu.name');
    if (example(desc, 'cu.desc')) desc.value = t('cu.desc');
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
  if (intro) {
    all('#intro .lp-lang button').forEach(b => on(b, 'click', () => setLang(b.getAttribute('data-lang'))));
    all('#intro .lp-ex button').forEach(b => on(b, 'click', () => setExample(b.getAttribute('data-ex'))));
    on($('lp-thumbs'), 'click', ev => { const b = ev.target && ev.target.closest ? ev.target.closest('button[data-i]') : null; if (b) { stop(); show(+b.getAttribute('data-i')); } });
    on($('lp-scrub'), 'input', ev => { stop(); show(+ev.target.value - 1); });
    // in-page links scroll; the app routes on location.hash, so the hash never changes here. Example links are inert.
    on(intro, 'click', ev => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
      if (!a) return;
      ev.preventDefault();
      const h = a.getAttribute('href'), behavior = reduce ? 'auto' : 'smooth';
      if (h === '#lp-top') { if (win.scrollTo) win.scrollTo({top: 0, behavior}); return; }
      const target = h.indexOf('#lp-') === 0 ? $(h.slice(1)) : null;
      if (target && target.scrollIntoView) target.scrollIntoView({behavior, block: 'start'});
    });
    on(intro, 'submit', ev => ev.preventDefault());
    // « Copy the line »: the clipboard API, else the page's copy command on the selected line; when neither copies,
    // the line stays selected and a message says to copy it by hand (one tap on the line selects it all).
    on($('lp-copy'), 'click', ev => {
      const b = ev.currentTarget || ev.target, pre = intro.querySelector ? intro.querySelector('pre') : null, msg = $('lp-copyMsg'), label = t('i2.copy');
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
      if (bar && bar.classList) bar.classList.toggle('lp-scrolled', (win.scrollY || 0) > 4);
    };
    on(win, 'scroll', spy, {passive: true}); on(win, 'resize', spy);
    if (!reduce && typeof setInterval === 'function') timer = setInterval(() => { if (shown() && !(doc && doc.hidden)) show((step + 1) % 6); }, 2600);
    if (typeof fetch === 'function') {
      fetch(MMA + 'image-map.json').then(r => r.ok ? r.json() : null).then(m => {
        const before = mma.steps.length + Object.keys(mma.cards).length;
        readManifest(m);
        if (before || mma.steps.length || Object.keys(mma.cards).length) renderAll();
      }).catch(() => {});
    }
  }
  apply();

  win.RBL = {
    DICT, pickLang, t, fill, setLang, setExample, seats, apply, readManifest,
    get lang() { return lang; }, get example() { return ex; }, get step() { return step; },
    onChange: fn => { if (typeof fn === 'function') listeners.push(fn); }
  };
})();
