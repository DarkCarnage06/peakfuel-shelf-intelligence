# Peakfuel Shelf Intelligence

Peakfuel search visibility and stock monitoring for the supplied QuickShelf simulation. [Open the GitHub Pages dashboard](https://darkcarnage06.github.io/peakfuel-shelf-intelligence/).

**Submission status.** Part 2 includes a runnable crawler, SQLite storage, validation, dashboard, and data-grounded ask-box. Part 1 stopped at the live Zepto gateway challenge and contains zero live Zepto rows. See [capture notes](PART1.md) and the [AI chat log](AI-CHAT.md).

## Run

Python 3.10+ is sufficient. The committed snapshot lets the dashboard start immediately.

```sh
python serve.py
```

Open `http://127.0.0.1:8000`. In the local server environment, set `OPENAI_API_KEY` to enable AI query interpretation. `OPENAI_MODEL` defaults to `gpt-4.1-mini`. The hosted GitHub Pages copy and a local server without a key use the deterministic query parser. Both paths use the same calculations. The key stays server-side.

To regenerate the snapshot, place Jai's original `quickshelf_mock.py` in the project directory. Start it in one terminal, then run the next two commands in another terminal.

```sh
python quickshelf_mock.py
python crawler.py crawl
python crawler.py export
```

The crawler derives its job matrix from store and keyword metadata and the 14 documented dates. Retry `crawl` with the same `--db` after stopping the process. Each page commits independently, so completed pages are reused and failed pages are retried. Set `--url` if the mock runs on another local port. To start from scratch, use a fresh database path and pass it to both commands. The original mock is supplied by the evaluation folder.

```sh
python -m unittest -v
node --test test_metrics.js
```

## Measurement and data quality

- The request budget is shared by workers. Requests time out after two seconds and retry transient HTTP failures and bad response envelopes up to three times. A 429 delays all workers using Retry-After.
- Page validation checks the requested identity, total, page length, contiguous positions, pagination flag, product identity and typed flags. A response for a different store is quarantined. A well-formed total of zero is a measured empty search. An empty envelope with no total is invalid. The dashboard uses valid first pages even where deeper pages failed and shows the full-pagination count separately.
- Two same-city store records with exactly the same coordinates and at least 12 identical nonempty first pages, with no conflicting overlap, are treated as likely duplicate listings. The first store ID is the stable reporting key. The crawler keeps both raw records. The dashboard lists the evidence and excludes the duplicate from rollups. Confirm with the provider before treating the mapping as authoritative.
- Each first-screen slot contributes its keyword's monthly search volume. Organic and sponsored shares use the same measured-slot denominator and represent earned and paid presence. In-stock share applies the same denominator to slots where Peakfuel was observed in stock. Missing first pages contribute neither counts nor weights. A scope with zero measured slots has an unavailable share. Day-on-day changes use the intersection of measured store/keyword pairs. Without store-specific traffic weights, stores are weighted equally within each keyword.
- Stock aggregates observed Peakfuel product/store/day values across keywords and pages. Contradictions are shown separately. There is no inventory feed, so a product absent from retrieval has unknown availability. A ranking move alone cannot prove a cause.
- The ask-box turns the question into a constrained filter and intent. It performs arithmetic over the same snapshot as the dashboard and shows scope and coverage with its answers. Tests independently specify expected weighted shares, paired deltas, responses to unsupported queries, and conflicting stock behavior. There is no arbitrary SQL or model-generated arithmetic. The no-key path covers common intents and relative time phrases. The provider-backed route requires a valid reviewer key for a live test.

## Verified crawl

The crawler was forcibly stopped after 2,861 pages. SQLite passed its integrity check and the restarted process reused its checkpoints. The final snapshot contains 5,602 accepted pages across 2,016 planned raw searches. After accounting for the duplicate store, all 1,848 reporting searches have a verified first screen, including 70 verified empty searches. Persistent upstream HTTP 502 errors prevented full pagination for 55 searches.

For the prompt “How did we do on protein bar this week?”, an independent tally of stored first pages for November 8–14 reproduced the ask-box's 26.8% organic and 0.6% sponsored first-screen shares. It found 77 of 77 first screens and 72 of 77 fully paginated searches.

## What I would change for nightly operation

At 40 stores × 150 keywords × 4 daily snapshots there are 24,000 search contexts and up to 72,000 page requests per day before retries. At 12 requests per second the theoretical maximum-page crawl consumes about 100 minutes. Add a snapshot timestamp to the job key, use a persistent queue and leased work items, enforce the provider quota across workers, spread the four snapshots by location, and store immutable raw responses with partitioned normalized tables. Track per-store/page coverage, identity drift, latency, age, and retry budgets. Publish atomic snapshots against a coverage target and alert separately on repeated structural failures. Reconcile location mapping with the provider before assigning a moved store's data.

This version uses SQLite and a static artifact for reproducibility. It omits orchestration, inventory unit estimates, authenticated multi-user hosting, and a hosted model endpoint. During review of the AI implementation I retained valid page-one measurements when page two fails, excluded mismatched store responses, and treated model output as a query plan. A single all-pages quality gate or model-authored percentages would obscure usable measurements or make the report harder to verify. These are implementation choices made by Codex.


