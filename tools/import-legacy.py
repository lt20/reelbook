#!/usr/bin/env python3
"""Import sheets from the first, artifact-based "Carnet d'exercices" into work/ folders.

    import-legacy.py <path-to-Training_exercices_book> [work-dir]

Each catalogue entry becomes work/<slug>/{meta.json,index.html,img/}. Then publish with
`rb.py publish work/<slug>`. One-off helper for the original author's data; harmless otherwise.
"""
import json, pathlib, re, shutil, sys

THEME = {"muscu": "strength", "yoga": "yoga", "fight": "fight"}
GROUP = {"Épaules": "Shoulders", "Bras": "Arms", "Abdos": "Abs", "Dos": "Back", "Gainage": "Core", "Hanches": "Hips",
         "Genoux": "Knees", "Jambes": "Legs", "Mobilité": "Mobility", "Séances": "Sessions", "Respiration": "Breathing",
         "Enchaînements": "Flows", "Poings": "Punches", "Pieds & genoux": "Kicks & knees", "Défense": "Defense",
         "Clinch & lutte": "Clinch & grappling", "Déplacements": "Footwork", "Sac & pao": "Bag & pads"}

def main(a):
    if not a: sys.exit(__doc__)
    src = pathlib.Path(a[0]).expanduser(); work = pathlib.Path(a[1] if len(a) > 1 else "work")
    cat = json.loads((src / "catalogue.json").read_text())
    for e in cat["exercices"]:
        slug = e["slug"]; d = work / slug; (d / "img").mkdir(parents=True, exist_ok=True)
        html = (src / "exercices" / f"{slug}.html").read_text()
        body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
        body = re.sub(r"<title>.*?</title>\s*", "", body, flags=re.S)
        body = re.sub(r"<link[^>]*>\s*", "", body)
        body = re.sub(r"<style>.*?</style>\s*", "", body, flags=re.S)
        body = re.sub(r"<nav class=\"top\">.*?</nav>\s*", "", body, flags=re.S)
        body = body.replace(f"../img/{slug}/", "img/")
        body = body.replace('<div class="wrap">\n<header>', '<div class="wrap fiche">\n<header>', 1)
        imgdir = src / "img" / slug
        for f in imgdir.iterdir():
            if f.suffix.lower() in (".jpg", ".jpeg", ".png"): shutil.copy(f, d / "img" / f.name)
        thumb = pathlib.Path(e["vignette"]).name
        meta = {"slug": slug, "kind": "session" if e.get("type") == "seance" else "sheet",
                "theme": THEME.get(e.get("theme", "muscu"), "strength"), "group": GROUP.get(e["groupe"], e["groupe"]),
                "title": e["titre"], "summary": e.get("resume", ""), "duration": e.get("duree", ""), "thumbnail": f"img/{thumb}",
                "source": {"author": e["source"].get("auteur", ""), "url": e["source"].get("url", ""), "platform": e["source"].get("plateforme", "instagram")},
                "exercises": [{"anchor": x["ancre"], "title": x["titre"], "group": GROUP.get(x["groupe"], x["groupe"]), "summary": x.get("resume", ""),
                               "duration": x.get("duree", "30 s"), "thumbnail": f"img/{pathlib.Path(x['vignette']).name}"} for x in e.get("exercices", [])]}
        (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
        (d / "index.html").write_text(body.strip() + "\n")
        print(f"{slug}: {len(list((d / 'img').iterdir()))} image(s)")

if __name__ == "__main__":
    main(sys.argv[1:])
