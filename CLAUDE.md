# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alaska Geotechnical Tools is a suite of 13 field reference tools and calculators for Alaska Department of Transportation (DOT) geotechnical engineering applications. The entire project is pure vanilla HTML/CSS/JavaScript — no build step, no package manager, no external dependencies to install.

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
- `index.html` — main hub, links to all tools via a card grid
- `design-index.html` — secondary hub for design-focused tools (pavement design, subgrade frost, ESAL)

**Typical tool layout pattern:**
1. Header with back-link, title, status badge, and module number
2. Tab navigation bar (where multiple modes exist)
3. Input cards → real-time results sections
4. Footer bar with metadata

**Data flow:** User inputs trigger `onchange` handlers → JS reads DOM values via `getElementById()` → performs calculations → writes results back to DOM via `.textContent` or `.innerHTML`. Page reload resets all state; there is no persistence layer.

**Charts** are rendered using the native Canvas 2D API directly — no charting library.

**Exception:** `geo-agg.html` loads Leaflet.js (v1.9.4) and Leaflet Draw (v1.0.4) from CDN for interactive map functionality.

## Design System Conventions

- **Theme:** Dark throughout. CSS variables are defined in `:root` per file (e.g., `--bg`, `--text`, `--accent`, `--card`). Background range: `#0c0e14`–`#20243a`; primary text: `#dde0ee`.
- **Fonts:** IBM Plex Mono for headers, labels, and computed values; IBM Plex Sans for body text. Both loaded via Google Fonts CDN.
- **Status badges** on tool pages use: `Complete`, `WIP`, or `Draft`.
- Layout uses CSS Grid and Flexbox with media queries for mobile breakpoints.

## Tool Files

| File | Purpose |
|------|---------|
| `index.html` | Main landing hub |
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
