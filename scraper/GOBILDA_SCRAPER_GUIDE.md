# GoBILDA Scraper Guide

Complete reference for running the GoBILDA inventory scraper with all available commands and environment variables.

## Quick Start

Run the scraper with all defaults:
```bash
npm run gobilda:run
```

This will:
- ✅ Start from scratch (reset any existing checkpoint)
- ✅ Show browser windows (headful mode)
- ✅ Use 20 concurrent workers
- ✅ Use slow/conservative timeouts for slow WiFi
- ✅ Scrape all 2344+ products from the GoBILDA sitemap
- ✅ Extract STEP files organized by product SKU
- ✅ Generate XML inventory and UPC-SKU CSV chart

---

## Environment Variables

### Checkpoint & Resume Control

#### `GOBILDA_RESUME_CHECKPOINT=1`
Resume from the last saved checkpoint instead of starting fresh.
```bash
GOBILDA_RESUME_CHECKPOINT=1 npm run gobilda:run
```

**Default:** Off (always starts fresh)

**What it does:**
- Loads `Results/robotics/GoBilda/gobilda_checkpoint.json`
- Skips already-processed URLs
- Resumes from where the last run left off

**Example scenario:** Your run was interrupted at 920/2344 products. Use this to continue from 920 without restarting.

---

### Concurrency Control

#### `GOBILDA_CONCURRENCY=<number>`
Set the number of parallel workers (browser tabs/pages).
```bash
GOBILDA_CONCURRENCY=10 npm run gobilda:run
GOBILDA_CONCURRENCY=50 npm run gobilda:run
```

**Default:** 20

**Valid range:** 1–50

**What it does:**
- Controls how many products scrape in parallel
- More workers = faster (but higher CPU/memory and network load)
- Fewer workers = slower (but more stable on slow connections)

**Recommendations:**
- Fast connection, modern CPU: 30–50
- Slow WiFi or old machine: 5–10
- Default 20: Good balance for most setups

**Example:**
```bash
# Slow WiFi, conservative
GOBILDA_CONCURRENCY=5 npm run gobilda:run

# Fast connection, aggressive
GOBILDA_CONCURRENCY=40 npm run gobilda:run
```

---

### Timeout & Delay Control

#### `GOBILDA_PAGE_TIMEOUT_MS=<milliseconds>`
How long to wait for a single page to load (navigation timeout).

**Default:** 120000 (120 seconds)

```bash
GOBILDA_PAGE_TIMEOUT_MS=60000 npm run gobilda:run   # 60 sec (faster, might fail)
GOBILDA_PAGE_TIMEOUT_MS=180000 npm run gobilda:run  # 180 sec (slower, more reliable)
```

#### `GOBILDA_NETWORK_SETTLE_MS=<milliseconds>`
How long to wait after page load for network requests to settle.

**Default:** 500 (0.5 seconds)

```bash
GOBILDA_NETWORK_SETTLE_MS=1000 npm run gobilda:run  # Wait longer for async data
```

#### `GOBILDA_PRODUCT_DELAY_MIN_MS=<milliseconds>` and `GOBILDA_PRODUCT_DELAY_MAX_MS=<milliseconds>`
Random delay between products (to avoid hammering the server).

**Defaults:** 200–800ms

```bash
GOBILDA_PRODUCT_DELAY_MIN_MS=100 GOBILDA_PRODUCT_DELAY_MAX_MS=500 npm run gobilda:run
```

#### `GOBILDA_GOTO_RETRY_ATTEMPTS=<number>`
How many times to retry a failed navigation before giving up.

**Default:** 5

```bash
GOBILDA_GOTO_RETRY_ATTEMPTS=3 npm run gobilda:run
```

#### `GOBILDA_GOTO_RETRY_BASE_DELAY_MS=<milliseconds>`
Base delay between retry attempts (multiplied by attempt number).

**Default:** 400

```bash
GOBILDA_GOTO_RETRY_BASE_DELAY_MS=200 npm run gobilda:run
```

#### `GOBILDA_PRODUCT_SCRAPE_TIMEOUT_MS=<milliseconds>`
Hard timeout for scraping one entire product (all retries included).

**Default:** 180000 (180 seconds / 3 minutes)

If a product takes longer than this, it's marked as failed and the worker moves on.

```bash
GOBILDA_PRODUCT_SCRAPE_TIMEOUT_MS=120000 npm run gobilda:run  # 2 min per product
```

