import os
import io
import sys
import json
import time
import zipfile
import logging
import mimetypes
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image
from tqdm import tqdm

# ----------------- Einstellungen -----------------
API_DE = "https://de.wikipedia.org/w/api.php"
API_EN = "https://en.wikipedia.org/w/api.php"
API_COMMONS = "https://commons.wikimedia.org/w/api.php"

HEADERS = {
    "User-Agent": "ArchiQuizDownloader/1.0 (educational use; contact: example@example.com)"
}

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_JSON = PROJECT_ROOT / "data" / "buildings.json"
IMAGES_DIR = PROJECT_ROOT / "assets" / "images"
ZIP_PATH = PROJECT_ROOT / "archi-quiz-images.zip"
ATTRIB_CSV = PROJECT_ROOT / "assets" / "images_attribution.csv"
FAILED_TXT = PROJECT_ROOT / "assets" / "download_failed.txt"

TARGET_EXT = ".jpg"  # Ziel-Format
MAX_TRIES = 2
TIMEOUT = 20
SLEEP_BETWEEN = 0.5  # höflich bleiben :)

# ----------------- Hilfsfunktionen -----------------
def ensure_dirs():
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    ATTRIB_CSV.parent.mkdir(parents=True, exist_ok=True)

def load_buildings():
    with open(DATA_JSON, "r", encoding="utf-8") as f:
        return json.load(f)

def filename_from_json_path(path_in_json: str) -> str:
    # z.B. "./assets/images/dom-von-pisa.jpg" -> "dom-von-pisa.jpg"
    base = os.path.basename(path_in_json)
    stem, _ = os.path.splitext(base)
    return stem + TARGET_EXT  # wir erzwingen .jpg

