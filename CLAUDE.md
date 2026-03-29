# The Daily Brief

> Daily news briefing site at thedailybrief.co.uk

---

## VETOES — NEVER REINTRODUCE

These features have been deliberately removed. Reintroducing any of them is a hard failure.

- **No UK statistics/economic indicators bar** (`refFiguresBar`) — no Base Rate, CPI, Unemployment, GDP below the markets ticker
- **No search feature** — search button, overlay, CSS, keyboard shortcut all removed
- **No per-edition market strips** — no FTSE/Brent/GBP/Gold mini-bars below individual briefing headers
- **No premature editions** — only add editions Ed explicitly requests

---

## Tech Stack

- Static HTML/CSS/JS (no build step)
- Google Fonts: Playfair Display + Inter
- Service worker for offline/caching
- Hosted on GitHub Pages

## Repos

- `dickinsone14-dev/ed-news-briefing` (origin)
- `thedailybrief-uk/thedailybrief-uk.github.io` (org)
- Push to both: `git push origin main && git push org main`

## Commands

No build step. Edit HTML files and push.

```bash
# Deploy
git push origin main && git push org main
```

---

## Critical Rules

- **7 FULL DAYS of past editions** must be visible on the site at all times. NEVER delete editions less than 7 days old. This has been broken multiple times and is unacceptable.
- **Bump service worker cache version** when adding new files
- **British English** throughout all user-facing copy
- **Never commit files not changed in the current session** — run `git diff <file>` on every file before staging
- **When Ed corrects or vetoes anything**, save it as a feedback memory immediately

---

## Instagram Workflow

### Daily Carousels (update at 6:15 PM, after evening briefing)

- `instagram-geo.html` — geopolitical, burgundy theme
- `instagram-uk.html` — UK domestic, navy theme
- Top 5 **stories** (not "headlines") of the entire day — both morning and evening editions combined
- 1080x1350px (4:5), absolute-positioned layout

### Weekly Roundup

- `instagram-weekly.html` — teal theme
- Sunday before midday
- Structure: Moved Forward (green) / Stalled (amber) / Watch Next Week (teal)
- Uses `weekly-news-log.md` accumulated through the week

### PMQs

- `instagram-pmqs.html` — deep purple theme (`#663399`)
- After PMQs each Wednesday

### Breaking News

- `instagram-story.html` — 9:16 format (1080x1920px)
- 3-hour rotation; 8-hour max display
- Export PNG to Desktop for AirDrop

---

## Unsplash Rules

- **Never guess photo IDs** — Unsplash CDN IDs (`photo-XXXXX`) don't describe content
- **Always verify via slug**: search `site:unsplash.com/photos "description"`, get slug URL, then curl to extract CDN ID
- **No duplicates** across any Instagram HTML files
- **Never reuse** images from previous days
- **Verify HTTP 200** before applying any image URL
- Every slide must have a relevant, contemporary, high-resolution background photo at 8% opacity

---

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Main site — all editions in `#all-editions` container |
| `instagram-geo.html` | Geopolitical carousel |
| `instagram-uk.html` | UK domestic carousel |
| `instagram-weekly.html` | Weekly roundup carousel |
| `instagram-pmqs.html` | PMQs carousel |
| `instagram-story.html` | Breaking news story (9:16) |
| `weekly-news-log.md` | Accumulates daily stories for Sunday roundup |
| `export-slides.js` | Carousel PNG export |
| `export-story.html` | Story PNG export |
| `sw.js` | Service worker |

---

## Design Conventions

- Left-aligned text, vertically centred on slides
- Consistent element positions across all slides (headers same spot, footers same spot)
- Thin line separators, not card gaps
- Full summaries visible (no truncation)
- Monochrome + accent colour per theme
- Dive Deeper sections: 150-200 words of analytical commentary with historical context, data points, and forward-looking indicators
