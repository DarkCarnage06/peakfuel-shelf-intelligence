import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
INTENTS = {"visibility", "competitors", "stock", "coverage", "unsupported"}


def plan(question, key):
    with (ROOT / "docs/snapshot.json").open(encoding="utf-8") as file:
        data = json.load(file)
    markets = sorted({s[field] for s in data["stores"].values()
                      for field in ("city", "name", "store_id")})
    schema = {"type": "object", "additionalProperties": False,
              "properties": {
                  "intent": {"type": "string", "enum": sorted(INTENTS)},
                  "word": {"type": ["string", "null"], "enum": [None, "All keywords", *data["words"]]},
                  "market": {"type": ["string", "null"], "enum": [None, "All markets", *markets]},
                  "end": {"type": ["string", "null"], "enum": [None, *data["days"]]},
                  "brand": {"type": ["string", "null"], "enum": [None, "Brawn", "Nutrova", "Grainly", "Cocobloom", "FitFolk"]},
                  "window": {"type": ["integer", "null"], "enum": [None, 1, 7, 14]},
              }, "required": ["intent", "word", "market", "end", "window", "brand"]}
    payload = {
        "model": os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
        "store": False,
        "instructions": (
            "Classify a QuickShelf brand analytics question as a read-only query. "
            "Set scope fields to null unless explicitly requested. Let the local parser handle relative dates. "
            "Classify other domains, unsupported dimensions, untracked keywords/locations and dates outside "
            "the supplied enum as unsupported. Visibility means first-screen share. Do not answer the question."
        ),
        "input": question,
        "text": {"format": {"type": "json_schema", "name": "plan", "strict": True, "schema": schema}},
        "max_output_tokens": 240,
    }
    request = Request("https://api.openai.com/v1/responses", json.dumps(payload).encode(),
                      {"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urlopen(request, timeout=10) as response:
        result = json.load(response)
    parsed = next(json.loads(content["text"]) for entry in result["output"]
                  for content in entry.get("content", []) if content["type"] == "output_text")
    return {k: v for k, v in parsed.items() if k in schema["properties"] and v is not None
            and v in schema["properties"][k]["enum"]}


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/plan":
            self.send_error(404)
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415, "Expected application/json")
            return
        key = os.getenv("OPENAI_API_KEY")
        if not key:
            self.send_error(503, "Model key unavailable")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 4000:
                raise ValueError("invalid request size")
            question = json.loads(self.rfile.read(length))["question"]
            if not isinstance(question, str) or not 0 < len(question.strip()) <= 500:
                raise ValueError("invalid question")
        except (ValueError, KeyError, TypeError):
            self.send_error(400, "Invalid question")
            return
        try:
            body = json.dumps({"plan": plan(question, key)}).encode()
        except (OSError, ValueError, KeyError, TypeError, StopIteration):
            self.send_error(502, "Model unavailable")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print("Peakfuel dashboard at http://127.0.0.1:8000", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8000), partial(Handler, directory=ROOT / "docs")).serve_forever()


