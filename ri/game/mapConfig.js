/**
 * mapConfig.js — Tunable parameters for geological map generation.
 * All weights are relative; they're normalized internally before use.
 */

export const MAP_CONFIG = {

  // ── Terrain ────────────────────────────────────────────────────────────────
  terrain: {
    // Simplex noise thresholds that carve the map into terrain bands.
    // Values are in [-1, 1] noise space; order matters (low → high elevation).
    thresholds: {
      unconsolidated: -0.15,  // alluvial fans, floodplains, glacial drift
      sedimentary:     0.20,  // layered basins, coastal plains, shelf sequences
      metamorphic:     0.55,  // deep-crustal roots, fold-and-thrust belts
      igneous:         1.00,  // volcanic centers, plutonic highs
    },

    // Second noise octave weight — higher = more fragmented terrain patches
    roughness: 0.35,
  },

  // ── Resources ──────────────────────────────────────────────────────────────
  resources: {
    // Base spawn probability per terrain type (0–1).
    // These are reduced further by depth-tier and clustering logic.
    spawnChance: {
      unconsolidated: { stone: 0.45, common_ore: 0.05, rare_ore: 0.00, hydrocarbon: 0.00 },
      sedimentary:    { stone: 0.25, common_ore: 0.20, rare_ore: 0.04, hydrocarbon: 0.18 },
      metamorphic:    { stone: 0.20, common_ore: 0.30, rare_ore: 0.12, hydrocarbon: 0.02 },
      igneous:        { stone: 0.15, common_ore: 0.35, rare_ore: 0.20, hydrocarbon: 0.00 },
    },

    // Null-resource probability override per terrain (chance tile has nothing).
    // Applied after spawnChance rolls, increasing overall sparsity.
    nullBias: {
      unconsolidated: 0.40,
      sedimentary:    0.25,
      metamorphic:    0.20,
      igneous:        0.18,
    },

    // Depth-based resource tier locking.
    // Resources at depthTier > tile.maxDepth are replaced with the next lower tier.
    depthTiers: {
      stone:       0,  // surface
      common_ore:  1,  // shallow
      rare_ore:    2,  // deep
      hydrocarbon: 2,  // deep (sedimentary only)
    },

    // Game economy values (used by Phase 3 market; defined here for reference)
    values: {
      stone:       10,
      common_ore:  50,
      rare_ore:    200,
      hydrocarbon: 500,
    },
  },

  // ── Drill Depth ────────────────────────────────────────────────────────────
  // Maximum drillable depth tiers (0 = surface only, 3 = full column).
  maxDepth: {
    unconsolidated: 1,
    sedimentary:    2,
    metamorphic:    3,
    igneous:        3,
  },

  // ── Clustering ─────────────────────────────────────────────────────────────
  clustering: {
    // Third noise layer used to modulate resource density regionally.
    // Higher scale = broader resource "provinces"
    provinceScale: 0.08,

    // How strongly the province map suppresses/boosts resource spawn.
    // 0 = no clustering effect, 1 = provinces fully gate resources
    provinceStrength: 0.55,
  },

  // ── Noise ──────────────────────────────────────────────────────────────────
  noise: {
    // Primary terrain noise frequency (lower = smoother, larger features)
    terrainScale: 0.12,
    // Secondary roughness octave frequency
    roughnessScale: 0.30,
    // Resource placement noise frequency
    resourceScale: 0.18,
  },
};
