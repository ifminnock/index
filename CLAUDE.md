# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains two distinct layers:

1. **MFI Site** (`index.html`) — landing page for Meteor Forge Industries / MinnFall Innovations. Marketing/portfolio page with its own design system (Space Mono + Syne fonts, slate/orange palette).

2. **Alaska Geotechnical Tools** — a suite of field reference tools and calculators for geotechnical engineering applications, organized through `tool-index.html`. Pure vanilla HTML/CSS/JavaScript — no build step, no package manager, no external dependencies.

## Development Workflow

There is no build system. To preview locally, serve the root directory with any static file server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. Alternatively, open any `.html` file directly in a browser.

There are no tests, no linting tools, and no CI/CD pipelines.

## Architecture

Each tool is a **single, self-contained `.html` file** with all HTML structure, `<style>` CSS, and `<script>` JS inline. There are no shared CSS files, no shared JS modules, and no component system — styles and logic are intentionally duplicated per file.

**Navigation structure:**
- `index.html` — MFI home / portfolio page (links to tools section and `tool-index.html`)
- `tool-index.html` — primary hub for all Alaska Geotechnical Tools (card grid with amber accent)
- `design-index.html` — secondary hub for design-focused tools (pavement design, subgrade frost, ESAL)

**Back-navigation standard:** Every tool has two links at the top of its header:
- `← Tools` → `tool-index.html`
- `Home` → `index.html`

**Typical tool layout pattern:**
1. Header with back-links (← Tools / Home), title, status badge, and module number
2. Tab navigation bar (where multiple modes exist)
3. Input cards → real-time results sections
4. Footer bar with metadata

**Data flow:** User inputs trigger `onchange` handlers → JS reads DOM values via `getElementById()` → performs calculations → writes results back to DOM via `.textContent` or `.innerHTML`. Page reload resets all state; there is no persistence layer.

**Charts** are rendered using the native Canvas 2D API directly — no charting library.

**Exception:** `geo-agg.html` loads Leaflet.js (v1.9.4) and Leaflet Draw (v1.0.4) from CDN for interactive map functionality.

## Design System Conventions

### Alaska Geo Tools (`tool-index.html` + all tools)
- **Theme:** Dark throughout. CSS variables defined in `:root` per file.
- **Background palette:** `#2E3A47` (main) / `#1A2530` (topbar/header) / `#263240` (card bg)
- **Primary text:** `#E8EAEC`; **Dim text:** `#9AAABB`; **Border:** `#3A4A5C` / `#4A6070`
- **Accent:** `#f0a500` (amber/gold) in `tool-index.html`; individual tools use per-card colors (teal `#2ec4b6`, blue `#4a9eff`, ice `#63b3ed`, violet `#b794f4`, etc.)
- **Fonts:** IBM Plex Mono for headers, labels, computed values; IBM Plex Sans for body text. Both via Google Fonts CDN.
- **Grid texture:** `repeating-linear-gradient` at 40px intervals, ~1.8% opacity
- **Status tags:** `complete` (green `#3dba7e`), `wip` (muted blue-gray), `draft` (amber)
- Layout uses CSS Grid and Flexbox with media queries for mobile breakpoints.

### MFI Site (`index.html`)
- **Fonts:** Space Mono (mono), Syne (display/headers)
- **Palette:** `--slate-deep: #1C2730`, `--slate: #2E3A47`, `--orange: #D4651A`, `--text: #E8EAEC`
- **Features:** Animated hero, scroll-reveal sections, fixed nav with hover dropdown, noise texture overlay

## Tool Files

| File | Purpose |
|------|---------|
| `index.html` | MFI home / portfolio page |
| `tool-index.html` | Alaska Geo Tools primary hub |
| `design-index.html` | Design tools sub-hub |
| `pavement-distress.html` | Distress type identification with field photos |
| `pavement-design.html` | Pavement section design calculator (AKFPD Ch. 4) |
| `soil_rock_guide.html` | Soil & rock field identification guide (~3,400 lines) |
| `esal-calculator.html` | ESAL & traffic calculator with multi-tab interface |
| `references.html` | Standards, specs, and technical references library (~2,945 lines) |
| `subgrade-frost.html` | Subgrade & frost depth evaluation |
| `well-geometry.html` | Interactive boring/well geometry builder with profile canvas |
| `geo-agg.html` | Map-based geotechnical data aggregator (Leaflet.js) |
| `investigation_planning.html` | Drill rig and investigation method selector |
| `thaw_consolidation.html` | CFD-based thaw consolidation model |
| `contact.html` | Contact form |
