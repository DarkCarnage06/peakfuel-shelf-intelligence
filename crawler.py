import argparse
from concurrent.futures import ThreadPoolExecutor
from itertools import product
from datetime import date, timedelta
import json
from pathlib import Path
import sqlite3
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

DAYS = [(date(2026, 11, 1) + timedelta(days=i)).isoformat() for i in range(14)]
DB = "quickshelf.db"


def connect(path):
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, data TEXT);
        CREATE TABLE IF NOT EXISTS pages (
            day TEXT, store TEXT, keyword TEXT, page INTEGER, data TEXT,
            PRIMARY KEY(day, store, keyword, page));
        CREATE TABLE IF NOT EXISTS gaps (
            day TEXT, store TEXT, keyword TEXT, page INTEGER, reason TEXT,
            PRIMARY KEY(day, store, keyword, page));
    """)
    return db


def validate(doc, day, store, keyword, page, total):
    if tuple(doc.get(k) for k in ("day", "store_id", "keyword", "page")) != (day, store, keyword, page):
        raise ValueError("response identity mismatch")
    n = doc.get("total")
    if type(n) is not int or not 0 <= n <= 24 or (total is not None and total != n):
        raise ValueError("missing or inconsistent total")
    start = (page - 1) * 8
    rows = doc["results"]
    if doc.get("has_next") is not (page * 8 < n):
        raise ValueError("inconsistent pagination")
    if [r["position"] for r in rows] != list(range(start + 1, min(start + 8, n) + 1)):
        raise ValueError("incomplete or unordered positions")
    ids = set()
    for row in rows:
        if not all(isinstance(row[k], str) and row[k] for k in ("brand", "title", "product_id")):
            raise ValueError("missing product identity")
        if row["product_id"] in ids or any(type(row[k]) is not bool for k in ("in_stock", "sponsored")):
            raise ValueError("duplicate product or invalid flags")
        if not all(type(row[k]) in (int, float) and row[k] >= 0 for k in ("price", "mrp")):
            raise ValueError("invalid price")
        ids.add(row["product_id"])
    return doc


class Client:
    def __init__(self, url):
        self.url = url.rstrip("/")
        self.lock = threading.Lock()
        self.next_request = 0

    def get(self, path, params=None, check=lambda data: data):
        url = self.url + path + ("?" + urlencode(params) if params else "")
        for attempt in range(3):
            with self.lock:
                time.sleep(max(0, self.next_request - time.monotonic()))
                self.next_request = time.monotonic() + 0.105
            try:
                with urlopen(url, timeout=2) as response:
                    return check(json.load(response))
            except HTTPError as error:
                reason = f"HTTP {error.code}"
                if error.code == 429:
                    hint = error.headers.get("Retry-After", "1")
                    delay = int(hint) if hint.isdecimal() else 1
                    with self.lock:
                        self.next_request = max(self.next_request, time.monotonic() + delay)
                elif error.code < 500:
                    break
            except (URLError, TimeoutError, ValueError, KeyError, TypeError, AttributeError) as error:
                reason = "timeout" if isinstance(error, TimeoutError) else str(error)
            if attempt < 2:
                time.sleep(0.12 * 2 ** attempt)
        raise RuntimeError(reason)


def crawl(path, url):
    db = connect(path)
    client = Client(url)
    stores = client.get("/v1/stores")["stores"]
    keywords = client.get("/v1/keywords")["keywords"]
    with db:
        db.executemany("REPLACE INTO metadata VALUES (?,?)",
                       [(k, json.dumps(v)) for k, v in [("stores", stores), ("keywords", keywords)]])
    jobs = list(product(DAYS, [s["store_id"] for s in stores], [k["keyword"] for k in keywords]))
    known = {tuple(row[:4]): json.loads(row[4]) for row in db.execute("SELECT * FROM pages")}
    def fetch(job):
        day, store, keyword = job
        total = None
        ids = set()
        for page in range(1, 4):
            key = (*job, page)
            try:
                doc = known.get(key)
                if doc is None:
                    params = dict(day=day, store=store, keyword=keyword, page=page)
                    def check(data):
                        validate(data, day, store, keyword, page, total)
                        if ids.intersection(r["product_id"] for r in data["results"]):
                            raise ValueError("duplicate across pages")
                        return data
                    doc = client.get("/v1/search", params, check)
                    yield key, doc, None
            except RuntimeError as error:
                yield key, None, str(error)
                return
            total = doc["total"]
            ids.update(r["product_id"] for r in doc["results"])
            if not doc["has_next"]:
                return

    def work(job):
        for key, doc, error in fetch(job):
            with write_lock:
                with writer:
                    if error:
                        writer.execute("REPLACE INTO gaps VALUES (?,?,?,?,?)", (*key, error))
                    else:
                        writer.execute("INSERT OR IGNORE INTO pages VALUES (?,?,?,?,?)", (*key, json.dumps(doc)))
                        writer.execute("DELETE FROM gaps WHERE day=? AND store=? AND keyword=? AND page=?", key)

    write_lock = threading.Lock()
    writer = sqlite3.connect(path, check_same_thread=False)
    try:
        with ThreadPoolExecutor(max_workers=16) as pool:
            list(pool.map(work, jobs))
        print(f"{len(jobs)} planned searches, {db.execute('SELECT count(*) FROM pages').fetchone()[0]} accepted pages, "
              f"{db.execute('SELECT count(*) FROM gaps').fetchone()[0]} outstanding gaps")
    finally:
        writer.close()
        db.close()


def snapshot(path):
    db = connect(path)
    with db:
        db.execute("BEGIN")
        meta = {key: json.loads(value) for key, value in db.execute("SELECT * FROM metadata")}
        stores = {s["store_id"]: s for s in meta["stores"]}
        words = {k["keyword"]: k["monthly_searches"] for k in meta["keywords"]}
        jobs = {key: {"seen": set(), "total": None, "top": {}, "stock": {}}
                for key in product(DAYS, stores, words)}
        for day, store, word, page, data in db.execute("SELECT * FROM pages ORDER BY page"):
            doc = json.loads(data)
            job = jobs[(day, store, word)]
            job["seen"].add(page)
            job["total"] = doc["total"]
            for r in doc["results"]:
                if page == 1:
                    count = job["top"].setdefault(r["brand"], [0, 0, 0, 0])
                    count[int(r["sponsored"])] += 1
                    count[2 + int(r["sponsored"])] += int(r["in_stock"])
                if r["brand"] == "Peakfuel":
                    job["stock"][r["product_id"]] = [r["title"], r["in_stock"]]
        gaps = [list(row) for row in db.execute("SELECT * FROM gaps ORDER BY day, store, keyword, page")]
    db.close()
    rows = []
    for (day, store, word), job in jobs.items():
        total = job["total"]
        full = total is not None and len(job["seen"]) == max(1, (total + 7) // 8)
        rows.append([day, store, word, min(8, total) if 1 in job["seen"] else None,
                     job["top"], full, job["stock"]])
    return dict(stores=stores, words=words, days=DAYS, rows=rows, gaps=gaps)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["crawl", "export"])
    parser.add_argument("--db", default=DB)
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    args = parser.parse_args()
    if args.command == "crawl":
        crawl(args.db, args.url)
    else:
        Path("docs/snapshot.json").write_text(json.dumps(snapshot(args.db), separators=(",", ":")), encoding="utf-8")


