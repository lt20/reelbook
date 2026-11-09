// Reelbook — app configuration.
// `library` lists the built-in notebooks a user can turn on. Each account keeps its own set
// (table user_themes) and can add custom notebooks with a name + description. The skill reads
// the account's notebooks with `rb.py themes` to classify a reel.
window.REELBOOK = {
  // The hosted backend offered by the Reelbook maintainers. Leave url empty to hide the option.
  hosted: {
    name: 'Reelbook hosted',
    url: 'https://xgarsygrkfnfyvxkcxdm.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnYXJzeWdya2ZuZnl2eGtjeGRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODk1NjIsImV4cCI6MjEwNjg2NTU2Mn0.ThclH-X2LC4MURxf27jFsjYHXzohJ8HYrscbd8E8U3I',
    blurb: 'Free for now. A paid hosted plan is planned; no setup required.',
    // Where someone stuck on the email code can write (mailto:…, https:… or a plain address). Empty: no link (L41).
    contact: 'contact@reelbook.si',
    // false: this backend cannot send email yet, so « Forgot your password? » is not offered on it. Nothing else depends on it (L41b).
    mailReady: true,
    // Cloudflare Turnstile site key (public) for this backend's sign-up, sign-in, resend and forgot password (L42b).
    // Empty: no Turnstile script, no widget, no token, as before. Own backends never get one.
    turnstileSiteKey: '0x4AAAAAAF45RKwsnrh2qxCJ'
  },
  // Notebooks turned on for a brand-new account.
  defaults: ['strength', 'yoga', 'fight'],
  // Built-in notebooks. `color` is an index in the 8-colour palette of index.html (--p0 … --p7).
  // `profile` picks the sheet template the skill writes (L16): 'gym' (sets, reps, rest: templates/sheet.html),
  // 'technique' (a trick worked by tries, with conditions and a go / no-go: templates/technique.html) or
  // 'partner' (technique + roles and control / tap). A notebook an account created (user_themes) has no profile:
  // rb.py themes reads it here by id, 'gym' for a custom notebook.
  // `family` (P8 R14) is the kind of practice by default: 'technique' (learning a move: a level per sheet, « 4 of 9
  // learned ») or 'repetition' (the rhythm of sessions). An account can change it (user_themes.family); a custom
  // notebook is 'repetition'. It is not the profile: the profile picks the sheet template, the family the reward.
  // `icon` (L21) names the notebook's pictogram, <symbol id="nb-<icon>"> in icons.svg; a custom notebook shows 'custom'.
  library: [
    { id: 'strength', title: 'Strength', sub: 'Weights, bodyweight, bands. Movements and circuits.', color: 0, profile: 'gym', family: 'repetition', icon: 'strength',
      groups: ['Shoulders', 'Arms', 'Abs', 'Back', 'Core', 'Hips', 'Knees', 'Legs', 'Mobility'] },
    { id: 'yoga', title: 'Yoga & stretching', sub: 'Poses, stretches, breathing, flows.', color: 1, profile: 'gym', family: 'repetition', icon: 'yoga',
      groups: ['Back', 'Hips', 'Shoulders', 'Legs', 'Breathing', 'Flows'] },
    { id: 'fight', title: 'Fight techniques', sub: 'Striking, defense, clinch, footwork.', color: 2, profile: 'partner', family: 'technique', icon: 'fight',
      groups: ['Punches', 'Kicks & knees', 'Defense', 'Clinch & grappling', 'Footwork', 'Bag & pads'] },
    { id: 'kitesurf', title: 'Kitesurf', sub: 'Kite control, water start, riding, jumps, transitions.', color: 3, profile: 'technique', family: 'technique', icon: 'kitesurf',
      groups: ['Kite control', 'Water start', 'Riding', 'Transitions', 'Jumps & tricks', 'Safety'] },
    { id: 'kitefoil', title: 'Kitefoil', sub: 'Foil start, balance, carving, light wind.', color: 3, profile: 'technique', family: 'technique', icon: 'kitefoil',
      groups: ['Start', 'Balance', 'Carving', 'Transitions', 'Light wind', 'Safety'] },
    { id: 'wingfoil', title: 'Wingfoil', sub: 'Wing handling, pumping, take-off, jibes, tacks.', color: 3, profile: 'technique', family: 'technique', icon: 'wingfoil',
      groups: ['Wing handling', 'Take-off', 'Pumping', 'Jibes & tacks', 'Waves', 'Safety'] },
    { id: 'wakeboard', title: 'Wakeboard', sub: 'Cable and boat: starts, edging, jumps, grabs.', color: 3, profile: 'technique', family: 'technique', icon: 'wakeboard',
      groups: ['Start', 'Edging', 'Jumps', 'Grabs & spins', 'Obstacles', 'Falls'] },
    { id: 'surf', title: 'Surfing', sub: 'Paddling, take-off, bottom turn, cutback, reading waves.', color: 3, profile: 'technique', family: 'technique', icon: 'surf',
      groups: ['Paddling', 'Take-off', 'Turns', 'Reading waves', 'Fitness', 'Safety'] },
    { id: 'swim', title: 'Swimming', sub: 'Strokes, breathing, drills, open water.', color: 3, profile: 'gym', family: 'repetition', icon: 'swim',
      groups: ['Freestyle', 'Breaststroke', 'Backstroke', 'Butterfly', 'Breathing', 'Open water'] },
    { id: 'run', title: 'Running', sub: 'Form, drills, strength for runners, sessions.', color: 4, profile: 'gym', family: 'repetition', icon: 'run',
      groups: ['Form', 'Drills', 'Strength', 'Sessions', 'Recovery'] },
    { id: 'bike', title: 'Cycling', sub: 'Position, pedalling, climbing, descending, maintenance.', color: 4, profile: 'gym', family: 'repetition', icon: 'bike',
      groups: ['Position', 'Pedalling', 'Climbing', 'Descending', 'Maintenance', 'Sessions'] },
    { id: 'hike', title: 'Hiking & trail', sub: 'Uphill, downhill, poles, packing, nutrition on the move.', color: 4, profile: 'gym', family: 'repetition', icon: 'hike',
      groups: ['Uphill', 'Downhill', 'Poles', 'Packing', 'Nutrition'] },
    { id: 'climb', title: 'Climbing & bouldering', sub: 'Footwork, grips, body position, dynamic moves, finger care.', color: 4, profile: 'technique', family: 'technique', icon: 'climb',
      groups: ['Footwork', 'Grips', 'Body position', 'Dynamic moves', 'Finger care'] },
    { id: 'snow', title: 'Ski & snowboard', sub: 'Carving, moguls, powder, park, off-piste basics.', color: 4, profile: 'technique', family: 'technique', icon: 'snow',
      groups: ['Carving', 'Moguls', 'Powder', 'Park', 'Off-piste'] },
    { id: 'ride', title: 'Horse riding', sub: 'Seat, aids, transitions, jumping, groundwork.', color: 4, profile: 'technique', family: 'technique', icon: 'ride',
      groups: ['Seat', 'Aids', 'Transitions', 'Jumping', 'Groundwork'] },
    { id: 'racket', title: 'Tennis & padel', sub: 'Serve, forehand, backhand, volley, footwork.', color: 4, profile: 'gym', family: 'technique', icon: 'racket',
      groups: ['Serve', 'Forehand', 'Backhand', 'Volley', 'Footwork'] },
    { id: 'golf', title: 'Golf', sub: 'Grip, set-up, swing, chipping, putting.', color: 4, profile: 'gym', family: 'technique', icon: 'golf',
      groups: ['Grip & set-up', 'Swing', 'Chipping', 'Putting', 'Course'] },
    { id: 'pilates', title: 'Pilates', sub: 'Mat and reformer: core, control, alignment.', color: 5, profile: 'gym', family: 'repetition', icon: 'pilates',
      groups: ['Core', 'Spine', 'Hips', 'Shoulders', 'Reformer', 'Flows'] },
    { id: 'barre', title: 'Barre', sub: 'Ballet-inspired strength: legs, glutes, posture.', color: 5, profile: 'gym', family: 'repetition', icon: 'barre',
      groups: ['Legs', 'Glutes', 'Arms', 'Core', 'Posture', 'Flows'] },
    { id: 'pole', title: 'Pole dance', sub: 'Spins, climbs, inverts, holds, floorwork, conditioning.', color: 5, profile: 'technique', family: 'technique', icon: 'pole',
      groups: ['Spins', 'Climbs', 'Inverts', 'Holds', 'Floorwork', 'Conditioning'] },
    { id: 'dance', title: 'Dance', sub: 'Steps, combos, isolations, musicality.', color: 5, profile: 'gym', family: 'technique', icon: 'dance',
      groups: ['Basics', 'Combos', 'Isolations', 'Turns', 'Musicality'] },
    { id: 'mobility', title: 'Mobility & rehab', sub: 'Joint health, injury recovery, daily routines.', color: 1, profile: 'gym', family: 'repetition', icon: 'mobility',
      groups: ['Neck', 'Shoulders', 'Spine', 'Hips', 'Knees', 'Ankles & feet'] },
    { id: 'prenatal', title: 'Prenatal & postnatal', sub: 'Safe movement during pregnancy and after birth.', color: 5, profile: 'gym', family: 'repetition', icon: 'prenatal',
      groups: ['Pregnancy', 'Birth prep', 'Postnatal', 'Core & floor', 'Breathing'] },
    { id: 'floor', title: 'Pelvic floor & core', sub: 'Breathing, deep core, pelvic floor training.', color: 5, profile: 'gym', family: 'repetition', icon: 'floor',
      groups: ['Breathing', 'Deep core', 'Pelvic floor', 'Posture', 'Routines'] },
    { id: 'breath', title: 'Breathwork & meditation', sub: 'Breathing techniques, calm, focus, sleep.', color: 1, profile: 'gym', family: 'repetition', icon: 'breath',
      groups: ['Breathing', 'Calm', 'Focus', 'Sleep', 'Routines'] },
    { id: 'cook', title: 'Cooking', sub: 'Recipes, techniques, knife skills, batch cooking.', color: 6, profile: 'gym', family: 'technique', icon: 'cook',
      groups: ['Basics & knife skills', 'Breakfast', 'Mains', 'Sides & salads', 'Desserts', 'Batch cooking'] },
    { id: 'nutrition', title: 'Nutrition & meal prep', sub: 'Protein, hydration, planning, recipes for training.', color: 6, profile: 'gym', family: 'repetition', icon: 'nutrition',
      groups: ['Protein', 'Hydration', 'Planning', 'Snacks', 'Supplements'] },
    { id: 'beauty', title: 'Beauty & skincare', sub: 'Skin, hair, nails, routines, massage.', color: 7, profile: 'gym', family: 'repetition', icon: 'beauty',
      groups: ['Skin', 'Hair', 'Nails', 'Face massage', 'Routines'] },
    { id: 'crafts', title: 'Sewing & crafts', sub: 'Stitches, patterns, knitting, repairs, DIY.', color: 7, profile: 'gym', family: 'technique', icon: 'crafts',
      groups: ['Sewing', 'Knitting & crochet', 'Patterns', 'Repairs', 'DIY'] }
  ],
  // L23, faceted library: the fixed vocabulary of a sheet's tags (sheets.tags, written by the skill in meta.json,
  // checked by rb.py publish, which reads this block). A sheet holds {zone: [], gear: [], minutes: n | null, type: ''}.
  // `time` buckets tags.minutes for the search view: [label, from (included), to (excluded) or null].
  facets: {
    zone: ['shoulders', 'arms', 'chest', 'back', 'core', 'hips', 'legs', 'knees', 'ankles', 'neck', 'full body'],
    gear: ['none', 'mat', 'band', 'dumbbell', 'kettlebell', 'barbell', 'bar', 'rings', 'ball', 'foam roller', 'chair', 'wall', 'board', 'kite', 'plate', 'cable', 'machine', 'bench'],
    type: ['strength', 'mobility', 'stretch', 'cardio', 'skill', 'drill', 'warm-up', 'routine'],
    time: [['< 5', 0, 5], ['5–10', 5, 10], ['10–20', 10, 20], ['20+', 20, null]]
  },
  repo: 'https://github.com/lt20/reelbook'
};
