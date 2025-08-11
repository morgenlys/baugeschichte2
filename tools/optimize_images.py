# tools/optimize_images.py
# Verkleinert alle Bilder unter assets/images/ auf max 1600px Kante,
# konvertiert zu JPEG, entfernt EXIF, Qualitätsstufe 72, progressiv.

import os
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMG_DIR = ROOT / "assets" / "images"
TARGET_MAX = 1600     # max Breite/Höhe in px
QUALITY = 72

def process(path: Path):
    try:
        im = Image.open(path)
        im = im.convert("RGB")
        w, h = im.size
        scale = min(TARGET_MAX / w, TARGET_MAX / h, 1.0)
        if scale < 1.0:
            im = im.resize((int(w*scale), int(h*scale)), Image.LANCZOS)

        # überschreibe als JPEG
        out = path.with_suffix(".jpg")
        im.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        if out != path:
            # alte Datei löschen, wenn Endung anders war (z.B. .png)
            try: path.unlink()
            except: pass
        print("OK:", out.name)
    except Exception as e:
        print("SKIP:", path.name, "-", e)

def main():
    if not IMG_DIR.exists():
        print("Kein assets/images/ Ordner gefunden.")
        return
    for p in IMG_DIR.iterdir():
        if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            process(p)

if __name__ == "__main__":
    main()
