"""Record whether the public-facing search request returns a usable response."""
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

if __name__ == "__main__":
    keyword = "protein bar"
    endpoint = "https://bff-gateway.zepto.com/user-search-service/api/v3/search"
    request = Request(endpoint, json.dumps({"query": keyword, "pageNumber": 0,
                      "mode": "SHOW_ALL_RESULTS"}).encode(),
                      {"Content-Type": "application/json", "Origin": "https://www.zepto.com"})
    try:
        response = urlopen(request, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        record = {"keyword": keyword, "http_status": response.code,
                  "content_length": response.headers.get("Content-Length"),
                  "waf_action": response.headers.get("x-amzn-waf-action")}
    Path("zepto-probe.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record))

