# Map Generation — Geological Logic Reference

## Overview

The map generator produces a deterministic 2D grid of tiles using three layered
Simplex noise fields plus a seeded PRNG for resource placement. Everything is
reproducible from a seed string.

---

## Noise Architecture

Four independent noise functions, each seeded with a different suffix, so
changing one system doesn't cascade into others:

| Noise Field | Purpose | Config Key |
|---|---|---|
| `terrain` | Primary elevation/geology bands | `terrainScale` |
| `roughness` | Secondary fracturing of terrain patches | `roughnessScale` |
| `resource` | Sampled twice for resource rolls | `resourceScale` |
| `province` | Regional resource density modulator | `provinceScale` |

The terrain field and roughness field are blended:

```
terrainNoise = baseNoise × (1 - roughness) + roughNoise × roughness
```

Default `roughness = 0.35`, so terrain is 65% smooth and 35% fractured.

---

## Terrain Assignment

Noise values in [-1, 1] map to terrain bands via thresholds:

```
n < -0.15  →  unconsolidated   (alluvial, glacial, floodplain)
n < +0.20  →  sedimentary      (basins, shelves, coastal plains)
n < +0.55  →  metamorphic      (fold belts, deep crustal)
n ≥ +0.55  →  igneous          (volcanic centers, plutonic highs)
```

Typical distribution on a 20×20 grid:
- Sedimentary: ~35%
- Unconsolidated: ~34%
- Metamorphic: ~26%
- Igneous: ~4%

Igneous is intentionally rare — it hosts the richest ore concentrations but
presents the greatest drilling costs (enforced in Phase 3).

---

## Resource Placement Logic

Resource placement is a three-step process:

### Step 1: Null Bias
Each terrain type has a base probability of producing *no* resource
(`nullBias`). This is modulated by the province field — province-suppressed
zones have more barren tiles, province-rich zones have fewer.

### Step 2: Weighted Roll
If the tile isn't null-killed, a weighted draw selects a resource type
from the terrain's `spawnChance` table:

| Resource | Igneous | Metamorphic | Sedimentary | Unconsolidated |
|---|---|---|---|---|
| stone | 15% | 20% | 25% | 45% |
| common_ore | 35% | 30% | 20% | 5% |
| rare_ore | 20% | 12% | 4% | 0% |
| hydrocarbon | 0% | 2% | 18% | 0% |

### Step 3: Depth-Tier Enforcement
Resources have minimum depth requirements (0–2). If a tile's `maxDepth` is
lower than the resource tier requires, the resource is downgraded:

```
rare_ore (tier 2) → common_ore (tier 1) → stone (tier 0)
hydrocarbon (tier 2) → common_ore (tier 1) → stone (tier 0)
```

This means unconsolidated tiles (maxDepth=1) can *never* have rare ore or
hydrocarbons even if the probability table would allow it.

---

## Drill Depth by Terrain

Maximum drillable depth tiers per terrain:

| Terrain | maxDepth | Interpretation |
|---|---|---|
| unconsolidated | 1 | Soft sediment; shallow penetration only |
| sedimentary | 2 | Layered sequences; moderate depth |
| metamorphic | 3 | Hard rock; full column accessible |
| igneous | 3 | Hard rock; full column accessible |

`depth` and `drillLevel` on each tile start at 0 and are incremented by
the game loop as players drill.

---

## Province Clustering

The province noise field runs at a low spatial frequency (scale=0.08), creating
broad regional "provinces" with elevated or suppressed resource density. This
produces geologically plausible clustering:
- Resource-rich corridors where multiple valuable tiles cluster
- Barren zones where even good terrain types produce few resources
- Province strength (0.55) is moderate — strong enough to create meaningful
  provinces without fully gating resources behind RNG luck

---

## Information Design Note

Resources are stored in tile data from generation, but `revealed: false` hides
them from players until they claim or drill adjacent tiles. This creates
exploration tension: players must infer geology from terrain type and adjacency
rather than reading an open map.

Terrain *is* always visible (surface observation). Resource *type and quantity*
are revealed only by claiming and drilling.

---

## Economy Reference

Defined in `mapConfig.js` for Phase 3 balancing:

| Resource | Base Value |
|---|---|
| stone | $10 |
| common_ore | $50 |
| rare_ore | $200 |
| hydrocarbon | $500 |

---

## Tuning Guide

To adjust map feel, edit `mapConfig.js`:

- **More igneous terrain** → raise `thresholds.metamorphic` toward 0.75
- **Richer maps overall** → lower all `nullBias` values by 0.05–0.10
- **Larger resource provinces** → lower `provinceScale` (e.g., 0.05)
- **More fractured terrain** → raise `roughness` toward 0.50
- **Rare ore more common** → raise `spawnChance.igneous.rare_ore` and/or
  `spawnChance.metamorphic.rare_ore`
