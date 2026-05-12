import { useState, useCallback, useMemo, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
//  INLINED MAP ENGINE (Phase 1 — no import needed in artifact)
// ═══════════════════════════════════════════════════════════════════

const MAP_CONFIG = {
  terrain: {
    thresholds: { unconsolidated: -0.15, sedimentary: 0.20, metamorphic: 0.55, igneous: 1.00 },
    roughness: 0.35,
  },
  resources: {
    spawnChance: {
      unconsolidated: { stone: 0.45, common_ore: 0.05, rare_ore: 0.00, hydrocarbon: 0.00 },
      sedimentary:    { stone: 0.25, common_ore: 0.20, rare_ore: 0.04, hydrocarbon: 0.18 },
      metamorphic:    { stone: 0.20, common_ore: 0.30, rare_ore: 0.12, hydrocarbon: 0.02 },
      igneous:        { stone: 0.15, common_ore: 0.35, rare_ore: 0.20, hydrocarbon: 0.00 },
    },
    nullBias: { unconsolidated: 0.40, sedimentary: 0.25, metamorphic: 0.20, igneous: 0.18 },
    depthTiers: { stone: 0, common_ore: 1, rare_ore: 2, hydrocarbon: 2 },
    values: { stone: 10, common_ore: 50, rare_ore: 200, hydrocarbon: 500 },
  },
  maxDepth: { unconsolidated: 1, sedimentary: 2, metamorphic: 3, igneous: 3 },
  clustering: { provinceScale: 0.08, provinceStrength: 0.55 },
  noise: { terrainScale: 0.12, roughnessScale: 0.30, resourceScale: 0.18 },
};

// Minimal seeded PRNG (mulberry32)
function makePRNG(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  let s = (h >>> 0) + 1;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const GRAD3 = [[1,1],[−1,1],[1,−1],[−1,−1],[1,0],[−1,0],[0,1],[0,−1],[1,1],[−1,1],[1,−1],[−1,−1]];
function dot2(g, x, y) { return g[0]*x + g[1]*y; }

function buildSimplex(rng) {
  const p = Array.from({length:256},(_,i)=>i);
  for (let i=255;i>0;i--) { const j=Math.floor(rng()*(i+1)); [p[i],p[j]]=[p[j],p[i]]; }
  const perm=new Uint8Array(512), permMod12=new Uint8Array(512);
  for (let i=0;i<512;i++) { perm[i]=p[i&255]; permMod12[i]=perm[i]%12; }
  const F2=0.5*(Math.sqrt(3)-1), G2=(3-Math.sqrt(3))/6;
  return function(xin,yin) {
    const s=(xin+yin)*F2, i=Math.floor(xin+s), j=Math.floor(yin+s), t=(i+j)*G2;
    const X0=i-t,Y0=j-t,x0=xin-X0,y0=yin-Y0;
    const [i1,j1]=x0>y0?[1,0]:[0,1];
    const x1=x0-i1+G2,y1=y0-j1+G2,x2=x0-1+2*G2,y2=y0-1+2*G2;
    const ii=i&255,jj=j&255;
    const gi0=permMod12[ii+perm[jj]],gi1=permMod12[ii+i1+perm[jj+j1]],gi2=permMod12[ii+1+perm[jj+1]];
    let n0=0,n1=0,n2=0;
    let t0=0.5-x0*x0-y0*y0; if(t0>=0){t0*=t0;n0=t0*t0*dot2(GRAD3[gi0],x0,y0);}
    let t1=0.5-x1*x1-y1*y1; if(t1>=0){t1*=t1;n1=t1*t1*dot2(GRAD3[gi1],x1,y1);}
    let t2=0.5-x2*x2-y2*y2; if(t2>=0){t2*=t2;n2=t2*t2*dot2(GRAD3[gi2],x2,y2);}
    return 70*(n0+n1+n2);
  };
}

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function noiseToTerrain(n){
  const {unconsolidated,sedimentary,metamorphic}=MAP_CONFIG.terrain.thresholds;
  if(n<unconsolidated)return'unconsolidated';
  if(n<sedimentary)return'sedimentary';
  if(n<metamorphic)return'metamorphic';
  return'igneous';
}
function rollResource(terrain,provinceBoost,rng1,rng2){
  const nullBias=MAP_CONFIG.resources.nullBias[terrain];
  const spawnTable=MAP_CONFIG.resources.spawnChance[terrain];
  const suppression=1-MAP_CONFIG.clustering.provinceStrength+MAP_CONFIG.clustering.provinceStrength*provinceBoost;
  if(rng1<nullBias*(2-suppression))return null;
  const pool=Object.entries(spawnTable);
  let cumulative=0; const roll=rng2*suppression;
  for(const[resource,weight]of pool){cumulative+=weight;if(roll<cumulative)return resource;}
  return null;
}
function enforceDepthTier(resource,maxDepth){
  if(resource===null)return null;
  const tier=MAP_CONFIG.resources.depthTiers[resource];
  if(tier<=maxDepth)return resource;
  const fallback={rare_ore:'common_ore',hydrocarbon:'common_ore',common_ore:'stone'};
  return enforceDepthTier(fallback[resource]??null,maxDepth);
}

function generateMap(seed, width=20, height=20, playerCount=2) {
  const s=String(seed);
  const rngT=makePRNG(s+':terrain'), rngR=makePRNG(s+':roughness');
  const rngRes=makePRNG(s+':resource'), rngP=makePRNG(s+':province');
  const rngSt=makePRNG(s+':start');
  const nT=buildSimplex(rngT),nRo=buildSimplex(rngR),nRes=buildSimplex(rngRes),nPr=buildSimplex(rngP);
  const {terrainScale,roughnessScale,resourceScale}=MAP_CONFIG.noise;
  const {provinceScale}=MAP_CONFIG.clustering;
  const rw=MAP_CONFIG.terrain.roughness;
  const tiles=[];
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const base=nT(x*terrainScale,y*terrainScale);
      const rough=nRo(x*roughnessScale,y*roughnessScale);
      const tn=clamp(base*(1-rw)+rough*rw,-1,1);
      const terrain=noiseToTerrain(tn);
      const maxDepth=MAP_CONFIG.maxDepth[terrain];
      const rawProv=nPr(x*provinceScale,y*provinceScale);
      const pb=(rawProv+1)/2;
      const r1=(nRes(x*resourceScale,y*resourceScale)+1)/2;
      const r2=(nRes(x*resourceScale+100,y*resourceScale+100)+1)/2;
      const rawRes=rollResource(terrain,pb,r1,r2);
      const resource=enforceDepthTier(rawRes,maxDepth);
      tiles.push({x,y,terrain,resource,maxDepth,depth:0,owner:null,drillLevel:0,revealed:false});
    }
  }
  const margin=Math.floor(Math.min(width,height)*0.15);
  const quadrants=[[margin,margin],[width-1-margin,height-1-margin],[width-1-margin,margin],[margin,height-1-margin]];
  const startPositions=[];
  for(let p=0;p<playerCount;p++){
    const[qx,qy]=quadrants[p%4];
    const jitter=Math.floor(margin*0.4);
    const sx=clamp(qx+Math.floor((rngSt()-0.5)*2*jitter),0,width-1);
    const sy=clamp(qy+Math.floor((rngSt()-0.5)*2*jitter),0,height-1);
    startPositions.push({player:p+1,x:sx,y:sy});
  }
  for(const sp of startPositions){
    const tile=tiles[sp.y*width+sp.x];
    tile.resource=null; tile.revealed=true;
  }
  return {tiles,startPositions,seed:s,width,height,playerCount};
}