---

### Display & Debug

#### `PUPPETEER_HEADLESS=true`
Run in headless mode (no browser windows visible).

**Default:** Off (headful mode enabled, windows visible)

```bash
PUPPETEER_HEADLESS=true npm run gobilda:run
```

**Use when:**
- Running on a server/CI without a display
- You don't need to see worker tabs
- Saves GPU memory

#### `PUPPETEER_SLOWMO=<milliseconds>`
Slow down all Puppeteer actions by N ms (for debugging).

**Default:** 0 (no slow-mo)

```bash
PUPPETEER_SLOWMO=500 npm run gobilda:run  # Pause 500ms between actions
```

---

### Limiting & Testing

#### `GOBILDA_LIMIT=<number>`
Only scrape the first N products (for testing).

**Default:** 0 (no limit, scrape all)

```bash
GOBILDA_LIMIT=10 npm run gobilda:run    # Only scrape first 10
GOBILDA_LIMIT=100 npm run gobilda:run   # Test with first 100
```

#### `GOBILDA_ENABLE_NETWORK_UPC_FALLBACK=0`
Disable the network fallback for UPC extraction (faster, less reliable).

**Default:** 1 (enabled)

```bash
GOBILDA_ENABLE_NETWORK_UPC_FALLBACK=0 npm run gobilda:run
```

---

## Common Scenarios

### Scenario 1: Fast test with first 50 products

```bash
GOBILDA_LIMIT=50 GOBILDA_CONCURRENCY=20 npm run gobilda:run
```

### Scenario 2: Resume after interruption (same settings as before)

```bash
GOBILDA_RESUME_CHECKPOINT=1 npm run gobilda:run
```

### Scenario 3: Slow WiFi, conservative settings

```bash
GOBILDA_CONCURRENCY=5 \
  GOBILDA_PAGE_TIMEOUT_MS=180000 \
  GOBILDA_PRODUCT_SCRAPE_TIMEOUT_MS=240000 \
  npm run gobilda:run
```

### Scenario 4: Fast connection, aggressive speed

```bash
GOBILDA_CONCURRENCY=40 \
  GOBILDA_PAGE_TIMEOUT_MS=60000 \
  GOBILDA_PRODUCT_DELAY_MIN_MS=50 \
  GOBILDA_PRODUCT_DELAY_MAX_MS=300 \
  npm run gobilda:run
```

### Scenario 5: Run headless on a server

```bash
PUPPETEER_HEADLESS=true npm run gobilda:run
```

### Scenario 6: Debug a specific failure with full visibility

```bash
GOBILDA_LIMIT=5 \
  PUPPETEER_SLOWMO=200 \
  npm run gobilda:run
```

---

## Output Files

After a successful run, you'll find:

```
Results/robotics/GoBilda/
├── YYYY-MM-DD_HH-MM-SS_gobilda_inventory.xml
│   └── SKU-centric XML inventory with all product metadata
├── YYYY-MM-DD_HH-MM-SS_gobilda_upc_sku_chart.csv
│   └── UPC-to-SKU cross-reference chart
├── YYYY-MM-DD_HH-MM-SS_gobilda/
│   ├── step-files/
│   │   ├── <SKU1>/
│   │   │   ├── file1.stp
│   │   │   └── file2.pdf
│   │   ├── <SKU2>/
│   │   │   └── file3.stp
│   │   └── ...
│   └── ...
└── gobilda_checkpoint.json
    └── Resume state (processed URLs, failed URLs, successful products)
```

---

## What Each Component Does

### Product Discovery
Fetches the GoBILDA XML sitemap and discovers all 2344+ product URLs.

### Product Scraping
For each URL in parallel (using N workers):
1. Navigate to the product page
2. Extract title, SKU, brand, price, availability, images, specs
3. Search for UPC/GTIN codes (DOM, hidden fields, meta tags, JSON-LD, inline scripts)
4. Collect download links (PDF, ZIP/STEP files)
5. Optionally scan network responses for additional UPC hints (fallback)
6. Store all data in memory
7. Cool down (random delay) before next product
8. Save checkpoint every 20 products

### STEP File Processing
After scraping:
1. Collect all ZIP files flagged as STEP bundles
2. Download each to temp directory
3. Extract ZIP contents
4. Organize extracted files by product SKU into `step-files/<SKU>/`
5. Dedupe identical files (by content hash)
6. Track retention policy (100MB single-file limit, 2GB total threshold)
7. Generate statistics
8. Cleanup temp files

