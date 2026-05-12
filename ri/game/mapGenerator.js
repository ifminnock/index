/**
 * mapGenerator.js
 *
 * generateMap(seed, width, height, playerCount) → Tile[]
 *
 * Each tile:
 * {
 *   x, y,
 *   terrain:   "sedimentary" | "igneous" | "metamorphic" | "unconsolidated"
 *   resource:  null | "stone" | "common_ore" | "rare_ore" | "hydrocarbon"
 *   maxDepth:  0–3  (max drillable depth tiers for this tile)
 *   depth:     0    (current drill depth — game loop populates)
 *   owner:     null (populated by game loop)
 *   drillLevel:0    (populated by game loop)
 *   revealed:  false
 * }
 */

import seedrandom from 'seedrandom';
import { buildSimplex } from './simplex.js';
import { MAP_CONFIG as CFG } from './mapConfig.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a value into [lo, hi]. */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Determine terrain type from a noise value in [-1, 1].
 * Terrain bands are set in CFG.terrain.thresholds.
 */
function noiseToTerrain(n) {
  const { unconsolidated, sedimentary, metamorphic } = CFG.terrain.thresholds;
  if (n < unconsolidated) return 'unconsolidated';
  if (n < sedimentary)    return 'sedimentary';
  if (n < metamorphic)    return 'metamorphic';
  return 'igneous';
}

/**
 * Roll for a resource given terrain, province strength, and two RNG values.
 * Returns a resource string or null.
 */
function rollResource(terrain, provinceBoost, rng1, rng2) {
  const nullBias = CFG.resources.nullBias[terrain];
  const spawnTable = CFG.resources.spawnChance[terrain];

  // Province boost: values > 0.5 increase resource probability;
  // values < 0.5 suppress it. provinceBoost is in [0,1].
  const suppression = 1 - CFG.clustering.provinceStrength
    + CFG.clustering.provinceStrength * provinceBoost;

  // Early null check
  if (rng1 < nullBias * (2 - suppression)) return null;

  // Weighted roll across resource types
  const pool = Object.entries(spawnTable);
  let cumulative = 0;
  const roll = rng2 * suppression;

  for (const [resource, weight] of pool) {
    cumulative += weight;
    if (roll < cumulative) return resource;
  }
  return null;
}

/**
 * Enforce depth-tier locking: if a resource requires deeper access than
 * this tile's maxDepth allows, downgrade it.
 */
function enforceDepthTier(resource, maxDepth) {
  if (resource === null) return null;
  const tier = CFG.resources.depthTiers[resource];
  if (tier <= maxDepth) return resource;

  // Downgrade one step at a time
  const fallback = { rare_ore: 'common_ore', hydrocarbon: 'common_ore', common_ore: 'stone' };
  return enforceDepthTier(fallback[resource] ?? null, maxDepth);
}

// ── Starting Position Generator ─────────────────────────────────────────────

/**
 * Place player starting positions as far apart as possible on a square grid.
 * Uses a simple quadrant-based approach for 2–4 players.
 */
function generateStartPositions(width, height, playerCount, rng) {
  const margin = Math.floor(Math.min(width, height) * 0.15);
  const positions = [];

  const quadrants = [
    [margin, margin],
    [width - 1 - margin, height - 1 - margin],
    [width - 1 - margin, margin],
    [margin, height - 1 - margin],
  ];

  for (let p = 0; p < playerCount; p++) {
    const [qx, qy] = quadrants[p % 4];
    // Small jitter within quadrant so starts aren't perfectly symmetric
    const jitter = Math.floor(margin * 0.4);
    positions.push({
      player: p + 1,
      x: clamp(qx + Math.floor((rng() - 0.5) * 2 * jitter), 0, width - 1),
      y: clamp(qy + Math.floor((rng() - 0.5) * 2 * jitter), 0, height - 1),
    });
  }
  return positions;
}

// ── Main Export ──────────────────────────────────────────────────────────────