// ═══════════════════════════════════════════════════════════════════
//  CONSTANTS & THEME
// ═══════════════════════════════════════════════════════════════════

const PLAYER_COLORS = ["#D4A843","#4ECDC4","#FF6B6B","#A8E063"];
const PLAYER_NAMES  = ["PIONEER-1","PIONEER-2","PIONEER-3","PIONEER-4"];

const TERRAIN_STYLE = {
  unconsolidated: { base:"#2A2218", stripe:"#3A3225", label:"UNCONSOLIDATED" },
  sedimentary:    { base:"#1E2A20", stripe:"#253224", label:"SEDIMENTARY" },
  metamorphic:    { base:"#1A1E2A", stripe:"#222535", label:"METAMORPHIC" },
  igneous:        { base:"#2A1A1A", stripe:"#351F1F", label:"IGNEOUS" },
};

const RESOURCE_ICON = {
  stone:       { icon:"◈", color:"#8A8070", label:"STONE" },
  common_ore:  { icon:"⬡", color:"#7FB3D3", label:"COM.ORE" },
  rare_ore:    { icon:"✦", color:"#E8C44A", label:"RARE ORE" },
  hydrocarbon: { icon:"⬟", color:"#6BC49A", label:"H.CARBON" },
};

const RESOURCE_VALUE = { stone:10, common_ore:50, rare_ore:200, hydrocarbon:500 };

const DEPTH_BARS = ["▁","▃","▅","█"];

// ═══════════════════════════════════════════════════════════════════
//  ISOMETRIC TILE RENDERER (Canvas-based, drawn per tile)
// ═══════════════════════════════════════════════════════════════════

// Isometric projection helpers
const ISO_W = 64;  // tile width in pixels
const ISO_H = 32;  // tile height
const ISO_DEPTH = 10; // extrusion depth for 2.5D

