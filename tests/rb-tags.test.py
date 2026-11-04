"""Faceted library in tools/rb.py (L23): the vocabulary read from app/config.js, tags checked and sent by publish,
minutes from a duration, and backfill-tags (derived without Claude, paging, refusal before the column exists).

No network: `session` and `rest` are replaced by fakes that record every call.
Run: python3 -I tests/rb-tags.test.py
"""
import contextlib, importlib.util, io, json, pathlib, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://example.test", "anon_key": "k", "access_token": "t", "user_id": "u1"}
NO_COLUMN = '{"code":"PGRST204","message":"Could not find the \'%s\' column of \'sheets\' in the schema cache"}'
TAGS = {"zone": ["shoulders"], "gear": ["band"], "minutes": 8, "type": "mobility"}


def run(fn, args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        fn(args)
    return out.getvalue(), err.getvalue()


def sheet_dir(root, slug="sheet", **meta):
    d = pathlib.Path(root) / slug
    d.mkdir()
    m = {"slug": slug, "kind": "sheet", "theme": "strength", "group": "Shoulders", "title": "Band rotation", "duration": "8 min"}
    m.update(meta)
    (d / "meta.json").write_text(json.dumps(m))
    (d / "index.html").write_text("<p>Band rotation</p>")
    return d


class Fake:
    """rest() stand-in: GET answers `gets[table]`; POST raises for the columns in `missing`, else one row."""
    def __init__(self, gets=None, missing=()):
        self.calls, self.gets, self.missing = [], gets or {}, set(missing)

    def __call__(self, cfg, method, table, data=None, prefer=None, params=None, tolerate=()):
        self.calls.append((method, table, data, params))
        if method == "GET":
            sel = (params or {}).get("select", "")
            gone = [c for c in self.missing if c in sel.split(",")]
            if gone: raise rb.RbHTTPError(400, '{"code":"42703","message":"column sheets.%s does not exist"}' % gone[0])
            return self.gets.get(table, [])
        if method == "POST":
            gone = [c for c in self.missing if c in data]
            if gone: raise rb.RbHTTPError(400, NO_COLUMN % gone[0])
            return [{"id": "saved"}]
        return []

    def writes(self):
        return [c for c in self.calls if c[0] != "GET"]


class Base(unittest.TestCase):
    def setUp(self):
        self._saved = rb.session, rb.rest, rb._known_themes
        rb.session = lambda: CFG
        rb._known_themes = lambda cfg: {"strength"}

    def tearDown(self):
        rb.session, rb.rest, rb._known_themes = self._saved


class Vocabulary(unittest.TestCase):
    def test_read_from_app_config(self):
        v = rb.facets_vocab()
        self.assertIn("full body", v["zone"])
        self.assertIn("foam roller", v["gear"])
        self.assertIn("warm-up", v["type"])
        self.assertNotIn("time", v)

    def test_unreadable_config_means_no_vocabulary(self):
        self.assertEqual(rb.facets_vocab("/nonexistent/config.js"), {})
        self.assertEqual(rb._tag_problems({"zone": ["elbow"]}, {}), ([], []))

    def test_malformed_and_unknown(self):
        v = rb.facets_vocab()
        errors, unknown = rb._tag_problems({"zone": "shoulders", "minutes": "8", "type": 3}, v)
        self.assertEqual(len(errors), 3, errors)
        errors, unknown = rb._tag_problems({"zone": ["elbow"], "gear": ["band"], "type": "yoga", "colour": "red"}, v)
        self.assertEqual(errors, [])
        self.assertEqual(len(unknown), 3, unknown)
        self.assertEqual(rb._tag_problems({"zone": [], "gear": [], "minutes": None, "type": ""}, v), ([], []))


class Minutes(unittest.TestCase):
    def test_durations(self):
        for text, n in [("8 min", 8), ("10–15 min", 15), ("10 to 15 minutes", 15), ("1 h", 60), ("1 h 30 min", 90),
                        ("45 s", 1), ("20", None), ("", None), ("3 sets", None), ("4 rounds, 5 min", 5), ("2,5 min", 3)]:
            self.assertEqual(rb._minutes(text), n, text)


class Publish(Base):
    def test_meta_without_tags_sends_no_tags(self):
        fake = rb.rest = Fake()
        with tempfile.TemporaryDirectory() as root:
            run(rb.cmd_publish, [str(sheet_dir(root))])
        post = [c for c in fake.writes() if c[:2] == ("POST", "sheets")][0]
        self.assertNotIn("tags", post[2], "an update keeps the tags the sheet had")

    def test_minutes_from_duration_when_left_out(self):
        fake = rb.rest = Fake()
        with tempfile.TemporaryDirectory() as root:
            run(rb.cmd_publish, [str(sheet_dir(root, tags={"zone": ["shoulders"], "gear": [], "type": ""}))])
        post = [c for c in fake.writes() if c[:2] == ("POST", "sheets")][0]
        self.assertEqual(post[2]["tags"]["minutes"], 8)

    def test_malformed_tags_refused_even_on_an_existing_sheet(self):
        fake = rb.rest = Fake(gets={"sheets": [{"slug": "sheet"}]})
        with tempfile.TemporaryDirectory() as root:
            d = sheet_dir(root, tags={"zone": "shoulders"})
            with self.assertRaises(SystemExit):
                run(rb.cmd_publish, [str(d)])
        self.assertEqual(fake.writes(), [])

    def test_backend_without_either_column(self):
        fake = rb.rest = Fake(missing=("search_text", "tags"))
        with tempfile.TemporaryDirectory() as root:
            _, err = run(rb.cmd_publish, [str(sheet_dir(root, tags=TAGS))])
        posts = [c[2] for c in fake.writes() if c[:2] == ("POST", "sheets")]
        self.assertEqual(len(posts), 3)
        self.assertFalse({"search_text", "tags"} & set(posts[-1]))
        self.assertIn("sheets.tags", err)

    def test_session_sheets_are_checked_before_any_write(self):
        fake = rb.rest = Fake(gets={"sessions": []})
        with tempfile.TemporaryDirectory() as root:
            d = pathlib.Path(root) / "session-x"
            d.mkdir()
            sheet_dir(d, "session-x-a", tags={"zone": ["elbow"]})
            (d / "meta.json").write_text(json.dumps({"slug": "session-x", "kind": "session", "theme": "strength",
                                                     "title": "X", "items": [{"slug": "session-x-a", "dose": "30 s"}]}))
            with self.assertRaises(SystemExit):
                run(rb.cmd_publish, [str(d)])
        self.assertEqual(fake.writes(), [])


class Derive(unittest.TestCase):
    def test_keywords(self):
        v = rb.facets_vocab()
        t = rb.derive_tags({"group": "Ankles & feet", "title": "Wall calf stretch", "search_text": "", "duration": ""}, v)
        self.assertEqual(t, {"zone": ["ankles"], "gear": ["wall"], "minutes": None, "type": "stretch"})
        t = rb.derive_tags({"group": "Mobility", "title": "Épaules au tapis", "search_text": "Échauffement au poids du corps", "duration": "5 min"}, v)
        self.assertEqual(t["zone"], ["shoulders"])
        self.assertEqual(t["gear"], ["mat"])
        self.assertEqual(t["type"], "mobility", "the group names the type before the text")
        t = rb.derive_tags({"group": "Kite control", "title": "Body drag", "search_text": "Keep the kite at 12. No equipment besides the kite.", "duration": ""}, v)
        self.assertEqual(t["gear"], ["kite"])
        self.assertEqual(t["zone"], [])
        t = rb.derive_tags({"group": "Core", "title": "Hollow hold", "search_text": "Bodyweight only.", "duration": ""}, v)
        self.assertEqual(t["gear"], ["none"])
        self.assertEqual(rb.derive_tags({"group": "Arms", "title": "Barbell curl", "search_text": "", "duration": ""}, v)["gear"], ["barbell"])


class Rules(unittest.TestCase):
    """L23b, the second pass after Laurent's dry run of 4 Nov."""
    def tags(self, **row):
        return rb.derive_tags(dict({"slug": "", "theme": "strength", "group": "", "title": "", "search_text": "", "duration": ""}, **row))

    def test_new_gear_values_are_in_the_vocabulary(self):
        self.assertLessEqual({"plate", "cable", "machine", "bench"}, set(rb.facets_vocab()["gear"]))
        self.assertEqual(self.tags(title="Rowing au banc, poulie basse")["gear"], ["cable", "bench"])
        self.assertEqual(self.tags(title="Weight plate halo")["gear"], ["plate"])

    def test_title_without_equipment_beats_the_slug(self):
        for title in ("Shrugs sans matériel", "Shrugs without equipment", "Shrugs, no equipment", "Shrugs sans équipement",
                      "Bodyweight shrugs", "Shrugs au poids du corps", "Equipment-free shrugs"):
            self.assertEqual(self.tags(slug="session-dos-2-halteres-shrugs", title=title)["gear"], ["none"], title)
        self.assertEqual(self.tags(slug="session-dos-2-halteres-shrugs", title="Shrugs",
                                   search_text="Au poids du corps ou avec haltères")["gear"], ["dumbbell"])
        self.assertEqual(self.tags(title="Band pull-apart, no equipment besides the band")["gear"], ["band"])

    def test_no_zone_in_technique_or_partner_notebooks(self):
        self.assertEqual(self.tags(theme="fight", group="Kicks & knees", title="Coup de genou")["zone"], [])
        self.assertEqual(self.tags(theme="kitefoil", group="Transitions", title="Tack : les pieds")["zone"], [])
        self.assertEqual(self.tags(theme="my-own", group="Knees", title="Knee lift")["zone"], ["knees"], "a custom notebook is gym")

    def test_group_maps_to_a_zone_only_when_it_is_body_areas(self):
        self.assertEqual(self.tags(theme="my-own", group="Kicks & knees", title="Roundhouse")["zone"], [])
        self.assertEqual(self.tags(group="Ankles & feet", title="Calf raise")["zone"], ["ankles"])
        self.assertEqual(self.tags(group="Hips and glutes", title="Clamshell")["zone"], ["hips"])

    def test_title_beats_group_and_triceps_beats_push_up(self):
        self.assertEqual(self.tags(group="Core", title="Pompe triceps")["zone"], ["arms"])
        self.assertEqual(self.tags(group="Core", title="Pompes au poids du corps")["zone"], ["chest"])
        self.assertEqual(self.tags(group="Shoulders", title="Diver push-up")["zone"], ["chest"])
        self.assertEqual(self.tags(group="Mobility", slug="session-redresser-epaules-rotation", title="Rotation")["zone"], ["shoulders"],
                         "the session part of the slug, last")

    def test_type_fallbacks_in_order(self):
        self.assertEqual(self.tags(slug="session-echauffement-epaules-z-press", title="Z press")["type"], "warm-up")
        self.assertEqual(self.tags(theme="fight", title="Osoto gari", search_text="A good warm-up drill")["type"], "skill",
                         "the profile before the search text")
        self.assertEqual(self.tags(theme="fight", title="Shadow boxing drill")["type"], "drill", "a keyword before the profile")
        self.assertEqual(self.tags(title="Curl", search_text="Mobility for the elbow")["type"], "mobility", "the text before the notebook")
        self.assertEqual(self.tags(title="Curl")["type"], "strength")
        self.assertEqual(self.tags(theme="yoga", title="Pigeon")["type"], "stretch")
        self.assertEqual(self.tags(theme="cook", title="Pizza a la piedra : étirer la pâte")["type"], "")
        self.assertEqual(self.tags(theme="my-own", title="Curl")["type"], "")

    def test_profiles_can_be_passed(self):
        row = {"slug": "x", "theme": "strength", "group": "Knees", "title": "Kick", "search_text": "", "duration": ""}
        self.assertEqual(rb.derive_tags(row, rb.facets_vocab(), {"strength": "partner"})["zone"], [])


# Regression table: the 110 slugs of Laurent's dry run (4 Nov, slugs and tags only). The notebook, group and title of
# each row are simulated (plausible library group, title derived from the slug, no search text): the real ones were
# not read. Expected tags: zone / gear / type (minutes come from the duration, unchanged by L23b).
def _sheets():
    S = "strength"
    one = [  # slug, notebook, group, title, duration, zone, gear, type
        ("ange-au-sol", S, "Shoulders", "Ange au sol", "3 min", ["shoulders"], [], "strength"),
        ("angel-allonge-canettes", S, "Shoulders", "Angel allongé avec canettes", "3 min", ["shoulders"], [], "strength"),
        ("coup-de-pied-tournant-foie", "fight", "Kicks & knees", "Coup de pied tournant au foie", "6 min", [], [], "skill"),
        ("curl-marteau-5-etapes", S, "Arms", "Curl marteau en 5 étapes", "5 min", ["arms"], [], "strength"),
        ("darkslide-kite-loop", "kitesurf", "Jumps & tricks", "Darkslide kite loop", "", [], ["kite"], "skill"),
        ("defense-coup-de-tete", "fight", "Defense", "Défense sur coup de tête", "5 min", [], [], "skill"),
        ("defense-prise-de-nuque", "fight", "Clinch & grappling", "Défense sur prise de nuque (genou)", "10 min", [], [], "skill"),
        ("depart-ponton-pump-foil", "kitefoil", "Start", "Départ ponton en pump foil", "15 min", [], [], "skill"),
        ("developpe-arnold-ouvert", S, "Shoulders", "Développé Arnold ouvert", "6 min", ["shoulders"], [], "strength"),
        ("developpe-epaules-halteres", S, "Shoulders", "Développé épaules aux haltères", "8 min", ["shoulders"], ["dumbbell"], "strength"),
        ("developpe-incline-smith", S, "Chest", "Développé incliné à la Smith (pecs)", "10 min", ["chest"], ["machine"], "strength"),
        ("diagonal-stretch-hanches", S, "Hips", "Diagonal stretch des hanches", "5 min", ["hips"], [], "stretch"),
        ("elevations-laterales-coudes", S, "Shoulders", "Élévations latérales coudes fléchis", "6 min", ["shoulders"], [], "strength"),
        ("finisher-biceps-5kg", S, "Arms", "Finisher biceps à 5 kg", "3 min", ["arms"], [], "strength"),
        ("flow-hanches-cosaque-assis", "yoga", "Hips", "Flow hanches : cosaque assis", "3 min", ["hips"], [], "stretch"),
        ("flow-pompes-poids-du-corps", S, "Core", "Flow pompes au poids du corps", "1 min", ["chest"], ["none"], "strength"),
        ("foil-tack-kitesurf", "kitefoil", "Transitions", "Foil tack en kitesurf (pieds)", "7 min", [], [], "skill"),
        ("front-kick-through-progression", S, "Hips", "Front kick-through, progression", "10 min", ["hips"], [], "strength"),
        ("osoto-gari", "fight", "Clinch & grappling", "O-soto-gari", "10 min", [], [], "skill"),
        ("osoto-gari-mma", "fight", "Clinch & grappling", "O-soto-gari en MMA", "10 min", [], [], "skill"),
        ("passage-toeside-kitesurf", "kitesurf", "Riding", "Passage en toeside", "1 min", [], [], "skill"),
        ("pizza-a-la-piedra-etirer", "cook", "Mains", "Pizza a la piedra : étirer la pâte", "1 min", [], [], ""),
        ("pompe-triceps-cote", S, "Core", "Pompe triceps sur le côté", "4 min", ["arms"], [], "strength"),
        ("side-kick-progression", S, "Core", "Side kick, progression", "5 min", ["core"], [], "strength"),
        ("skier-squat-excentrique", S, "Legs", "Skier squat excentrique", "", ["legs"], [], "strength"),
        ("sortie-cravate-debout", "fight", "Clinch & grappling", "Sortie de cravate debout", "5 min", [], [], "skill"),
        ("sortie-de-dos-luta-livre", "fight", "Clinch & grappling", "Sortie de dos (luta livre)", "5 min", [], [], "skill"),
        ("spanish-squat-elastique", S, "Knees", "Spanish squat à l'élastique", "2 min", ["knees"], ["band"], "strength"),
        ("tack-heel-to-toe-hanches", "kitefoil", "Transitions", "Tack heel-to-toe : les hanches", "8 min", [], [], "skill"),
    ]
    sessions = [  # session, notebook, group, [(anchor, title, zone, gear, type)]
        ("10-min-hanches", S, "Hips", [
            ("90-90-switch", "90/90 switch", ["hips"], [], "strength"), ("copenhagen", "Copenhagen", ["hips"], [], "strength"),
            ("cossack-squat", "Cossack squat", ["hips"], [], "strength"), ("hip-cars", "Hip CARs", ["hips"], [], "strength"),
            ("pigeon-charge", "Pigeon chargé", ["hips"], [], "strength"), ("rdl-une-jambe", "RDL une jambe", ["legs"], [], "strength")]),
        ("coiffe-rotateurs-echauffement", S, "Shoulders", [
            ("elastique-rotation-interne", "Élastique, rotation interne", ["shoulders"], ["band"], "warm-up"),
            ("halo-disque", "Halo au disque", ["shoulders"], ["plate"], "warm-up"),
            ("poulie-rotation-externe-90", "Poulie, rotation externe à 90°", ["shoulders"], ["cable"], "warm-up"),
            ("poulie-rotation-interne-90", "Poulie, rotation interne à 90°", ["shoulders"], ["cable"], "warm-up")]),
        ("dos-2-halteres", S, "Back", [(a, t, ["back"], ["dumbbell"], "strength") for a, t in [
            ("pull-over", "Pull-over"), ("rowing-deadstop", "Rowing deadstop"), ("shrugs", "Shrugs"), ("tirage-bucheron", "Tirage bûcheron")]]),
        ("echauffement-epaules", S, "Shoulders", [(a, t, ["shoulders"], [], "warm-up") for a, t in [
            ("pallof-press", "Pallof press"), ("retraction-scapulaire", "Rétraction scapulaire"), ("rotation-externe", "Rotation externe"),
            ("rotation-interne", "Rotation interne"), ("z-press", "Z press")]]),
        ("full-body-ngannou", S, "Core", [
            ("chandelle", "Chandelle", ["core"], [], "strength"), ("diver-push-up", "Diver push-up", ["chest"], [], "strength"),
            ("essuie-glaces", "Essuie-glaces", ["core"], [], "strength"), ("jump-tuck", "Jump tuck", ["core"], [], "strength"),
            ("planche-pike-sliders", "Planche pike aux sliders", ["core"], [], "strength"),
            ("pompe-triceps", "Pompe triceps", ["arms"], [], "strength"), ("ski-lunge", "Ski lunge", ["core"], [], "strength")]),
        ("jambes-en-beton-ski", S, "Legs", [(a, t, ["legs"], [], "strength") for a, t in [
            ("demi-squats", "Demi-squats"), ("fentes-bulgares", "Fentes bulgares"), ("fentes-du-skieur", "Fentes du skieur"),
            ("planche-copenhague", "Planche Copenhague"), ("rdl-sur-une-jambe", "RDL sur une jambe"),
            ("squats-sur-une-jambe", "Squats sur une jambe")]]),
        ("jambes-excentrique-ski", S, "Legs", [(a, t, ["legs"], [], "strength") for a, t in [
            ("jump-squats", "Jump squats"), ("lateral-step-down", "Lateral step-down"), ("reverse-nordic-controle", "Reverse nordic contrôlé"),
            ("split-squats-excentriques", "Split squats excentriques"), ("step-down", "Step-down")]]),
        ("mobilite-3-mouvements", S, "Mobility", [
            ("fente-longue", "Fente longue", [], [], "mobility"), ("prone-w", "Prone W", [], [], "mobility"),
            ("world-greatest-stretch", "World's greatest stretch", [], [], "stretch")]),
        ("mobilite-surf", S, "Mobility", [
            ("assis-90-90", "Assis 90/90", [], [], "mobility"), ("assis-fente-basse", "Assis, fente basse", [], [], "mobility"),
            ("equilibre-assis", "Équilibre assis", [], [], "mobility"),
            ("etirement-genoux", "Étirement des genoux", ["knees"], [], "stretch"),
            ("genoux-squat", "Genoux, squat", ["knees"], [], "mobility"),
            ("passage-de-jambe", "Passage de jambe", ["legs"], [], "mobility"),
            ("planche-coude-jambe", "Planche sur le coude, jambe levée", ["legs"], [], "mobility"),
            ("planche-laterale-disque", "Planche latérale au disque", [], ["plate"], "mobility"),
            ("pop-up", "Pop-up", [], [], "mobility"), ("rotation-a-genou", "Rotation à genou", ["knees"], [], "mobility"),
            ("rotation-trepied", "Rotation trépied", [], [], "mobility"), ("roulade-squat", "Roulade, squat", [], [], "mobility"),
            ("sauts-mains-disque", "Sauts, mains sur le disque", [], ["plate"], "mobility"),
            ("squat-une-jambe", "Squat sur une jambe", ["legs"], [], "mobility"),
            ("v-sit-disque", "V-sit au disque", [], ["plate"], "mobility")]),
        ("redresser-epaules", S, "Shoulders", [
            ("avant-du-cou", "Avant du cou", ["neck"], [], "strength"),
            ("etirement-pectoraux", "Étirement des pectoraux", ["chest"], [], "stretch"),
            ("planche-inversee", "Planche inversée", ["shoulders"], [], "strength"),
            ("poussee-equilibre", "Poussée en équilibre", ["shoulders"], [], "strength"),
            ("rotation-a-vide", "Rotation à vide", ["shoulders"], [], "strength"),
            ("tractions-scapulaires", "Tractions scapulaires", ["shoulders"], [], "strength"),
            ("tractions-scapulaires-inversees", "Tractions scapulaires inversées", ["shoulders"], [], "strength")]),
        ("routine-mobilite-mma", S, "Mobility", [
            ("90-90-hip-thrust", "90/90 hip thrust", ["hips"], [], "mobility"), ("around-the-world", "Around the world", [], [], "mobility"),
            ("cossack-squat", "Cossack squat", [], [], "mobility"), ("external-rotation-glides", "External rotation glides", [], [], "mobility"),
            ("external-rotations", "External rotations", [], [], "mobility"), ("foot-to-hand-touches", "Foot to hand touches", [], [], "mobility"),
            ("reach-through-rotate", "Reach through, rotate", [], [], "mobility"),
            ("shoulder-dislocations", "Shoulder dislocations", ["shoulders"], [], "mobility")]),
        ("routine-soir-lca", S, "Knees", [
            ("airplanes", "Airplanes", ["knees"], [], "routine"), ("elephant-walks", "Elephant walks", ["knees"], [], "routine"),
            ("extension-disque", "Extension au disque", ["knees"], ["plate"], "routine"),
            ("flexion-avant", "Flexion avant", ["knees"], [], "routine"),
            ("flexion-elastique", "Flexion à l'élastique", ["knees"], ["band"], "routine"),
            ("flexion-fin-amplitude", "Flexion en fin d'amplitude", ["knees"], [], "routine"),
            ("knee-cars", "Knee CARs", ["knees"], [], "routine"), ("psoas", "Psoas", ["knees"], [], "routine"),
            ("rotations-90-90", "Rotations 90/90", ["knees"], [], "routine"),
            ("rotations-quatre-pattes", "Rotations à quatre pattes", ["knees"], [], "routine"),
            ("soins-genou", "Soins du genou", ["knees"], [], "routine")]),
    ]
    rows = [({"slug": s, "theme": th, "group": g, "title": t, "search_text": "", "duration": d}, (z, ge, ty))
            for s, th, g, t, d, z, ge, ty in one]
    for name, th, g, items in sessions:
        rows += [({"slug": f"session-{name}-{a}", "theme": th, "group": g, "title": t, "search_text": "", "duration": ""}, (z, ge, ty))
                 for a, t, z, ge, ty in items]
    return rows

SHEETS = _sheets()


def measure(rows, derive):
    """Empty gear, empty type, and zones on technique / partner sheets over `rows`, with `derive(row) → tags`."""
    profiles = rb.library_profiles()
    tags = [(r, derive(r)) for r in rows]
    return {"empty gear": sum(not t["gear"] for _, t in tags), "empty type": sum(not t["type"] for _, t in tags),
            "zone on technique/partner": sum(bool(t["zone"]) for r, t in tags if profiles.get(r["theme"]) in ("technique", "partner"))}


class DryRunRegression(unittest.TestCase):
    def test_the_110_sheets(self):
        self.assertEqual(len(SHEETS), 110)
        self.assertEqual(len({r["slug"] for r, _ in SHEETS}), 110)
        v, p = rb.facets_vocab(), rb.library_profiles()
        for row, (zone, gear, kind) in SHEETS:
            with self.subTest(slug=row["slug"]):
                t = rb.derive_tags(row, v, p)
                self.assertEqual((t["zone"], t["gear"], t["type"]), (zone, gear, kind))
                self.assertEqual(t["minutes"], rb._minutes(row["duration"]))

    def test_measures(self):
        # Before (Laurent's dry run, 4 Nov): gear empty on 104 of 110, type on ~98, 5 zones on fight / foil sheets.
        v, p = rb.facets_vocab(), rb.library_profiles()
        m = measure([r for r, _ in SHEETS], lambda r: rb.derive_tags(r, v, p))
        self.assertEqual(m, {"empty gear": 92, "empty type": 1, "zone on technique/partner": 0})


class Backfill(Base):
    ROW = {"slug": "a", "theme": "strength", "group": "Knees", "title": "Mat stretch", "search_text": "", "duration": "4 min", "tags": {}}

    def test_refused_before_the_column_exists(self):
        fake = rb.rest = Fake(missing=("tags",))
        err = io.StringIO()
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(err):
            rb.cmd_backfill_tags([])
        self.assertIn("sheets.tags", err.getvalue())
        self.assertEqual(fake.writes(), [])

    def test_without_search_text_column_reads_without_it(self):
        fake = rb.rest = Fake(gets={"sheets": [dict(self.ROW)]}, missing=("search_text",))
        run(rb.cmd_backfill_tags, [])
        self.assertEqual(len([c for c in fake.calls if c[0] == "PATCH"]), 1)

    def test_skips_tagged_and_empty_and_guards_the_write(self):
        rows = [dict(self.ROW), dict(self.ROW, slug="b", tags={"zone": ["knees"]}),
                dict(self.ROW, slug="c", theme="cook", group="Breathing", title="Box breathing", duration="")]
        fake = rb.rest = Fake(gets={"sheets": rows})
        out, _ = run(rb.cmd_backfill_tags, [])
        patches = [c for c in fake.calls if c[0] == "PATCH"]
        self.assertEqual([p[3]["slug"] for p in patches], ["eq.a"])
        self.assertEqual(patches[0][3]["tags"], "eq.{}", "a sheet republished since the read keeps its tags")
        get = fake.calls[0][3]
        self.assertEqual(get["tags"], "eq.{}")
        self.assertIn("2 sheet(s) without tags, 1 tagged", out)

    def test_pages_by_slug(self):
        page = [dict(self.ROW, slug=f"s{i:03d}") for i in range(200)]
        answers = [page, [dict(self.ROW, slug="s999")]]
        calls = []
        def rest(cfg, method, table, data=None, prefer=None, params=None, tolerate=()):
            calls.append((method, params))
            return answers.pop(0) if method == "GET" else []
        rb.rest = rest
        run(rb.cmd_backfill_tags, ["--dry-run"])
        gets = [p for m, p in calls if m == "GET"]
        self.assertEqual(len(gets), 2)
        self.assertEqual(gets[1]["slug"], "gt.s199")
        self.assertEqual([m for m, _ in calls if m != "GET"], [])

    def test_usage(self):
        with self.assertRaises(SystemExit):
            run(rb.cmd_backfill_tags, ["--force"])


if __name__ == "__main__":
    unittest.main()