/**
 * Generate a deterministic geological map.
 *
 * @param {string|number} seed
 * @param {number} width   Grid columns (default 20)
 * @param {number} height  Grid rows    (default 20)
 * @param {number} playerCount 2–4
 * @returns {{ tiles: Tile[], startPositions: StartPos[], seed: string, meta: object }}
 */
export function generateMap(seed, width = 20, height = 20, playerCount = 2) {
  if (playerCount < 2 || playerCount > 4) throw new Error('playerCount must be 2–4');

  const seedStr = String(seed);

  // Independent PRNGs for each concern — keeps changes to one system from
  // cascading into unrelated outputs when tuning parameters.
  const rngTerrain   = seedrandom(`${seedStr}:terrain`);
  const rngRoughness = seedrandom(`${seedStr}:roughness`);
  const rngResource  = seedrandom(`${seedStr}:resource`);
  const rngProvince  = seedrandom(`${seedStr}:province`);
  const rngStart     = seedrandom(`${seedStr}:start`);

  const noiseTerrain   = buildSimplex(rngTerrain);
  const noiseRoughness = buildSimplex(rngRoughness);
  const noiseResource  = buildSimplex(rngResource);
  const noiseProvince  = buildSimplex(rngProvince);

  const { terrainScale, roughnessScale, resourceScale } = CFG.noise;
  const { provinceScale, provinceStrength } = CFG.clustering;
  const roughnessWeight = CFG.terrain.roughness;

  const tiles = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {

      // 1. Terrain — blend two noise octaves
      const baseNoise  = noiseTerrain(x * terrainScale, y * terrainScale);
      const roughNoise = noiseRoughness(x * roughnessScale, y * roughnessScale);
      const terrainNoise = clamp(
        baseNoise * (1 - roughnessWeight) + roughNoise * roughnessWeight,
        -1, 1
      );
      const terrain = noiseToTerrain(terrainNoise);

      // 2. Max drill depth from terrain type
      const maxDepth = CFG.maxDepth[terrain];

      // 3. Province map — regional resource density modulator [0, 1]
      const rawProvince = noiseProvince(x * provinceScale, y * provinceScale);
      const provinceBoost = (rawProvince + 1) / 2; // remap to [0,1]

      // 4. Resource — two independent rolls for the resource system
      const resNoise1 = (noiseResource(x * resourceScale,        y * resourceScale)        + 1) / 2;
      const resNoise2 = (noiseResource(x * resourceScale + 100,  y * resourceScale + 100)  + 1) / 2;
      const rawResource = rollResource(terrain, provinceBoost, resNoise1, resNoise2);

      // 5. Depth-tier enforcement — downgrade resources the tile can't access
      const resource = enforceDepthTier(rawResource, maxDepth);

      tiles.push({
        x,
        y,
        terrain,
        resource,
        maxDepth,
        // ── Game state fields (populated by game loop) ──
        depth:      0,
        owner:      null,
        drillLevel: 0,
        revealed:   false,
      });
    }
  }

  // 6. Player start positions (cleared of resources; always owned on turn 0)
  const startPositions = generateStartPositions(width, height, playerCount, rngStart);
  for (const sp of startPositions) {
    const tile = tiles[sp.y * width + sp.x];
    tile.resource  = null; // starts are neutral ground
    tile.revealed  = true;
  }

  // 7. Metadata for debugging / Phase 2 display
  const terrainCounts = tiles.reduce((acc, t) => {
    acc[t.terrain] = (acc[t.terrain] || 0) + 1; return acc;
  }, {});
  const resourceCounts = tiles.reduce((acc, t) => {
    const k = t.resource ?? 'none';
    acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});

  return {
    tiles,
    startPositions,
    seed: seedStr,
    width,
    height,
    playerCount,
    meta: {
      terrainCounts,
      resourceCounts,
      totalTiles: tiles.length,
    },
  };
}