def search_wikipedia_page(title_query: str):
    """Suche Seite zuerst auf dewiki, dann enwiki. Gibt (api_base, pageid) zurück oder (None, None)."""
    for api in (API_DE, API_EN):
        try:
            r = requests.get(api, params={
                "action": "query",
                "list": "search",
                "srsearch": title_query,
                "srlimit": 1,
                "format": "json"
            }, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()
            hits = data.get("query", {}).get("search", [])
            if hits:
                return api, hits[0]["pageid"]
        except Exception:
            pass
    return None, None

def get_pageimage(api_base: str, pageid: int):
    """Hole Original-Pageimage (falls vorhanden)."""
    r = requests.get(api_base, params={
        "action": "query",
        "prop": "pageimages",
        "pageids": pageid,
        "piprop": "original",
        "format": "json"
    }, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    pages = data.get("query", {}).get("pages", {})
    page = pages.get(str(pageid), {})
    orig = page.get("original")
    if orig and "source" in orig:
        return orig["source"]
    return None

def get_fileinfo_from_commons(filename: str):
    """Hole Imageinfo (URL + Lizenz/Metadaten) von einer Commons-Datei."""
    r = requests.get(API_COMMONS, params={
        "action": "query",
        "prop": "imageinfo",
        "titles": f"File:{filename}",
        "iiprop": "url|mime|extmetadata",
        "format": "json"
    }, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    pages = data.get("query", {}).get("pages", {})
    for _, page in pages.items():
        ii = page.get("imageinfo", [])
        if ii:
            return ii[0]
    return None

def commons_search_image(term: str):
    """Suche in Commons nach einem passenden Dateinamen und hole dessen fileinfo."""
    # 1) Volltextsuche nach Dateien
    r = requests.get(API_COMMONS, params={
        "action": "query",
        "list": "search",
        "srsearch": term,
        "srnamespace": 6,  # File:
        "srlimit": 1,
        "format": "json"
    }, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    hits = data.get("query", {}).get("search", [])
    if not hits:
        return None
    title = hits[0]["title"]  # z.B. "File:Villa Savoye 01.jpg"
    if title.lower().startswith("file:"):
        title = title[5:]
    return get_fileinfo_from_commons(title)

def ext_from_mime(mime):
    if not mime:
        return None
    guessed = mimetypes.guess_extension(mime)
    return guessed or None

def download_to_jpg(url: str, target_path: Path):
    """Lade Bild, konvertiere zu JPG (RGB), speichere target_path."""
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    content = io.BytesIO(r.content)

    try:
        im = Image.open(content)
        if im.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        im.save(target_path, format="JPEG", quality=90, optimize=True)
        return True
    except Exception as e:
        # Fallback: falls kein Bildformat (selten), schreibe Rohdaten
        with open(target_path, "wb") as f:
            f.write(r.content)
        return True

def write_attrib_row(fh, id_, name, src_url, artist, license_name, license_url):
    def clean(x):
        if x is None:
            return ""
        return str(x).replace("\n", " ").replace("\r", " ").strip()
    fh.write(
        f"{clean(id_)},{clean(name)},{clean(src_url)},{clean(artist)},{clean(license_name)},{clean(license_url)}\n"
    )

def fetch_one(item):
    """Versuchskette je Gebäude: dewiki/enwiki Pageimage -> Commons-Suche"""
    q_terms = [
        item.get("name"),
        f'{item.get("name")} {item.get("architect","")}',
    ]
    # 1) Wikipedia Pageimage
    for q in q_terms:
        if not q:
            continue
        api, pid = search_wikipedia_page(q)
        if api and pid:
            src = get_pageimage(api, pid)
            if src:
                return {"source": "wikipedia", "url": src}
        time.sleep(SLEEP_BETWEEN)
    # 2) Commons (direkte Suche)
    for q in q_terms:
        if not q:
            continue
        info = commons_search_image(q)
        if info and info.get("url"):
            return {"source": "commons", "url": info["url"], "extmeta": info.get("extmetadata")}
        time.sleep(SLEEP_BETWEEN)
    return None

def get_extmetadata_for_url(url, extmeta_hint=None):
    """Wenn möglich, Lizenzdaten aus extmetadata verwenden; sonst leer."""
    em = {}
    if extmeta_hint:
        # extmetadata-Felder sind Objekte mit {value: "..."}
        for key in ("Artist", "LicenseShortName", "LicenseUrl", "Credit"):
            node = extmeta_hint.get(key)
            if node and isinstance(node, dict):
                em[key] = node.get("value", "")
    # Falls leer, heuristisch füllen
    if not em:
        em = {"Artist": "", "LicenseShortName": "", "LicenseUrl": "", "Credit": ""}
    return em

def main():
    ensure_dirs()
    buildings = load_buildings()

    # CSV Kopf
    with open(ATTRIB_CSV, "w", encoding="utf-8") as fh:
        fh.write("id,name,source_url,artist,license,license_url\n")

    failed = []

    for item in tqdm(buildings, desc="Downloading", unit="img"):
        target_name = filename_from_json_path(item.get("image", f"./assets/images/{item['id']}.jpg"))
        target_path = IMAGES_DIR / target_name

        if target_path.exists():
            # schon vorhanden
            continue

        ok = False
        last_info = None

        for attempt in range(1, MAX_TRIES + 1):
            try:
                info = fetch_one(item)
                last_info = info
                if info and info.get("url"):
                    # Download + Konvertierung nach JPG
                    if download_to_jpg(info["url"], target_path):
                        # Attribution sammeln
                        extmeta = get_extmetadata_for_url(info["url"], info.get("extmeta"))
                        with open(ATTRIB_CSV, "a", encoding="utf-8") as fh:
                            write_attrib_row(
                                fh,
                                item.get("id"),
                                item.get("name"),
                                info["url"],
                                extmeta.get("Artist", ""),
                                extmeta.get("LicenseShortName", ""),
                                extmeta.get("LicenseUrl", ""),
                            )
                        ok = True
                        break
            except Exception as e:
                logging.warning(f"{item.get('id')}: attempt {attempt} failed: {e}")
            time.sleep(SLEEP_BETWEEN)

        if not ok:
            failed.append(f"{item.get('id')} | {item.get('name')}")

    # ZIP bauen
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Bilder
        for p in IMAGES_DIR.glob("*.jpg"):
            zf.write(p, p.relative_to(PROJECT_ROOT))
        # Attribution & JSON (praktisch, damit alles beisammen ist)
        if ATTRIB_CSV.exists():
            zf.write(ATTRIB_CSV, ATTRIB_CSV.relative_to(PROJECT_ROOT))
        if DATA_JSON.exists():
            zf.write(DATA_JSON, DATA_JSON.relative_to(PROJECT_ROOT))

    if failed:
        with open(FAILED_TXT, "w", encoding="utf-8") as fh:
            fh.write("\n".join(failed))
        print(f"\nFertig, aber einige Einträge konnten nicht automatisch zugeordnet werden ({len(failed)}).")
        print(f"Siehe: {FAILED_TXT}")
    else:
        print("\nFertig ohne Ausfälle.")

    print(f"ZIP erstellt: {ZIP_PATH}")

if __name__ == "__main__":
    main()
