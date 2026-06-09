from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import json
import mimetypes
import sqlite3


HOST = "127.0.0.1"
PORT = 8765
ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
DB_PATH = DATA_DIR / "jobs.db"
JSONL_PATH = DATA_DIR / "jobs.jsonl"
PUBLIC_DIR = Path(__file__).resolve().parent / "public"
COMPANY_NAME_LABEL = "\u516c\u53f8\u540d\u79f0"
COMPANY_SHORT_NAME_LABEL = "\u516c\u53f8\u7b80\u79f0"


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def ensure_storage():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL DEFAULT 'boss',
                url TEXT NOT NULL UNIQUE,
                title TEXT,
                company TEXT,
                company_short_name TEXT,
                salary TEXT,
                location TEXT,
                job_description TEXT,
                company_intro TEXT,
                business_info TEXT,
                captured_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        ensure_column(conn, "jobs", "company_short_name", "TEXT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_company_short_name ON jobs(company_short_name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs(title)")
        backfill_company_from_business_info(conn)


def ensure_column(conn, table, column, definition):
    columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def backfill_company_from_business_info(conn):
    rows = conn.execute(
        "SELECT id, company, company_short_name, business_info FROM jobs WHERE business_info IS NOT NULL AND business_info != ''"
    ).fetchall()
    for row_id, company, company_short_name, business_info in rows:
        legal_company_name = parse_business_info_value(business_info, COMPANY_NAME_LABEL)
        short_name = parse_business_info_value(business_info, COMPANY_SHORT_NAME_LABEL)
        if legal_company_name and legal_company_name != company:
            conn.execute(
                "UPDATE jobs SET company = ?, updated_at = ? WHERE id = ?",
                (legal_company_name, now_iso(), row_id),
            )
        if short_name and short_name != company_short_name:
            conn.execute(
                "UPDATE jobs SET company_short_name = ?, updated_at = ? WHERE id = ?",
                (short_name, now_iso(), row_id),
            )


def normalize_job(payload):
    url = str(payload.get("url") or "").strip()
    if not url:
        raise ValueError("missing url")

    business_info = str(payload.get("businessInfo") or payload.get("business_info") or "").strip()
    legal_company_name = parse_business_info_value(business_info, COMPANY_NAME_LABEL)
    short_name = (
        str(payload.get("companyShortName") or payload.get("company_short_name") or "").strip()
        or parse_business_info_value(business_info, COMPANY_SHORT_NAME_LABEL)
    )

    return {
        "source": str(payload.get("source") or "boss").strip(),
        "url": url,
        "title": str(payload.get("title") or "").strip(),
        "company": legal_company_name or str(payload.get("company") or "").strip(),
        "company_short_name": short_name,
        "salary": str(payload.get("salary") or "").strip(),
        "location": str(payload.get("location") or "").strip(),
        "job_description": str(payload.get("description") or payload.get("job_description") or "").strip(),
        "company_intro": str(payload.get("companyIntro") or payload.get("company_intro") or "").strip(),
        "business_info": business_info,
        "captured_at": str(payload.get("capturedAt") or payload.get("captured_at") or "").strip(),
    }


def parse_business_info_value(text, label):
    prefix_cn = f"{label}\uff1a"
    prefix_ascii = f"{label}:"
    lines = [raw_line.strip() for raw_line in str(text or "").splitlines() if raw_line.strip()]
    for index, line in enumerate(lines):
        if line == label:
            return lines[index + 1].strip() if index + 1 < len(lines) else ""
        if line.startswith(prefix_cn):
            return line[len(prefix_cn):].strip()
        if line.startswith(prefix_ascii):
            return line[len(prefix_ascii):].strip()
        if line.startswith(label):
            return line[len(label):].strip(" \uff1a:")
    return ""


def save_job(payload):
    ensure_storage()
    job = normalize_job(payload)
    timestamp = now_iso()

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute(
            """
            INSERT INTO jobs (
                source, url, title, company, company_short_name, salary, location,
                job_description, company_intro, business_info,
                captured_at, created_at, updated_at
            )
            VALUES (
                :source, :url, :title, :company, :company_short_name, :salary, :location,
                :job_description, :company_intro, :business_info,
                :captured_at, :created_at, :updated_at
            )
            ON CONFLICT(url) DO UPDATE SET
                source=excluded.source,
                title=excluded.title,
                company=excluded.company,
                company_short_name=excluded.company_short_name,
                salary=excluded.salary,
                location=excluded.location,
                job_description=excluded.job_description,
                company_intro=excluded.company_intro,
                business_info=excluded.business_info,
                captured_at=excluded.captured_at,
                updated_at=excluded.updated_at
            """,
            {**job, "created_at": timestamp, "updated_at": timestamp},
        )
        row = conn.execute("SELECT * FROM jobs WHERE url = ?", (job["url"],)).fetchone()

    record = dict(row)
    with JSONL_PATH.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")

    return record


def list_jobs():
    ensure_storage()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM jobs ORDER BY updated_at DESC, id DESC").fetchall()
    return [dict(row) for row in rows]


def read_public_file(path):
    if path == "/":
        target = PUBLIC_DIR / "index.html"
    else:
        relative = unquote(path).lstrip("/")
        target = PUBLIC_DIR / relative

    resolved = target.resolve()
    if not str(resolved).startswith(str(PUBLIC_DIR.resolve())) or not resolved.is_file():
        return None, None

    content_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
    if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
        content_type = f"{content_type}; charset=utf-8"
    return resolved.read_bytes(), content_type


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print("[%s] %s" % (self.log_date_time_string(), format % args))

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/jobs":
            self.send_json(200, {"ok": True, "jobs": list_jobs()})
            return
        if path == "/health":
            self.send_json(200, {"ok": True, "db": str(DB_PATH), "jsonl": str(JSONL_PATH)})
            return

        body, content_type = read_public_file(path)
        if body is not None:
            self.send_static(200, body, content_type)
            return

        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/jobs":
            self.send_json(404, {"ok": False, "error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            record = save_job(payload)
            self.send_json(200, {"ok": True, "job": record})
        except Exception as error:
            self.send_json(400, {"ok": False, "error": str(error)})


def main():
    ensure_storage()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"JD local service running at http://{HOST}:{PORT}")
    print(f"SQLite: {DB_PATH}")
    print(f"JSONL:  {JSONL_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
