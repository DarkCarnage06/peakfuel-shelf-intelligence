# Part 1 · Zepto capture status

Planned brand: The Whole Truth. The brief calls for results from all brands in each of 30 search contexts, retaining rank so The Whole Truth's placements can be identified.

I sent a read-only JSON search probe for protein bar to Zepto's web search endpoint. The response was HTTP 202 with an empty body and an AWS WAF challenge. That response cannot establish any ranks, prices, delivery-store identity, stock, or ad attribution. Live collection stopped at that point. Zepto's [official MCP](https://github.com/zeptonow/mcp) offers authenticated product search, but I could not verify that its output preserves the storefront's exact order and sponsorship indicators across the three addresses.

The captured response metadata is in `zepto-probe.json`. `zepto.csv` contains the requested schema and zero observations. Completeness is 0/30. The QuickShelf snapshot is synthetic and belongs to Part 2.

With a Zepto-approved search interface, I would resolve each exact delivery address to its serving store, preserve the selected location and session for all ten keywords, and validate returned store IDs, page order, and sponsored flags before publishing the CSV. I would sample against the storefront at the selected address, record capture time in UTC, and leave unavailable inventory-unit fields blank. I would record throttling separately and honor Retry-After when provided.

