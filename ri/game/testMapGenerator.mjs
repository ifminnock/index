/**
 * testMapGenerator.mjs — Reproducibility tests and example usage.
 * Run with: node testMapGenerator.mjs
 */

import { generateMap } from './src/mapGenerator.js';

// ── Test 1: Reproducibility ───────────────────────────────────────────────

console.log('═══════════════════════════════════════');
console.log(' TEST 1 — Seed Reproducibility');
console.log('═══════════════════════════════════════');

const SEED = 'ALASKA-DRILL-42';
const map1 = generateMap(SEED, 20, 20, 2);
const map2 = generateMap(SEED, 20, 20, 2);

const identical = map1.tiles.every((tile, i) => {
  const t2 = map2.tiles[i];
  return tile.terrain  === t2.terrain
      && tile.resource === t2.resource
      && tile.maxDepth === t2.maxDepth
      && tile.x        === t2.x
      && tile.y        === t2.y;
});
console.log(`Same seed, same output: ${identical ? '✅ PASS' : '❌ FAIL'}`);

// Verify different seed gives different map
const map3 = generateMap('DIFFERENT-SEED', 20, 20, 2);
const different = map1.tiles.some((tile, i) => tile.terrain !== map3.tiles[i].terrain);
console.log(`Different seeds differ: ${different ? '✅ PASS' : '❌ FAIL'}`);

// ── Test 2: Statistics ────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log(' TEST 2 — Map Distribution Statistics');
console.log('═══════════════════════════════════════');

function printStats(map, label) {
  const total = map.meta.totalTiles;
  console.log(`\n[${label}]  seed="${map.seed}"  ${map.width}×${map.height}  players=${map.playerCount}`);

  console.log('\n  Terrain:');
  for (const [k, v] of Object.entries(map.meta.terrainCounts)) {
    const pct = ((v / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(pct / 2));
    console.log(`    ${k.padEnd(15)} ${String(v).padStart(4)}  ${pct.padStart(5)}%  ${bar}`);
  }

  console.log('\n  Resources:');
  for (const [k, v] of Object.entries(map.meta.resourceCounts)) {
    const pct = ((v / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(pct / 2));
    console.log(`    ${k.padEnd(15)} ${String(v).padStart(4)}  ${pct.padStart(5)}%  ${bar}`);
  }

  console.log('\n  Start Positions:');
  map.startPositions.forEach(sp => {
    const tile = map.tiles[sp.y * map.width + sp.x];
    console.log(`    Player ${sp.player}: (${sp.x}, ${sp.y})  terrain=${tile.terrain}`);
  });
}

printStats(map1, 'Primary');

// ── Test 3: Multiple seeds + sizes ────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log(' TEST 3 — Varied Seeds & Player Counts');
console.log('═══════════════════════════════════════');

printStats(generateMap('WORKSHOP-2025', 30, 30, 4), '30×30 / 4-player');
printStats(generateMap(12345,           15, 15, 3), '15×15 / 3-player / numeric seed');

// ── Test 4: Sample tile dump ─────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log(' TEST 4 — Sample Tile JSON (first 6)');
console.log('═══════════════════════════════════════');
console.log(JSON.stringify(map1.tiles.slice(0, 6), null, 2));

// ── Test 5: Edge cases ───────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log(' TEST 5 — Edge Cases');
console.log('═══════════════════════════════════════');

try {
  generateMap('x', 10, 10, 1);
  console.log('playerCount=1: ❌ Should have thrown');
} catch (e) {
  console.log(`playerCount=1 rejects:  ✅ "${e.message}"`);
}

try {
  generateMap('x', 10, 10, 5);
  console.log('playerCount=5: ❌ Should have thrown');
} catch (e) {
  console.log(`playerCount=5 rejects:  ✅ "${e.message}"`);
}

// Empty string seed (valid — hashes to a deterministic state)
const mapEmpty = generateMap('', 10, 10, 2);
const mapEmpty2 = generateMap('', 10, 10, 2);
console.log(`Empty-string seed stable: ${
  mapEmpty.tiles[0].terrain === mapEmpty2.tiles[0].terrain ? '✅ PASS' : '❌ FAIL'
}`);

console.log('\n✅ All tests complete.\n');