function isoProject(x, y) {
  return {
    sx: (x - y) * (ISO_W / 2),
    sy: (x + y) * (ISO_H / 2),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  ISOMETRIC BOARD (SVG-based for crisp rendering without Phaser dep)
// ═══════════════════════════════════════════════════════════════════

function IsometricTile({ tile, isSelected, isHovered, playerColors, onClick, onHover, tileSize, showResources }) {
  const { x, y, terrain, resource, owner, drillLevel, revealed, maxDepth } = tile;

  const tw = tileSize;
  const th = tileSize * 0.5;
  const depth = drillLevel * 4;

  const sx = (x - y) * (tw / 2);
  const sy = (x + y) * (th / 2);

  const ts = TERRAIN_STYLE[terrain];
  const playerColor = owner ? playerColors[owner - 1] : null;

  // Top face points
  const top = [
    [sx,        sy - depth],
    [sx + tw/2, sy + th/2 - depth],
    [sx,        sy + th - depth],
    [sx - tw/2, sy + th/2 - depth],
  ].map(p => p.join(',')).join(' ');

  // Left face (south-west)
  const left = [
    [sx - tw/2, sy + th/2 - depth],
    [sx,        sy + th - depth],
    [sx,        sy + th],
    [sx - tw/2, sy + th/2],
  ].map(p => p.join(',')).join(' ');

  // Right face (south-east)
  const right = [
    [sx,        sy + th - depth],
    [sx + tw/2, sy + th/2 - depth],
    [sx + tw/2, sy + th/2],
    [sx,        sy + th],
  ].map(p => p.join(',')).join(' ');

  const baseAlpha = isHovered ? 'DD' : 'AA';
  const topColor = playerColor
    ? playerColor + '33'
    : revealed ? ts.base : '#111111';

  const borderColor = isSelected
    ? '#FFD700'
    : playerColor || (isHovered ? '#AA9966' : '#333322');
  const borderWidth = isSelected ? 2 : 1;

  const resStyle = resource && RESOURCE_ICON[resource];

  // Center of top face for icon placement
  const cx = sx;
  const cy = sy + th / 2 - depth;

  return (
    <g
      className="iso-tile"
      onClick={() => onClick(tile)}
      onMouseEnter={() => onHover(tile)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: 'pointer' }}
    >
      {/* Left face */}
      <polygon
        points={left}
        fill={playerColor ? playerColor + '22' : '#0D0D0A'}
        stroke={borderColor}
        strokeWidth={borderWidth * 0.5}
      />
      {/* Right face */}
      <polygon
        points={right}
        fill={playerColor ? playerColor + '18' : '#161610'}
        stroke={borderColor}
        strokeWidth={borderWidth * 0.5}
      />
      {/* Top face */}
      <polygon
        points={top}
        fill={revealed ? (playerColor ? playerColor + '28' : ts.base) : '#0A0A08'}
        stroke={borderColor}
        strokeWidth={borderWidth}
      />
      {/* Drill depth indicator — vertical bars on top face */}
      {revealed && drillLevel > 0 && (
        <text
          x={cx - 2}
          y={cy + 3}
          fontSize={8}
          fill={playerColor || '#AA9966'}
          textAnchor="middle"
          fontFamily="monospace"
          opacity={0.8}
        >
          {'▮'.repeat(drillLevel)}
        </text>
      )}
      {/* Resource icon */}
      {revealed && showResources && resStyle && (
        <text
          x={cx}
          y={cy + 5}
          fontSize={10}
          fill={resStyle.color}
          textAnchor="middle"
          fontFamily="monospace"
          style={{ filter: 'drop-shadow(0 0 3px ' + resStyle.color + '88)' }}
        >
          {resStyle.icon}
        </text>
      )}
      {/* Unrevealed fog */}
      {!revealed && (
        <polygon
          points={top}
          fill="url(#fog)"
          opacity={0.6}
        />
      )}
      {/* Selection ring */}
      {isSelected && (
        <polygon
          points={top}
          fill="none"
          stroke="#FFD700"
          strokeWidth={2}
          opacity={0.9}
          style={{ filter: 'drop-shadow(0 0 4px #FFD700)' }}
        />
      )}
    </g>
  );
}

function IsometricBoard({ mapData, selectedTile, hoveredTile, onTileClick, onTileHover, showResources }) {
  const { tiles, width, height } = mapData;
  const tw = 52, th = 26;

  // Compute canvas bounds
  const allSx = tiles.map(t => (t.x - t.y) * (tw / 2));
  const allSy = tiles.map(t => (t.x + t.y) * (th / 2));
  const minX = Math.min(...allSx) - tw / 2;
  const minY = Math.min(...allSy) - 40;
  const maxX = Math.max(...allSx) + tw / 2;
  const maxY = Math.max(...allSy) + th + 20;
  const svgW = maxX - minX + 20;
  const svgH = maxY - minY + 20;
  const ox = -minX + 10;
  const oy = -minY + 10;

  // Sort tiles for painter's algorithm (back-to-front)
  const sorted = [...tiles].sort((a, b) => (a.x + a.y) - (b.x + b.y));

  const playerColors = PLAYER_COLORS;

  return (
    <svg
      width={svgW}
      height={svgH}
      style={{ display: 'block', margin: '0 auto' }}
      viewBox={`0 0 ${svgW} ${svgH}`}
    >
      <defs>
        <radialGradient id="fog" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1A1A12" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0A0A06" stopOpacity="0.85" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        {PLAYER_COLORS.map((c, i) => (
          <radialGradient key={i} id={`pg${i}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={c} stopOpacity="0.4" />
            <stop offset="100%" stopColor={c} stopOpacity="0.1" />
          </radialGradient>
        ))}
      </defs>
      <g transform={`translate(${ox}, ${oy})`}>
        {sorted.map(tile => {
          const tileW = 52, tileH = 26;
          const depth = tile.drillLevel * 4;
          const sx = (tile.x - tile.y) * (tileW / 2);
          const sy = (tile.x + tile.y) * (tileH / 2);
          const ts = TERRAIN_STYLE[tile.terrain];
          const playerColor = tile.owner ? PLAYER_COLORS[tile.owner - 1] : null;
          const isSelected = selectedTile && selectedTile.x === tile.x && selectedTile.y === tile.y;
          const isHovered = hoveredTile && hoveredTile.x === tile.x && hoveredTile.y === tile.y;
          const borderColor = isSelected ? '#FFD700' : playerColor || (isHovered ? '#AA9966' : '#2A2A1A');
          const borderWidth = isSelected ? 2 : 0.75;
          const resStyle = tile.resource && RESOURCE_ICON[tile.resource];
          const cx = sx, cy = sy + tileH / 2 - depth;

          const top = `${sx},${sy - depth} ${sx+tileW/2},${sy+tileH/2-depth} ${sx},${sy+tileH-depth} ${sx-tileW/2},${sy+tileH/2-depth}`;
          const left = `${sx-tileW/2},${sy+tileH/2-depth} ${sx},${sy+tileH-depth} ${sx},${sy+tileH} ${sx-tileW/2},${sy+tileH/2}`;
          const right = `${sx},${sy+tileH-depth} ${sx+tileW/2},${sy+tileH/2-depth} ${sx+tileW/2},${sy+tileH/2} ${sx},${sy+tileH}`;

          return (
            <g key={`${tile.x}-${tile.y}`} onClick={() => onTileClick(tile)} onMouseEnter={() => onTileHover(tile)} onMouseLeave={() => onTileHover(null)} style={{ cursor: 'pointer' }}>
              <polygon points={left} fill={playerColor ? playerColor + '15' : '#0C0C09'} stroke={borderColor} strokeWidth={borderWidth * 0.5} />
              <polygon points={right} fill={playerColor ? playerColor + '10' : '#141410'} stroke={borderColor} strokeWidth={borderWidth * 0.5} />
              <polygon points={top}
                fill={tile.revealed ? (playerColor ? playerColor + '22' : ts.base) : '#0D0D0A'}
                stroke={borderColor}
                strokeWidth={borderWidth}
              />
              {tile.revealed && tile.drillLevel > 0 && (
                <text x={cx} y={cy + 4} fontSize={7} fill={playerColor || '#7A6A44'} textAnchor="middle" fontFamily="monospace" opacity={0.9}>
                  {'▮'.repeat(tile.drillLevel)}
                </text>
              )}
              {tile.revealed && showResources && resStyle && (
                <text x={cx} y={cy + (tile.drillLevel > 0 ? -2 : 4)} fontSize={9} fill={resStyle.color} textAnchor="middle" fontFamily="monospace">
                  {resStyle.icon}
                </text>
              )}
              {!tile.revealed && (
                <polygon points={top} fill="#0A0A08" opacity={0.75} />
              )}
              {isSelected && (
                <polygon points={top} fill="none" stroke="#FFD700" strokeWidth={2} opacity={0.95} />
              )}
              {isHovered && !isSelected && (
                <polygon points={top} fill="#FFD70011" stroke="#AA994488" strokeWidth={1} />
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PLAYER SIDEBAR
// ═══════════════════════════════════════════════════════════════════

function PlayerCard({ player, isActive, balance, resources, claimCount }) {
  const color = PLAYER_COLORS[player - 1];
  const name = PLAYER_NAMES[player - 1];

  const totalValue = Object.entries(resources).reduce(
    (sum, [r, qty]) => sum + qty * (RESOURCE_VALUE[r] || 0), 0
  );

  return (
    <div style={{
      border: `1px solid ${isActive ? color : color + '44'}`,
      background: isActive ? color + '12' : '#0D0D0A',
      padding: '10px 12px',
      marginBottom: 8,
      fontFamily: "'Courier New', monospace",
      position: 'relative',
      transition: 'all 0.2s',
    }}>
      {isActive && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        }} />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color, fontSize: 11, fontWeight: 'bold', letterSpacing: 2 }}>{name}</span>
        {isActive && <span style={{ color, fontSize: 9, animation: 'pulse 1s infinite' }}>▶ ACTIVE</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: '#6A6050', fontSize: 10 }}>BALANCE</span>
        <span style={{ color: '#C8A84A', fontSize: 11, fontFamily: 'monospace' }}>${balance.toLocaleString()}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color: '#6A6050', fontSize: 10 }}>CLAIMS</span>
        <span style={{ color: '#8A8070', fontSize: 10 }}>{claimCount} tiles</span>
      </div>
      <div style={{ borderTop: `1px solid ${color}22`, paddingTop: 6 }}>
        {Object.entries(resources).filter(([,v])=>v>0).map(([r, qty]) => {
          const rs = RESOURCE_ICON[r];
          return (
            <div key={r} style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:2 }}>
              <span style={{ color: rs.color }}>{rs.icon} {rs.label}</span>
              <span style={{ color:'#8A8070' }}>×{qty}</span>
            </div>
          );
        })}
        {Object.values(resources).every(v=>v===0) && (
          <div style={{ color:'#3A3A2A', fontSize:10 }}>— no resources —</div>
        )}
      </div>
      <div style={{ marginTop: 6, borderTop: `1px solid ${color}22`, paddingTop: 4, display:'flex', justifyContent:'space-between' }}>
        <span style={{ color:'#6A6050', fontSize:9 }}>PORTFOLIO VALUE</span>
        <span style={{ color: color, fontSize:10 }}>${(balance + totalValue).toLocaleString()}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  ACTION PANEL
// ═══════════════════════════════════════════════════════════════════

function ActionPanel({ selectedTile, currentPlayer, onClaim, onDrill, onSell, playerData }) {
  if (!selectedTile) {
    return (
      <div style={{ fontFamily:"'Courier New',monospace", color:'#3A3A28', fontSize:11, padding:12, border:'1px solid #1E1E12', textAlign:'center' }}>
        SELECT A TILE TO<br/>VIEW ACTIONS
      </div>
    );
  }

  const { terrain, resource, owner, drillLevel, maxDepth, revealed, x, y } = selectedTile;
  const ts = TERRAIN_STYLE[terrain];
  const rs = resource && RESOURCE_ICON[resource];
  const isOwned = owner !== null;
  const isOwnedByMe = owner === currentPlayer;
  const canClaim = !isOwned && revealed;
  const canDrill = isOwnedByMe && drillLevel < maxDepth;
  const canSell = isOwnedByMe && resource && drillLevel > 0;
  const claimCost = 100;
  const drillCost = [0, 50, 150, 300][drillLevel] || 0;
  const balance = playerData[currentPlayer - 1]?.balance || 0;

  return (
    <div style={{ fontFamily:"'Courier New',monospace", border:'1px solid #2A2A18', background:'#0D0D0A' }}>
      {/* Tile info header */}
      <div style={{ padding:'8px 12px', borderBottom:'1px solid #1E1E12', background:'#111109' }}>
        <div style={{ color:'#6A6050', fontSize:9, marginBottom:2 }}>SELECTED — ({x},{y})</div>
        <div style={{ color:'#C8A84A', fontSize:12, fontWeight:'bold', marginBottom:4 }}>{ts.label}</div>
        <div style={{ display:'flex', gap:8 }}>
          <span style={{ color:'#6A6050', fontSize:10 }}>DEPTH MAX: {maxDepth}</span>
          <span style={{ color:'#6A6050', fontSize:10 }}>DRILLED: {drillLevel}</span>
        </div>
        {revealed && rs && (
          <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ color:rs.color, fontSize:14 }}>{rs.icon}</span>
            <div>
              <div style={{ color:rs.color, fontSize:10 }}>{rs.label}</div>
              <div style={{ color:'#6A6050', fontSize:9 }}>VALUE: ${RESOURCE_VALUE[resource]}/unit</div>
            </div>
          </div>
        )}
        {revealed && !resource && <div style={{ color:'#3A3A28', fontSize:10, marginTop:4 }}>— no surface resource —</div>}
        {!revealed && <div style={{ color:'#3A3A28', fontSize:10, marginTop:4 }}>⬛ UNEXPLORED</div>}
        {isOwned && (
          <div style={{ marginTop:4, color: PLAYER_COLORS[owner-1], fontSize:10 }}>
            ▣ {PLAYER_NAMES[owner-1]}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:6 }}>
        <ActionButton
          label="STAKE CLAIM"
          sublabel={`Cost: $${claimCost}`}
          disabled={!canClaim || balance < claimCost}
          reason={!revealed ? 'Tile not revealed' : isOwned ? 'Already claimed' : balance < claimCost ? 'Insufficient funds' : null}
          color="#C8A84A"
          onClick={onClaim}
        />
        <ActionButton
          label="DRILL"
          sublabel={`Cost: $${drillCost} → Depth ${drillLevel+1}`}
          disabled={!canDrill || balance < drillCost}
          reason={!isOwnedByMe ? 'Not your claim' : drillLevel >= maxDepth ? 'Max depth reached' : balance < drillCost ? 'Insufficient funds' : null}
          color="#4ECDC4"
          onClick={onDrill}
        />
        <ActionButton
          label="SELL TO BANK"
          sublabel={resource && drillLevel > 0 ? `+$${RESOURCE_VALUE[resource] * drillLevel}` : 'Drill first'}
          disabled={!canSell}
          reason={!isOwnedByMe ? 'Not your claim' : !resource ? 'No resource' : drillLevel === 0 ? 'Must drill first' : null}
          color="#A8E063"
          onClick={onSell}
        />
      </div>
    </div>
  );
}

function ActionButton({ label, sublabel, disabled, reason, color, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      disabled={disabled}
      style={{
        background: disabled ? '#0D0D0A' : hov ? color + '22' : '#111109',
        border: `1px solid ${disabled ? '#1E1E12' : hov ? color : color + '55'}`,
        color: disabled ? '#2A2A1E' : color,
        fontFamily:"'Courier New',monospace",
        fontSize:10, letterSpacing:1.5,
        padding:'7px 10px',
        textAlign:'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition:'all 0.15s',
        width:'100%',
      }}
    >
      <div style={{ fontWeight:'bold' }}>{label}</div>
      <div style={{ fontSize:9, opacity:0.7, marginTop:2 }}>{disabled && reason ? reason.toUpperCase() : sublabel}</div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  GAME LOG
// ═══════════════════════════════════════════════════════════════════

function GameLog({ entries }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [entries]);

  return (
    <div ref={ref} style={{
      height:120, overflowY:'auto', fontFamily:"'Courier New',monospace",
      fontSize:10, lineHeight:1.6, padding:'6px 10px',
      border:'1px solid #1E1E12', background:'#0A0A07',
      scrollbarWidth:'thin', scrollbarColor:'#2A2A1A #0A0A07',
    }}>
      {entries.map((e, i) => (
        <div key={i} style={{ color: e.color || '#4A4A38', marginBottom:1 }}>
          <span style={{ color:'#2A2A1A' }}>[{String(e.turn).padStart(3,'0')}] </span>
          {e.text}
        </div>
      ))}
      {entries.length === 0 && <div style={{ color:'#2A2A1A' }}>Awaiting first action...</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAP CONTROLS
// ═══════════════════════════════════════════════════════════════════

function TerrainLegend() {
  return (
    <div style={{ fontFamily:"'Courier New',monospace", fontSize:9, display:'flex', flexDirection:'column', gap:3 }}>
      {Object.entries(TERRAIN_STYLE).map(([k,v])=>(
        <div key={k} style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ width:12, height:8, background:v.base, border:'1px solid #3A3A28' }} />
          <span style={{ color:'#5A5A48' }}>{v.label}</span>
        </div>
      ))}
      <div style={{ marginTop:4, color:'#4A4A38', borderTop:'1px solid #1E1E12', paddingTop:4 }}>RESOURCES</div>
      {Object.entries(RESOURCE_ICON).map(([k,v])=>(
        <div key={k} style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ color:v.color, fontSize:11 }}>{v.icon}</span>
          <span style={{ color:'#5A5A48' }}>{v.label}</span>
          <span style={{ color:'#3A3A28', marginLeft:'auto' }}>${RESOURCE_VALUE[k]}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════

const INITIAL_BALANCE = 500;
const WIN_TARGET = 2000;

export default function GeoGame() {
  // ── Setup state ─────────────────────────────────────────────────
  const [phase, setPhase] = useState('setup'); // setup | playing
  const [seedInput, setSeedInput] = useState('ALASKA-DRILL-42');
  const [playerCountInput, setPlayerCountInput] = useState(2);
  const [mapWidthInput, setMapWidthInput] = useState(16);
  const [mapHeightInput, setMapHeightInput] = useState(16);

  // ── Game state ──────────────────────────────────────────────────
  const [mapData, setMapData] = useState(null);
  const [tiles, setTiles] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [turn, setTurn] = useState(1);
  const [playerData, setPlayerData] = useState([]);
  const [selectedTile, setSelectedTile] = useState(null);
  const [hoveredTile, setHoveredTile] = useState(null);
  const [log, setLog] = useState([]);
  const [showResources, setShowResources] = useState(true);
  const [winner, setWinner] = useState(null);

  // ── Helpers ─────────────────────────────────────────────────────
  const addLog = useCallback((text, color) => {
    setLog(l => [...l.slice(-60), { text, color, turn }]);
  }, [turn]);

  const getTile = useCallback((x, y) => tiles.find(t => t.x === x && t.y === y), [tiles]);

  const updateTile = useCallback((x, y, patch) => {
    setTiles(ts => ts.map(t => t.x === x && t.y === y ? { ...t, ...patch } : t));
  }, []);

  const revealAdjacent = useCallback((x, y) => {
    const adj = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]];
    setTiles(ts => ts.map(t => {
      const near = adj.some(([dx,dy]) => t.x === x+dx && t.y === y+dy);
      return near ? { ...t, revealed: true } : t;
    }));
  }, []);

  const advanceTurn = useCallback((count) => {
    setCurrentPlayer(cp => {
      const next = (cp % count) + 1;
      return next;
    });
    setTurn(t => t + 1);
    setSelectedTile(null);
  }, []);

  // ── Start game ──────────────────────────────────────────────────
  const startGame = () => {
    const pc = Number(playerCountInput);
    const md = generateMap(seedInput || 'DEFAULT', Number(mapWidthInput), Number(mapHeightInput), pc);
    setMapData(md);

    // Reveal start tiles and adjacent
    const tilesInit = md.tiles.map(t => ({ ...t }));
    for (const sp of md.startPositions) {
      const idx = sp.y * md.width + sp.x;
      tilesInit[idx].owner = sp.player;
      tilesInit[idx].revealed = true;
      // reveal ring
      const adj = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]];
      for (const [dx,dy] of adj) {
        const nx=sp.x+dx, ny=sp.y+dy;
        if (nx>=0&&ny>=0&&nx<md.width&&ny<md.height) {
          const ni = ny*md.width+nx;
          tilesInit[ni].revealed = true;
        }
      }
    }
    setTiles(tilesInit);
    setCurrentPlayer(1);
    setTurn(1);
    setWinner(null);
    setSelectedTile(null);
    setLog([]);
    setPlayerData(Array.from({length:pc},(_,i)=>({
      balance: INITIAL_BALANCE,
      resources: { stone:0, common_ore:0, rare_ore:0, hydrocarbon:0 },
    })));
    setPhase('playing');
    addLog(`Map "${seedInput}" loaded. ${pc} pioneers. Target: $${WIN_TARGET.toLocaleString()}.`, '#C8A84A');
  };

  // ── Actions ─────────────────────────────────────────────────────
  const handleClaim = () => {
    if (!selectedTile || !selectedTile.revealed || selectedTile.owner) return;
    const cost = 100;
    const pd = [...playerData];
    if (pd[currentPlayer-1].balance < cost) return;
    pd[currentPlayer-1] = { ...pd[currentPlayer-1], balance: pd[currentPlayer-1].balance - cost };
    setPlayerData(pd);
    updateTile(selectedTile.x, selectedTile.y, { owner: currentPlayer, revealed: true });
    revealAdjacent(selectedTile.x, selectedTile.y);
    addLog(`${PLAYER_NAMES[currentPlayer-1]} claimed (${selectedTile.x},${selectedTile.y}) — $${cost}`, PLAYER_COLORS[currentPlayer-1]);
    setSelectedTile(t => ({ ...t, owner: currentPlayer }));
    advanceTurn(mapData.playerCount);
  };

  const handleDrill = () => {
    if (!selectedTile || selectedTile.owner !== currentPlayer) return;
    const costs = [0, 50, 150, 300];
    const cost = costs[selectedTile.drillLevel];
    const pd = [...playerData];
    if (pd[currentPlayer-1].balance < cost) return;
    pd[currentPlayer-1] = { ...pd[currentPlayer-1], balance: pd[currentPlayer-1].balance - cost };
    setPlayerData(pd);
    const newDrill = selectedTile.drillLevel + 1;
    updateTile(selectedTile.x, selectedTile.y, { drillLevel: newDrill });
    setSelectedTile(t => ({ ...t, drillLevel: newDrill }));
    addLog(`${PLAYER_NAMES[currentPlayer-1]} drilled (${selectedTile.x},${selectedTile.y}) → depth ${newDrill} — $${cost}`, PLAYER_COLORS[currentPlayer-1]);
    advanceTurn(mapData.playerCount);
  };

  const handleSell = () => {
    if (!selectedTile || selectedTile.owner !== currentPlayer) return;
    const { resource, drillLevel } = selectedTile;
    if (!resource || drillLevel === 0) return;
    const value = RESOURCE_VALUE[resource] * drillLevel;
    const pd = [...playerData];
    pd[currentPlayer-1] = {
      ...pd[currentPlayer-1],
      balance: pd[currentPlayer-1].balance + value,
      resources: {
        ...pd[currentPlayer-1].resources,
        [resource]: pd[currentPlayer-1].resources[resource] + drillLevel,
      }
    };
    setPlayerData(pd);
    updateTile(selectedTile.x, selectedTile.y, { resource: null, drillLevel: 0 });
    setSelectedTile(t => ({ ...t, resource: null, drillLevel: 0 }));
    const newBalance = pd[currentPlayer-1].balance;
    addLog(`${PLAYER_NAMES[currentPlayer-1]} sold ${RESOURCE_ICON[resource].label} ×${drillLevel} → +$${value}`, PLAYER_COLORS[currentPlayer-1]);
    if (newBalance >= WIN_TARGET) {
      setWinner(currentPlayer);
      addLog(`⬛ ${PLAYER_NAMES[currentPlayer-1]} REACHED $${WIN_TARGET.toLocaleString()} — SURVEY COMPLETE`, PLAYER_COLORS[currentPlayer-1]);
    } else {
      advanceTurn(mapData.playerCount);
    }
  };

  // ── Tile click ───────────────────────────────────────────────────
  const handleTileClick = useCallback((tile) => {
    setSelectedTile(tile);
  }, []);

  // Sync selected tile with tiles array (for updated state)
  const syncedSelected = selectedTile
    ? tiles.find(t => t.x === selectedTile.x && t.y === selectedTile.y) || selectedTile
    : null;

  // ═══════════════════════════════════════════════════════════════
  //  SETUP SCREEN
  // ═══════════════════════════════════════════════════════════════
  if (phase === 'setup') {
    return (
      <div style={{
        minHeight:'100vh', background:'#080806',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:"'Courier New',monospace",
      }}>
        <style>{`
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          @keyframes scanline {
            0% { transform: translateY(-100%) }
            100% { transform: translateY(100vh) }
          }
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: #0A0A07; }
          ::-webkit-scrollbar-thumb { background: #2A2A1A; }
        `}</style>

        {/* Scanline effect */}
        <div style={{
          position:'fixed', inset:0, pointerEvents:'none', overflow:'hidden', zIndex:0,
          background:'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
        }} />

        <div style={{
          position:'relative', zIndex:1,
          border:'1px solid #3A3A20', background:'#0D0D09',
          padding:'40px 48px', maxWidth:480, width:'100%',
          boxShadow:'0 0 60px #C8A84A18, inset 0 0 60px #00000088',
        }}>
          <div style={{ textAlign:'center', marginBottom:32 }}>
            <div style={{ color:'#3A3A28', fontSize:11, letterSpacing:4, marginBottom:8 }}>GEOLOGICAL SURVEY SYSTEM v0.2</div>
            <div style={{ color:'#C8A84A', fontSize:26, fontWeight:'bold', letterSpacing:3, lineHeight:1.2,
              textShadow:'0 0 20px #C8A84A66' }}>
              GEO-STRAT<br/>
              <span style={{ fontSize:14, letterSpacing:6, color:'#8A7040' }}>EXPLORATION</span>
            </div>
            <div style={{ marginTop:12, color:'#4A4A38', fontSize:10, letterSpacing:2 }}>
              PHASE II — SURVEY INTERFACE
            </div>
          </div>

          {[
            { label:'SEED CODE', value:seedInput, set:setSeedInput, type:'text', ph:'e.g. ALASKA-DRILL-42' },
          ].map(f => (
            <div key={f.label} style={{ marginBottom:16 }}>
              <div style={{ color:'#6A6050', fontSize:10, letterSpacing:2, marginBottom:4 }}>{f.label}</div>
              <input
                value={f.value} onChange={e => f.set(e.target.value)}
                placeholder={f.ph}
                style={{
                  width:'100%', background:'#0A0A07', border:'1px solid #2A2A18',
                  color:'#C8A84A', fontFamily:"'Courier New',monospace", fontSize:12,
                  padding:'8px 10px', outline:'none',
                }}
              />
            </div>
          ))}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:24 }}>
            {[
              { label:'PIONEERS', value:playerCountInput, set:setPlayerCountInput, min:2, max:4 },
              { label:'MAP WIDTH', value:mapWidthInput, set:setMapWidthInput, min:10, max:30 },
              { label:'MAP HEIGHT', value:mapHeightInput, set:setMapHeightInput, min:10, max:30 },
            ].map(f => (
              <div key={f.label}>
                <div style={{ color:'#6A6050', fontSize:9, letterSpacing:1.5, marginBottom:4 }}>{f.label}</div>
                <input
                  type="number" min={f.min} max={f.max}
                  value={f.value} onChange={e => f.set(Number(e.target.value))}
                  style={{
                    width:'100%', background:'#0A0A07', border:'1px solid #2A2A18',
                    color:'#C8A84A', fontFamily:"'Courier New',monospace", fontSize:12,
                    padding:'7px 8px', outline:'none',
                  }}
                />
              </div>
            ))}
          </div>

          <div style={{ marginBottom:20, padding:'10px 12px', border:'1px solid #1E1E12', background:'#0A0A07' }}>
            <div style={{ color:'#4A4A38', fontSize:9, letterSpacing:1, marginBottom:6 }}>PIONEER ROSTER</div>
            {Array.from({length:playerCountInput},(_,i)=>(
              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <div style={{ width:8, height:8, background:PLAYER_COLORS[i], borderRadius:'50%' }} />
                <span style={{ color:PLAYER_COLORS[i], fontSize:10 }}>{PLAYER_NAMES[i]}</span>
              </div>
            ))}
          </div>

          <button
            onClick={startGame}
            style={{
              width:'100%', background:'#C8A84A18', border:'2px solid #C8A84A',
              color:'#C8A84A', fontFamily:"'Courier New',monospace",
              fontSize:13, letterSpacing:4, padding:'12px',
              cursor:'pointer', fontWeight:'bold',
              boxShadow:'0 0 20px #C8A84A22',
              transition:'all 0.2s',
            }}
            onMouseEnter={e => { e.target.style.background='#C8A84A33'; e.target.style.boxShadow='0 0 30px #C8A84A44'; }}
            onMouseLeave={e => { e.target.style.background='#C8A84A18'; e.target.style.boxShadow='0 0 20px #C8A84A22'; }}
          >
            INITIATE SURVEY
          </button>

          <div style={{ marginTop:16, color:'#2A2A1A', fontSize:9, textAlign:'center', letterSpacing:1 }}>
            TARGET WEALTH: ${WIN_TARGET.toLocaleString()} · STARTING BALANCE: ${INITIAL_BALANCE.toLocaleString()}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  PLAYING SCREEN
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={{
      minHeight:'100vh', background:'#080806',
      display:'flex', flexDirection:'column',
      fontFamily:"'Courier New',monospace",
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0A0A07; }
        ::-webkit-scrollbar-thumb { background: #2A2A1A; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom:'1px solid #2A2A18', padding:'8px 20px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        background:'#0D0D09',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <span style={{ color:'#C8A84A', fontSize:14, fontWeight:'bold', letterSpacing:3 }}>GEO-STRAT</span>
          <span style={{ color:'#3A3A28', fontSize:10 }}>SEED: {mapData?.seed}</span>
          <span style={{ color:'#3A3A28', fontSize:10 }}>{mapData?.width}×{mapData?.height}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <span style={{ color:PLAYER_COLORS[currentPlayer-1], fontSize:11, fontWeight:'bold', animation:'pulse 1.5s infinite' }}>
            ▶ {PLAYER_NAMES[currentPlayer-1]}
          </span>
          <span style={{ color:'#4A4A38', fontSize:10 }}>TURN {turn}</span>
          <button
            onClick={() => setShowResources(r => !r)}
            style={{
              background:'transparent', border:'1px solid #2A2A18',
              color:'#6A6050', fontFamily:"'Courier New',monospace",
              fontSize:9, padding:'3px 8px', cursor:'pointer', letterSpacing:1,
            }}
          >
            {showResources ? 'HIDE' : 'SHOW'} RES
          </button>
          <button
            onClick={() => setPhase('setup')}
            style={{
              background:'transparent', border:'1px solid #2A2A18',
              color:'#6A6050', fontFamily:"'Courier New',monospace",
              fontSize:9, padding:'3px 8px', cursor:'pointer', letterSpacing:1,
            }}
          >
            NEW GAME
          </button>
        </div>
      </div>

      {/* Winner banner */}
      {winner && (
        <div style={{
          background: PLAYER_COLORS[winner-1] + '22',
          border: `2px solid ${PLAYER_COLORS[winner-1]}`,
          color: PLAYER_COLORS[winner-1],
          textAlign:'center', padding:'16px',
          fontSize:16, fontWeight:'bold', letterSpacing:4,
          boxShadow: `0 0 40px ${PLAYER_COLORS[winner-1]}44`,
        }}>
          ⬛ SURVEY COMPLETE — {PLAYER_NAMES[winner-1]} WINS ⬛
        </div>
      )}

      {/* Main layout */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* Left sidebar — players */}
        <div style={{
          width:200, borderRight:'1px solid #1E1E12',
          padding:'12px 10px', overflowY:'auto',
          background:'#0A0A07', flexShrink:0,
        }}>
          <div style={{ color:'#3A3A28', fontSize:9, letterSpacing:2, marginBottom:10 }}>PIONEER ROSTER</div>
          {playerData.map((pd, i) => (
            <PlayerCard
              key={i}
              player={i+1}
              isActive={currentPlayer === i+1}
              balance={pd.balance}
              resources={pd.resources}
              claimCount={tiles.filter(t=>t.owner===i+1).length}
            />
          ))}

          {/* Legend */}
          <div style={{ marginTop:16, borderTop:'1px solid #1E1E12', paddingTop:12 }}>
            <div style={{ color:'#3A3A28', fontSize:9, letterSpacing:2, marginBottom:8 }}>MAP LEGEND</div>
            <TerrainLegend />
          </div>
        </div>

        {/* Center — board */}
        <div style={{ flex:1, overflow:'auto', padding:'20px', display:'flex', alignItems:'flex-start', justifyContent:'center' }}>
          {mapData && (
            <IsometricBoard
              mapData={{ ...mapData, tiles }}
              selectedTile={syncedSelected}
              hoveredTile={hoveredTile}
              onTileClick={handleTileClick}
              onTileHover={setHoveredTile}
              showResources={showResources}
            />
          )}
        </div>

        {/* Right sidebar — actions + log + hover */}
        <div style={{
          width:220, borderLeft:'1px solid #1E1E12',
          padding:'12px 10px', display:'flex', flexDirection:'column', gap:10,
          background:'#0A0A07', flexShrink:0, overflowY:'auto',
        }}>
          <div style={{ color:'#3A3A28', fontSize:9, letterSpacing:2 }}>ACTION CONSOLE</div>

          <ActionPanel
            selectedTile={syncedSelected}
            currentPlayer={currentPlayer}
            onClaim={handleClaim}
            onDrill={handleDrill}
            onSell={handleSell}
            playerData={playerData}
          />

          {/* Hovered tile info */}
          {hoveredTile && (
            <div style={{ border:'1px solid #1E1E12', background:'#0D0D0A', padding:'8px 10px', fontSize:10 }}>
              <div style={{ color:'#4A4A38', fontSize:9, marginBottom:4 }}>CURSOR ({hoveredTile.x},{hoveredTile.y})</div>
              <div style={{ color:'#6A6050' }}>{TERRAIN_STYLE[hoveredTile.terrain].label}</div>
              {hoveredTile.revealed && hoveredTile.resource && (
                <div style={{ color: RESOURCE_ICON[hoveredTile.resource].color, marginTop:2 }}>
                  {RESOURCE_ICON[hoveredTile.resource].icon} {RESOURCE_ICON[hoveredTile.resource].label}
                </div>
              )}
              <div style={{ color:'#3A3A28', marginTop:2 }}>
                DEPTH {hoveredTile.drillLevel}/{hoveredTile.maxDepth}
              </div>
            </div>
          )}

          {/* Target progress */}
          <div style={{ border:'1px solid #1E1E12', background:'#0D0D0A', padding:'8px 10px' }}>
            <div style={{ color:'#4A4A38', fontSize:9, letterSpacing:1, marginBottom:6 }}>WEALTH RACE — TARGET ${WIN_TARGET.toLocaleString()}</div>
            {playerData.map((pd, i) => {
              const total = pd.balance + Object.entries(pd.resources).reduce((s,[r,q])=>s+q*RESOURCE_VALUE[r],0);
              const pct = Math.min(100, (total / WIN_TARGET) * 100);
              return (
                <div key={i} style={{ marginBottom:6 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                    <span style={{ color:PLAYER_COLORS[i], fontSize:9 }}>{PLAYER_NAMES[i]}</span>
                    <span style={{ color:'#6A6050', fontSize:9 }}>${total.toLocaleString()}</span>
                  </div>
                  <div style={{ height:4, background:'#1A1A12', position:'relative' }}>
                    <div style={{
                      height:'100%', width:`${pct}%`,
                      background:PLAYER_COLORS[i],
                      boxShadow:`0 0 4px ${PLAYER_COLORS[i]}88`,
                      transition:'width 0.4s',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ color:'#3A3A28', fontSize:9, letterSpacing:2 }}>ACTIVITY LOG</div>
          <GameLog entries={log} />
        </div>
      </div>
    </div>
  );
}