### Output Generation
1. Build SKU-centric XML with all metadata
2. Build UPC-SKU mapping CSV
3. Write checkpoint for resume capability

---

## Troubleshooting

### Run stops at a fixed count (e.g., 920/2344)

**Cause:** A pathological product page is hanging a worker.

**Solution:**
- Hard timeout now kills hangs after 3 minutes per product
- Worker recycles page after failure
- Try lower concurrency: `GOBILDA_CONCURRENCY=5`
- Or extend timeout: `GOBILDA_PRODUCT_SCRAPE_TIMEOUT_MS=300000`

### High memory usage

**Cause:** Too many concurrent workers.

**Solution:** Reduce concurrency:
```bash
GOBILDA_CONCURRENCY=10 npm run gobilda:run
```

### Frequent network failures

**Cause:** WiFi is dropping or too aggressive timing.

**Solution:**
```bash
GOBILDA_CONCURRENCY=5 \
  GOBILDA_PAGE_TIMEOUT_MS=180000 \
  GOBILDA_PRODUCT_DELAY_MIN_MS=500 \
  GOBILDA_PRODUCT_DELAY_MAX_MS=1500 \
  npm run gobilda:run
```

### Missing STEP files in output

**Cause:** Download failed, extraction failed, or size threshold exceeded.

**Info:** Check the console output for `STEP extraction failures` count.

---

## Environment Variables Summary Table

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `GOBILDA_RESUME_CHECKPOINT` | `0` | bool | Resume from checkpoint vs start fresh |
| `GOBILDA_CONCURRENCY` | `20` | 1–50 | Parallel workers |
| `GOBILDA_PAGE_TIMEOUT_MS` | `120000` | ms | Navigation timeout |
| `GOBILDA_NETWORK_SETTLE_MS` | `500` | ms | Network settle time |
| `GOBILDA_PRODUCT_DELAY_MIN_MS` | `200` | ms | Min delay between products |
| `GOBILDA_PRODUCT_DELAY_MAX_MS` | `800` | ms | Max delay between products |
| `GOBILDA_GOTO_RETRY_ATTEMPTS` | `5` | count | Retry attempts per nav |
| `GOBILDA_GOTO_RETRY_BASE_DELAY_MS` | `400` | ms | Base retry delay |
| `GOBILDA_PRODUCT_SCRAPE_TIMEOUT_MS` | `180000` | ms | Hard product scrape timeout |
| `GOBILDA_LIMIT` | `0` | count | Limit to first N products (0 = all) |
| `GOBILDA_ENABLE_NETWORK_UPC_FALLBACK` | `1` | bool | Enable network fallback for UPC |
| `PUPPETEER_HEADLESS` | `false` | bool | Headless mode |
| `PUPPETEER_SLOWMO` | `0` | ms | Slow down actions (debug) |

---

## Tips & Best Practices

1. **Start with defaults** (`npm run gobilda:run`) unless you know your network is problematic.

2. **Use `GOBILDA_LIMIT`** when testing changes (faster feedback).

3. **Monitor the first run** with visible windows to see worker activity:
   - Each browser tab shows current status
   - Watch for one tab stuck longer than others = problem product

4. **On slow WiFi**, lower concurrency and raise timeouts:
   ```bash
   GOBILDA_CONCURRENCY=3 GOBILDA_PAGE_TIMEOUT_MS=240000 npm run gobilda:run
   ```

5. **Checkpoint resumes are safe** — processed URLs are never scraped twice even on resume.

6. **Combined settings** are most effective. Example for very poor network:
   ```bash
   GOBILDA_CONCURRENCY=2 \
     GOBILDA_PAGE_TIMEOUT_MS=240000 \
     GOBILDA_PRODUCT_DELAY_MIN_MS=1000 \
     GOBILDA_PRODUCT_DELAY_MAX_MS=2000 \
     npm run gobilda:run
   ```

7. **Check the checkpoint** to see progress:
   ```bash
   cat Results/robotics/GoBilda/gobilda_checkpoint.json | jq '.processedUrls | length'
   ```

---

## Still Have Questions?

Check the test file for the full logic:
- `tests/robotics/GoBilda/gobildaInventoryScraper.test.ts` — Main scraper loop
- `src/gobildaStepPipeline.ts` — STEP file extraction
- `src/puppeteerEnv.ts` — Puppeteer browser & page management
