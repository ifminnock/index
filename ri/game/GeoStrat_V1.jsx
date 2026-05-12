import { useState, useCallback, useEffect, useRef, useReducer } from "react";

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 1 — MAP ENGINE (inlined)
// ═══════════════════════════════════════════════════════════════════════════

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

function makePRNG(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  let s = (h >>> 0) + 1;
  return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const GRAD3 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
function dot2(g, x, y) { return g[0]*x + g[1]*y; }
function buildSimplex(rng) {
  const p = Array.from({length:256},(_,i)=>i);
  for (let i=255;i>0;i--) { const j=Math.floor(rng()*(i+1)); [p[i],p[j]]=[p[j],p[i]]; }
  const perm=new Uint8Array(512), permMod12=new Uint8Array(512);
  for (let i=0;i<512;i++) { perm[i]=p[i&255]; permMod12[i]=perm[i]%12; }
  const F2=0.5*(Math.sqrt(3)-1), G2=(3-Math.sqrt(3))/6;
  return (xin,yin) => {
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
function noiseToTerrain(n){ const {unconsolidated,sedimentary,metamorphic}=MAP_CONFIG.terrain.thresholds; if(n<unconsolidated)return'unconsolidated'; if(n<sedimentary)return'sedimentary'; if(n<metamorphic)return'metamorphic'; return'igneous'; }
function rollResource(terrain,pb,r1,r2){ const nb=MAP_CONFIG.resources.nullBias[terrain],st=MAP_CONFIG.resources.spawnChance[terrain]; const sup=1-MAP_CONFIG.clustering.provinceStrength+MAP_CONFIG.clustering.provinceStrength*pb; if(r1<nb*(2-sup))return null; let cum=0; const roll=r2*sup; for(const[res,w]of Object.entries(st)){cum+=w;if(roll<cum)return res;} return null; }
function enforceDepthTier(res,md){ if(res===null)return null; const tier=MAP_CONFIG.resources.depthTiers[res]; if(tier<=md)return res; const fb={rare_ore:'common_ore',hydrocarbon:'common_ore',common_ore:'stone'}; return enforceDepthTier(fb[res]??null,md); }

function generateMap(seed, width=16, height=16, playerCount=2) {
  const s=String(seed);
  const nT=buildSimplex(makePRNG(s+':terrain')),nRo=buildSimplex(makePRNG(s+':roughness'));
  const nRes=buildSimplex(makePRNG(s+':resource')),nPr=buildSimplex(makePRNG(s+':province'));
  const rngSt=makePRNG(s+':start');
  const {terrainScale,roughnessScale,resourceScale}=MAP_CONFIG.noise,{provinceScale}=MAP_CONFIG.clustering,rw=MAP_CONFIG.terrain.roughness;
  const tiles=[];
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const terrain=noiseToTerrain(clamp(nT(x*terrainScale,y*terrainScale)*(1-rw)+nRo(x*roughnessScale,y*roughnessScale)*rw,-1,1));
    const maxDepth=MAP_CONFIG.maxDepth[terrain];
    const pb=(nPr(x*provinceScale,y*provinceScale)+1)/2;
    const resource=enforceDepthTier(rollResource(terrain,pb,(nRes(x*resourceScale,y*resourceScale)+1)/2,(nRes(x*resourceScale+100,y*resourceScale+100)+1)/2),maxDepth);
    tiles.push({x,y,terrain,resource,maxDepth,depth:0,owner:null,drillLevel:0,revealed:false,depleted:false});
  }
  const margin=Math.floor(Math.min(width,height)*0.15);
  const quads=[[margin,margin],[width-1-margin,height-1-margin],[width-1-margin,margin],[margin,height-1-margin]];
  const startPositions=[];
  for(let p=0;p<playerCount;p++){
    const[qx,qy]=quads[p%4],jitter=Math.floor(margin*0.4);
    startPositions.push({player:p+1,x:clamp(qx+Math.floor((rngSt()-0.5)*2*jitter),0,width-1),y:clamp(qy+Math.floor((rngSt()-0.5)*2*jitter),0,height-1)});
  }
  for(const sp of startPositions){ const tile=tiles[sp.y*width+sp.x]; tile.resource=null; tile.revealed=true; tile.owner=sp.player; }
  return {tiles,startPositions,seed:s,width,height,playerCount};
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const PLAYER_COLORS = ["#D4A843","#4ECDC4","#FF6B6B","#A8E063"];
const PLAYER_NAMES  = ["PIONEER-1","PIONEER-2","PIONEER-3","PIONEER-4"];
const TERRAIN_STYLE = {
  unconsolidated:{ base:"#2A2218", label:"UNCONSOLIDATED" },
  sedimentary:   { base:"#1E2A20", label:"SEDIMENTARY" },
  metamorphic:   { base:"#1A1E2A", label:"METAMORPHIC" },
  igneous:       { base:"#2A1A1A", label:"IGNEOUS" },
};
const RESOURCE_ICON = {
  stone:      { icon:"◈", color:"#8A8070", label:"STONE" },
  common_ore: { icon:"⬡", color:"#7FB3D3", label:"COM.ORE" },
  rare_ore:   { icon:"✦", color:"#E8C44A", label:"RARE ORE" },
  hydrocarbon:{ icon:"⬟", color:"#6BC49A", label:"H.CARBON" },
};
const RESOURCE_VALUE = { stone:10, common_ore:50, rare_ore:200, hydrocarbon:500 };

// ── Game constants ───────────────────────────────────────────────────────────
const INITIAL_BALANCE = 600;
const WIN_TARGET = 2500;
const CLAIM_COST = 100;
const DRILL_COSTS = [50, 150, 300];   // cost to advance from depth 0→1, 1→2, 2→3
const ACTIONS_PER_TURN = 2;           // actions each player gets per turn

// ── Turn phases ──────────────────────────────────────────────────────────────
// CLAIM  → player may claim 1 unclaimed tile (costs $)
// ACTION → player spends up to ACTIONS_PER_TURN on drill/sell/trade/pass
// RESOLUTION → market fluctuates, reveal check, advance player
const PHASES = { CLAIM:'CLAIM', ACTION:'ACTION', RESOLUTION:'RESOLUTION', GAMEOVER:'GAMEOVER' };

// ── Market volatility (applied each resolution) ──────────────────────────────
// Base prices fluctuate ±10% each round
const BASE_PRICES = { stone:10, common_ore:50, rare_ore:200, hydrocarbon:500 };

// ═══════════════════════════════════════════════════════════════════════════
//  GAME STATE REDUCER
// ═══════════════════════════════════════════════════════════════════════════

function initPlayerData(count) {
  return Array.from({length:count}, () => ({
    balance: INITIAL_BALANCE,
    inventory: { stone:0, common_ore:0, rare_ore:0, hydrocarbon:0 },
    actionsLeft: ACTIONS_PER_TURN,
    hasClaimed: false,     // used during CLAIM phase
    tradeOffers: [],       // pending offers this player has sent
  }));
}

function revealRing(tiles, width, height, cx, cy) {
  const ADJ = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  return tiles.map(t => {
    const near = ADJ.some(([dx,dy]) => t.x===cx+dx && t.y===cy+dy);
    return near ? {...t, revealed:true} : t;
  });
}

function portfolioValue(pd, prices) {
  return pd.balance + Object.entries(pd.inventory).reduce((s,[r,q])=>s+q*(prices[r]||0),0);
}

function tickMarket(prices, rng) {
  const next = {};
  for (const [r, base] of Object.entries(BASE_PRICES)) {
    const current = prices[r];
    const drift = (rng() - 0.5) * 0.20; // ±10%
    const raw = current * (1 + drift);
    // Mean-revert toward base price so market doesn't diverge
    const reverted = raw * 0.85 + base * 0.15;
    next[r] = Math.max(Math.round(base * 0.4), Math.round(reverted));
  }
  return next;
}

const initState = (mapData, playerCount) => ({
  tiles: (() => {
    let t = mapData.tiles.map(x=>({...x}));
    for (const sp of mapData.startPositions) {
      t = revealRing(t, mapData.width, mapData.height, sp.x, sp.y);
    }
    return t;
  })(),
  players: initPlayerData(playerCount),
  currentPlayer: 0,     // 0-indexed
  phase: PHASES.CLAIM,
  round: 1,
  turn: 1,              // global action counter
  log: [],
  prices: {...BASE_PRICES},
  priceHistory: [Object.values(BASE_PRICES)],
  winner: null,
  tradeModal: null,     // { type:'offer'|'incoming', offer:{...} }
  pendingTrades: [],    // [{ id, from, to, give:{res,qty}, want:{res,qty}, cash }]
  nextTradeId: 1,
  marketEvents: [],     // recent market event strings
  mapData,
});

function addLog(state, text, color) {
  return { ...state, log: [...state.log.slice(-80), { text, color, turn:state.turn }] };
}

function gameReducer(state, action) {
  switch(action.type) {

    // ── CLAIM PHASE ─────────────────────────────────────────────────────────
    case 'CLAIM_TILE': {
      const {x, y} = action;
      const cp = state.currentPlayer;
      const pd = state.players[cp];
      const tile = state.tiles.find(t=>t.x===x&&t.y===y);
      if (!tile || !tile.revealed || tile.owner !== null || pd.hasClaimed || pd.balance < CLAIM_COST) return state;

      let tiles = state.tiles.map(t => t.x===x&&t.y===y ? {...t, owner:cp+1} : t);
      tiles = revealRing(tiles, state.mapData.width, state.mapData.height, x, y);
      const players = state.players.map((p,i) => i===cp ? {...p, balance:p.balance-CLAIM_COST, hasClaimed:true} : p);
      let s = {...state, tiles, players};
      s = addLog(s, `${PLAYER_NAMES[cp]} claimed (${x},${y}) [${TERRAIN_STYLE[tile.terrain].label}] — $${CLAIM_COST}`, PLAYER_COLORS[cp]);
      return s;
    }

    case 'SKIP_CLAIM': {
      return addLog({...state}, `${PLAYER_NAMES[state.currentPlayer]} skipped claim.`, '#4A4A38');
    }

    case 'ADVANCE_TO_ACTION': {
      const cp = state.currentPlayer;
      const players = state.players.map((p,i) => i===cp ? {...p, actionsLeft:ACTIONS_PER_TURN} : p);
      return {...state, players, phase:PHASES.ACTION};
    }

    // ── ACTION PHASE ────────────────────────────────────────────────────────
    case 'DRILL': {
      const {x, y} = action;
      const cp = state.currentPlayer;
      const pd = state.players[cp];
      if (pd.actionsLeft < 1) return state;
      const tile = state.tiles.find(t=>t.x===x&&t.y===y);
      if (!tile || tile.owner!==cp+1 || tile.drillLevel>=tile.maxDepth || tile.depleted) return state;
      const cost = DRILL_COSTS[tile.drillLevel] || 0;
      if (pd.balance < cost) return state;

      const newDrill = tile.drillLevel + 1;
      const tiles = state.tiles.map(t => t.x===x&&t.y===y ? {...t, drillLevel:newDrill} : t);
      const players = state.players.map((p,i) => i===cp ? {...p, balance:p.balance-cost, actionsLeft:p.actionsLeft-1} : p);
      let s = {...state, tiles, players, turn:state.turn+1};
      s = addLog(s, `${PLAYER_NAMES[cp]} drilled (${x},${y}) → depth ${newDrill} — $${cost}`, PLAYER_COLORS[cp]);
      return s;
    }

    case 'EXTRACT': {
      // Sell to bank: extract resource from drilled tile at current market price
      const {x, y} = action;
      const cp = state.currentPlayer;
      const pd = state.players[cp];
      if (pd.actionsLeft < 1) return state;
      const tile = state.tiles.find(t=>t.x===x&&t.y===y);
      if (!tile || tile.owner!==cp+1 || !tile.resource || tile.drillLevel===0 || tile.depleted) return state;

      const qty = tile.drillLevel;
      const unitPrice = state.prices[tile.resource];
      const value = qty * unitPrice;
      const tiles = state.tiles.map(t => t.x===x&&t.y===y ? {...t, depleted:true, resource:null, drillLevel:0} : t);
      const players = state.players.map((p,i) => i===cp
        ? {...p, balance:p.balance+value, actionsLeft:p.actionsLeft-1,
            inventory:{...p.inventory,[tile.resource]:p.inventory[tile.resource]+qty}}
        : p);
      let s = {...state, tiles, players, turn:state.turn+1};
      s = addLog(s, `${PLAYER_NAMES[cp]} extracted ${RESOURCE_ICON[tile.resource].label}×${qty} → +$${value} @ $${unitPrice}/u`, PLAYER_COLORS[cp]);

      // Win check
      const newTotal = portfolioValue(players[cp], state.prices);
      if (newTotal >= WIN_TARGET) {
        s = {...s, phase:PHASES.GAMEOVER, winner:cp};
        s = addLog(s, `⬛ ${PLAYER_NAMES[cp]} REACHED $${WIN_TARGET.toLocaleString()} — SURVEY COMPLETE`, PLAYER_COLORS[cp]);
      }
      return s;
    }

    case 'SELL_INVENTORY': {
      // Sell a resource from inventory to bank at current price
      const {resource, qty} = action;
      const cp = state.currentPlayer;
      const pd = state.players[cp];
      if (pd.actionsLeft < 1) return state;
      if ((pd.inventory[resource]||0) < qty || qty < 1) return state;
      const value = qty * state.prices[resource];
      const players = state.players.map((p,i) => i===cp
        ? {...p, balance:p.balance+value, actionsLeft:p.actionsLeft-1,
            inventory:{...p.inventory,[resource]:p.inventory[resource]-qty}}
        : p);
      let s = {...state, players, turn:state.turn+1};
      s = addLog(s, `${PLAYER_NAMES[cp]} sold ${RESOURCE_ICON[resource].label}×${qty} from inventory → +$${value}`, PLAYER_COLORS[cp]);

      const newTotal = portfolioValue(players[cp], state.prices);
      if (newTotal >= WIN_TARGET) { s={...s,phase:PHASES.GAMEOVER,winner:cp}; s=addLog(s,`⬛ ${PLAYER_NAMES[cp]} WINS`,PLAYER_COLORS[cp]); }
      return s;
    }

    case 'PASS_ACTION': {
      const cp = state.currentPlayer;
      const players = state.players.map((p,i)=>i===cp?{...p,actionsLeft:0}:p);
      let s = addLog({...state,players}, `${PLAYER_NAMES[cp]} passed remaining actions.`, '#4A4A38');
      return s;
    }

    // ── TRADE SYSTEM ─────────────────────────────────────────────────────────
    case 'SEND_TRADE_OFFER': {
      const {to, giveRes, giveQty, wantRes, wantQty, cashBonus} = action;
      const cp = state.currentPlayer;
      const pd = state.players[cp];
      // Validate sender has what they're offering
      if (giveRes && (pd.inventory[giveRes]||0) < giveQty) return state;
      if (cashBonus > 0 && pd.balance < cashBonus) return state;

      const offer = {id:state.nextTradeId, from:cp, to, giveRes, giveQty:giveQty||0, wantRes, wantQty:wantQty||0, cashBonus:cashBonus||0};
      let s = {...state, pendingTrades:[...state.pendingTrades, offer], nextTradeId:state.nextTradeId+1, turn:state.turn+1};
      const giveStr = giveRes ? `${RESOURCE_ICON[giveRes].label}×${giveQty}` : '';
      const cashStr = cashBonus>0 ? `+$${cashBonus}` : '';
      const wantStr = wantRes ? `${RESOURCE_ICON[wantRes].label}×${wantQty}` : '';
      s = addLog(s, `${PLAYER_NAMES[cp]} offered ${[giveStr,cashStr].filter(Boolean).join(' ')} → ${PLAYER_NAMES[to]} for ${wantStr||'goodwill'}`, '#AA9944');
      return s;
    }

    case 'ACCEPT_TRADE': {
      const {offerId} = action;
      const cp = state.currentPlayer;
      const offer = state.pendingTrades.find(o=>o.id===offerId);
      if (!offer || offer.to!==cp) return state;
      const pd = state.players[cp];
      const from = state.players[offer.from];
      // Validate both sides still have what was offered
      if (offer.wantRes && (pd.inventory[offer.wantRes]||0) < offer.wantQty) return state;
      if (offer.giveRes && (from.inventory[offer.giveRes]||0) < offer.giveQty) return state;
      if (offer.cashBonus > 0 && from.balance < offer.cashBonus) return state;

      const players = state.players.map((p,i) => {
        if (i===offer.from) return {
          ...p,
          balance: p.balance - offer.cashBonus + (offer.wantRes ? 0 : 0),
          inventory: {
            ...p.inventory,
            ...(offer.giveRes?{[offer.giveRes]:p.inventory[offer.giveRes]-offer.giveQty}:{}),
            ...(offer.wantRes?{[offer.wantRes]:p.inventory[offer.wantRes]+offer.wantQty}:{}),
          }
        };
        if (i===cp) return {
          ...p,
          balance: p.balance + offer.cashBonus,
          inventory: {
            ...p.inventory,
            ...(offer.wantRes?{[offer.wantRes]:p.inventory[offer.wantRes]-offer.wantQty}:{}),
            ...(offer.giveRes?{[offer.giveRes]:p.inventory[offer.giveRes]+offer.giveQty}:{}),
          }
        };
        return p;
      });
      const pendingTrades = state.pendingTrades.filter(o=>o.id!==offerId);
      let s = {...state, players, pendingTrades, turn:state.turn+1};
      s = addLog(s, `✓ TRADE: ${PLAYER_NAMES[offer.from]} ↔ ${PLAYER_NAMES[cp]}`, '#A8E063');
      return s;
    }

    case 'REJECT_TRADE': {
      const {offerId} = action;
      const offer = state.pendingTrades.find(o=>o.id===offerId);
      const pendingTrades = state.pendingTrades.filter(o=>o.id!==offerId);
      let s = {...state, pendingTrades};
      if (offer) s = addLog(s, `✗ ${PLAYER_NAMES[state.currentPlayer]} rejected trade from ${PLAYER_NAMES[offer.from]}.`, '#FF6B6B');
      return s;
    }

    // ── RESOLUTION ───────────────────────────────────────────────────────────
    case 'RESOLVE': {
      // Expire pending trades older than 2 rounds, tick market, advance player
      const playerCount = state.players.length;
      const nextPlayer = (state.currentPlayer + 1) % playerCount;
      const isEndOfRound = nextPlayer === 0;

      let prices = state.prices;
      let priceHistory = state.priceHistory;
      let marketEvents = [];

      if (isEndOfRound) {
        const rng = makePRNG(`market:${state.round}:${state.mapData.seed}`);
        prices = tickMarket(prices, rng);
        priceHistory = [...priceHistory.slice(-12), Object.values(prices)];
        // Narrative market event
        const events = [
          `Global demand spike: HYDROCARBON +${Math.round((prices.hydrocarbon/state.prices.hydrocarbon-1)*100)}%`,
          `Ore market shift: RARE ORE ${prices.rare_ore > state.prices.rare_ore?'▲':'▼'} $${Math.abs(prices.rare_ore-state.prices.rare_ore)}/u`,
          `Bulk commodity report: STONE @ $${prices.stone}/u`,
          `Futures report: COM.ORE ${prices.common_ore>state.prices.common_ore?'▲':'▼'} to $${prices.common_ore}/u`,
        ];
        marketEvents = [events[Math.floor(rng()*events.length)]];
      }

      // Expire stale pending trades
      const pendingTrades = isEndOfRound
        ? state.pendingTrades.filter(o => (state.round - (o.round||state.round)) < 2)
        : state.pendingTrades;

      const players = state.players.map((p,i) => i===state.currentPlayer
        ? {...p, hasClaimed:false, actionsLeft:ACTIONS_PER_TURN}
        : p);

      let s = {
        ...state, players, prices, priceHistory, pendingTrades, marketEvents,
        currentPlayer: nextPlayer,
        phase: PHASES.CLAIM,
        round: isEndOfRound ? state.round+1 : state.round,
      };

      if (isEndOfRound && marketEvents.length > 0) {
        s = addLog(s, `📊 MARKET: ${marketEvents[0]}`, '#C8A84A');
      }
      s = addLog(s, `— Round ${s.round}, ${PLAYER_NAMES[nextPlayer]}'s turn —`, '#3A3A28');
      return s;
    }

    case 'SET_TRADE_MODAL':
      return {...state, tradeModal: action.modal};

    default:
      return state;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ISOMETRIC BOARD
// ═══════════════════════════════════════════════════════════════════════════

function IsometricBoard({ state, onTileClick, onTileHover, hoveredTile, selectedTile, showResources }) {
  const { tiles, mapData } = state;
  const TW = 52, TH = 26;

  const allSx = tiles.map(t=>(t.x-t.y)*(TW/2));
  const allSy = tiles.map(t=>(t.x+t.y)*(TH/2));
  const minX=Math.min(...allSx)-TW/2, minY=Math.min(...allSy)-40;
  const maxX=Math.max(...allSx)+TW/2, maxY=Math.max(...allSy)+TH+20;
  const svgW=maxX-minX+20, svgH=maxY-minY+20, ox=-minX+10, oy=-minY+10;

  const sorted = [...tiles].sort((a,b)=>(a.x+a.y)-(b.x+b.y));

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{display:'block',margin:'0 auto'}}>
      <defs>
        <radialGradient id="fog"><stop offset="0%" stopColor="#1A1A12" stopOpacity="0.3"/><stop offset="100%" stopColor="#050504" stopOpacity="0.9"/></radialGradient>
        <filter id="sel"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <g transform={`translate(${ox},${oy})`}>
        {sorted.map(tile => {
          const {x,y,terrain,resource,owner,drillLevel,revealed,depleted,maxDepth} = tile;
          const d = drillLevel*3;
          const sx=(x-y)*(TW/2), sy=(x+y)*(TH/2);
          const ts=TERRAIN_STYLE[terrain];
          const pc = owner ? PLAYER_COLORS[owner-1] : null;
          const isSel = selectedTile&&selectedTile.x===x&&selectedTile.y===y;
          const isHov = hoveredTile&&hoveredTile.x===x&&hoveredTile.y===y;
          const bc = isSel?'#FFD700': pc||(isHov?'#AA9966':'#232318');
          const bw = isSel?2:isHov?1.5:0.75;
          const rs = resource && !depleted && RESOURCE_ICON[resource];
          const cx2=sx, cy2=sy+TH/2-d;

          const top=`${sx},${sy-d} ${sx+TW/2},${sy+TH/2-d} ${sx},${sy+TH-d} ${sx-TW/2},${sy+TH/2-d}`;
          const left=`${sx-TW/2},${sy+TH/2-d} ${sx},${sy+TH-d} ${sx},${sy+TH} ${sx-TW/2},${sy+TH/2}`;
          const right=`${sx},${sy+TH-d} ${sx+TW/2},${sy+TH/2-d} ${sx+TW/2},${sy+TH/2} ${sx},${sy+TH}`;

          return (
            <g key={`${x}-${y}`} onClick={()=>onTileClick(tile)} onMouseEnter={()=>onTileHover(tile)} onMouseLeave={()=>onTileHover(null)} style={{cursor:'pointer'}}>
              <polygon points={left} fill={pc?pc+'12':'#0B0B08'} stroke={bc} strokeWidth={bw*0.5}/>
              <polygon points={right} fill={pc?pc+'0E':'#131310'} stroke={bc} strokeWidth={bw*0.5}/>
              <polygon points={top} fill={revealed?(depleted?'#141210':(pc?pc+'1E':ts.base)):'#0C0C09'} stroke={bc} strokeWidth={bw}/>
              {revealed && drillLevel>0 && (
                <text x={cx2} y={cy2+4} fontSize={6} fill={pc||'#6A5A34'} textAnchor="middle" fontFamily="monospace" opacity={0.85}>{'▮'.repeat(drillLevel)}</text>
              )}
              {revealed && depleted && (
                <text x={cx2} y={cy2+5} fontSize={8} fill="#3A2A2A" textAnchor="middle" fontFamily="monospace">∅</text>
              )}
              {revealed && showResources && rs && (
                <text x={cx2} y={cy2+(drillLevel>0?-1:5)} fontSize={9} fill={rs.color} textAnchor="middle" fontFamily="monospace" style={{filter:`drop-shadow(0 0 2px ${rs.color}88)`}}>{rs.icon}</text>
              )}
              {!revealed && <polygon points={top} fill="#090908" opacity={0.8}/>}
              {isSel && <polygon points={top} fill="none" stroke="#FFD700" strokeWidth={2} opacity={0.95} filter="url(#sel)"/>}
              {isHov && !isSel && <polygon points={top} fill="#FFD70009" stroke="#AA994466" strokeWidth={1}/>}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MARKET CHART
// ═══════════════════════════════════════════════════════════════════════════

function MarketChart({ priceHistory, prices }) {
  const resources = ['stone','common_ore','rare_ore','hydrocarbon'];
  const colors = ['#8A8070','#7FB3D3','#E8C44A','#6BC49A'];
  const W=180, H=60, pad=4;
  if (priceHistory.length < 2) return null;

  const allVals = priceHistory.flat();
  const lo=Math.min(...allVals)*0.9, hi=Math.max(...allVals)*1.1;
  const px=(v,i)=> pad + (i/(priceHistory.length-1))*(W-2*pad);
  const py=(v)=> H-pad - ((v-lo)/(hi-lo))*(H-2*pad);

  return (
    <div style={{fontFamily:"'Courier New',monospace"}}>
      <div style={{color:'#3A3A28',fontSize:9,letterSpacing:2,marginBottom:6}}>PRICE HISTORY</div>
      <svg width={W} height={H} style={{display:'block',background:'#0A0A07',border:'1px solid #1A1A12'}}>
        {resources.map((r,ri) => {
          const pts = priceHistory.map((row,i)=>`${px(0,i)},${py(row[ri])}`).join(' ');
          return <polyline key={r} points={pts} fill="none" stroke={colors[ri]} strokeWidth={1} opacity={0.8}/>;
        })}
      </svg>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px 8px',marginTop:6}}>
        {resources.map((r,i)=>(
          <div key={r} style={{display:'flex',justifyContent:'space-between',fontSize:9}}>
            <span style={{color:colors[i]}}>{RESOURCE_ICON[r].icon} {RESOURCE_ICON[r].label}</span>
            <span style={{color:'#8A7A50'}}>${prices[r]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TRADE MODAL
// ═══════════════════════════════════════════════════════════════════════════

function TradeModal({ state, dispatch, onClose }) {
  const cp = state.currentPlayer;
  const pd = state.players[cp];
  const [toPlayer, setToPlayer] = useState((cp+1)%state.players.length);
  const [giveRes, setGiveRes] = useState('');
  const [giveQty, setGiveQty] = useState(1);
  const [wantRes, setWantRes] = useState('');
  const [wantQty, setWantQty] = useState(1);
  const [cashBonus, setCashBonus] = useState(0);

  const resources = Object.keys(RESOURCE_ICON);
  const hasInv = resources.filter(r=>(pd.inventory[r]||0)>0);

  const sendOffer = () => {
    if (!giveRes && cashBonus===0) return;
    dispatch({type:'SEND_TRADE_OFFER', to:toPlayer, giveRes:giveRes||null, giveQty:Number(giveQty), wantRes:wantRes||null, wantQty:Number(wantQty), cashBonus:Number(cashBonus)});
    onClose();
  };

  return (
    <div style={{position:'fixed',inset:0,background:'#000000CC',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
      <div style={{background:'#0D0D09',border:'1px solid #3A3A22',padding:24,width:320,fontFamily:"'Courier New',monospace"}}>
        <div style={{color:'#C8A84A',fontSize:13,fontWeight:'bold',letterSpacing:3,marginBottom:16}}>TRADE OFFER</div>

        <div style={{marginBottom:12}}>
          <div style={{color:'#6A6050',fontSize:9,marginBottom:4}}>OFFER TO</div>
          <div style={{display:'flex',gap:6}}>
            {state.players.map((_,i)=>i!==cp&&(
              <button key={i} onClick={()=>setToPlayer(i)} style={{
                background:toPlayer===i?PLAYER_COLORS[i]+'22':'transparent',
                border:`1px solid ${PLAYER_COLORS[i]}${toPlayer===i?'':'44'}`,
                color:PLAYER_COLORS[i],fontFamily:"'Courier New',monospace",fontSize:9,
                padding:'4px 8px',cursor:'pointer',
              }}>{PLAYER_NAMES[i]}</button>
            ))}
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div>
            <div style={{color:'#6A6050',fontSize:9,marginBottom:4}}>YOU GIVE</div>
            <select value={giveRes} onChange={e=>setGiveRes(e.target.value)} style={{width:'100%',background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:10,padding:'4px'}}>
              <option value="">— none —</option>
              {hasInv.map(r=><option key={r} value={r}>{RESOURCE_ICON[r].label} (×{pd.inventory[r]})</option>)}
            </select>
            {giveRes && <input type="number" min={1} max={pd.inventory[giveRes]||1} value={giveQty} onChange={e=>setGiveQty(e.target.value)} style={{width:'100%',marginTop:4,background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:10,padding:'4px'}}/>}
            <div style={{marginTop:6,color:'#6A6050',fontSize:9}}>CASH BONUS</div>
            <input type="number" min={0} max={pd.balance} step={50} value={cashBonus} onChange={e=>setCashBonus(e.target.value)} style={{width:'100%',marginTop:2,background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:10,padding:'4px'}}/>
          </div>
          <div>
            <div style={{color:'#6A6050',fontSize:9,marginBottom:4}}>YOU WANT</div>
            <select value={wantRes} onChange={e=>setWantRes(e.target.value)} style={{width:'100%',background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:10,padding:'4px'}}>
              <option value="">— none —</option>
              {resources.map(r=><option key={r} value={r}>{RESOURCE_ICON[r].label}</option>)}
            </select>
            {wantRes && <input type="number" min={1} value={wantQty} onChange={e=>setWantQty(e.target.value)} style={{width:'100%',marginTop:4,background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:10,padding:'4px'}}/>}
          </div>
        </div>

        <div style={{display:'flex',gap:8}}>
          <button onClick={sendOffer} style={{flex:1,background:'#C8A84A18',border:'1px solid #C8A84A',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:10,padding:'8px',cursor:'pointer',letterSpacing:1}}>SEND OFFER</button>
          <button onClick={onClose} style={{background:'transparent',border:'1px solid #2A2A18',color:'#6A6050',fontFamily:"'Courier New',monospace",fontSize:10,padding:'8px 12px',cursor:'pointer'}}>CANCEL</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PLAYER CARD
// ═══════════════════════════════════════════════════════════════════════════

function PlayerCard({ player, pd, isActive, claimCount, prices }) {
  const color = PLAYER_COLORS[player-1];
  const total = portfolioValue(pd, prices);
  const pct = Math.min(100, (total/WIN_TARGET)*100);
  return (
    <div style={{border:`1px solid ${isActive?color:color+'33'}`,background:isActive?color+'0E':'#0D0D0A',padding:'9px 11px',marginBottom:8,fontFamily:"'Courier New',monospace",position:'relative',transition:'all 0.2s'}}>
      {isActive&&<div style={{position:'absolute',top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${color},transparent)`}}/>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
        <span style={{color,fontSize:10,fontWeight:'bold',letterSpacing:2}}>{PLAYER_NAMES[player-1]}</span>
        {isActive&&<span style={{color,fontSize:8,animation:'pulse 1s infinite'}}>▶ ACTIVE</span>}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
        <span style={{color:'#5A5048',fontSize:9}}>CASH</span>
        <span style={{color:'#C8A84A',fontSize:10}}>${pd.balance.toLocaleString()}</span>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
        <span style={{color:'#5A5048',fontSize:9}}>CLAIMS</span>
        <span style={{color:'#7A7060',fontSize:9}}>{claimCount}</span>
      </div>
      {Object.entries(pd.inventory).filter(([,v])=>v>0).map(([r,qty])=>{
        const rs=RESOURCE_ICON[r];
        return <div key={r} style={{display:'flex',justifyContent:'space-between',fontSize:9,marginBottom:1}}>
          <span style={{color:rs.color}}>{rs.icon} {rs.label}</span>
          <span style={{color:'#7A7060'}}>×{qty} (${qty*prices[r]})</span>
        </div>;
      })}
      <div style={{marginTop:5,borderTop:`1px solid ${color}1A`,paddingTop:4}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
          <span style={{color:'#5A5048',fontSize:9}}>PORTFOLIO</span>
          <span style={{color,fontSize:10,fontWeight:'bold'}}>${total.toLocaleString()}</span>
        </div>
        <div style={{height:3,background:'#1A1A12'}}>
          <div style={{height:'100%',width:`${pct}%`,background:color,boxShadow:`0 0 4px ${color}88`,transition:'width 0.4s'}}/>
        </div>
        <div style={{color:'#3A3A28',fontSize:8,marginTop:2,textAlign:'right'}}>{pct.toFixed(0)}% of $${WIN_TARGET.toLocaleString()}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  ACTION PANEL  (Phase-aware)
// ═══════════════════════════════════════════════════════════════════════════

function Btn({label,sub,disabled,reason,color,onClick,small}) {
  const [h,setH]=useState(false);
  return (
    <button onClick={disabled?undefined:onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} disabled={disabled}
      style={{background:disabled?'#0D0D0A':h?color+'22':'#111109',border:`1px solid ${disabled?'#1E1E12':h?color:color+'55'}`,
        color:disabled?'#2A2A1E':color,fontFamily:"'Courier New',monospace",fontSize:small?8:9,letterSpacing:1,
        padding:small?'4px 8px':'6px 9px',textAlign:'left',cursor:disabled?'not-allowed':'pointer',transition:'all 0.15s',width:'100%'}}>
      <div style={{fontWeight:'bold',fontSize:small?8:10}}>{label}</div>
      <div style={{fontSize:8,opacity:0.65,marginTop:1}}>{disabled&&reason?reason.toUpperCase():sub}</div>
    </button>
  );
}

function ActionPanel({ state, dispatch, selectedTile, onOpenTrade }) {
  const cp = state.currentPlayer;
  const pd = state.players[cp];
  const { phase, prices, pendingTrades, players } = state;
  const tile = selectedTile ? state.tiles.find(t=>t.x===selectedTile.x&&t.y===selectedTile.y) : null;
  const myOffers = pendingTrades.filter(o=>o.to===cp);

  const phaseColor = { CLAIM:'#C8A84A', ACTION:'#4ECDC4', RESOLUTION:'#A8E063', GAMEOVER:'#FF6B6B' };

  // Sell inventory controls
  const [sellRes, setSellRes] = useState('');
  const [sellQty, setSellQty] = useState(1);
  const hasInv = Object.keys(RESOURCE_ICON).filter(r=>(pd.inventory[r]||0)>0);

  return (
    <div style={{fontFamily:"'Courier New',monospace",display:'flex',flexDirection:'column',gap:8}}>

      {/* Phase indicator */}
      <div style={{border:`1px solid ${phaseColor[phase]}44`,background:phaseColor[phase]+'0D',padding:'6px 10px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{color:phaseColor[phase],fontSize:10,fontWeight:'bold',letterSpacing:2}}>{phase} PHASE</span>
          {phase===PHASES.ACTION&&<span style={{color:'#6A6050',fontSize:9}}>ACTIONS: {pd.actionsLeft}/{ACTIONS_PER_TURN}</span>}
        </div>
        {phase===PHASES.ACTION&&(
          <div style={{marginTop:4,height:3,background:'#1A1A12'}}>
            <div style={{height:'100%',width:`${(pd.actionsLeft/ACTIONS_PER_TURN)*100}%`,background:phaseColor[phase],transition:'width 0.3s'}}/>
          </div>
        )}
      </div>

      {/* Incoming trade offers */}
      {myOffers.length > 0 && (
        <div style={{border:'1px solid #AA994444',background:'#0D0D09',padding:'6px 10px'}}>
          <div style={{color:'#AA9944',fontSize:9,letterSpacing:1,marginBottom:6}}>INCOMING OFFERS ({myOffers.length})</div>
          {myOffers.map(offer=>{
            const fromPd = players[offer.from];
            const gStr = offer.giveRes ? `${RESOURCE_ICON[offer.giveRes].label}×${offer.giveQty}` : '';
            const cStr = offer.cashBonus>0 ? `+$${offer.cashBonus}` : '';
            const wStr = offer.wantRes ? `${RESOURCE_ICON[offer.wantRes].label}×${offer.wantQty}` : '';
            return (
              <div key={offer.id} style={{marginBottom:6,paddingBottom:6,borderBottom:'1px solid #1E1E12'}}>
                <div style={{color:PLAYER_COLORS[offer.from],fontSize:9,marginBottom:3}}>{PLAYER_NAMES[offer.from]}</div>
                <div style={{color:'#8A8070',fontSize:9,marginBottom:4}}>
                  Gives: {[gStr,cStr].filter(Boolean).join(', ')||'nothing'}<br/>
                  Wants: {wStr||'nothing'}
                </div>
                <div style={{display:'flex',gap:4}}>
                  <Btn small label="ACCEPT" sub="" disabled={false} color="#A8E063" onClick={()=>dispatch({type:'ACCEPT_TRADE',offerId:offer.id})}/>
                  <Btn small label="REJECT" sub="" disabled={false} color="#FF6B6B" onClick={()=>dispatch({type:'REJECT_TRADE',offerId:offer.id})}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CLAIM PHASE actions */}
      {phase===PHASES.CLAIM && (
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <Btn label="STAKE CLAIM" sub={`$${CLAIM_COST} · select revealed, unclaimed tile`}
            disabled={!tile||tile.revealed===false||tile.owner!==null||pd.hasClaimed||pd.balance<CLAIM_COST}
            reason={!tile?'No tile selected':!tile.revealed?'Unrevealed':tile.owner!==null?'Already claimed':pd.hasClaimed?'Already claimed this round':'Insufficient funds'}
            color="#C8A84A" onClick={()=>dispatch({type:'CLAIM_TILE',x:tile.x,y:tile.y})}/>
          <Btn label={pd.hasClaimed?'PROCEED TO ACTIONS →':'SKIP CLAIM →'} sub={pd.hasClaimed?'Claim done, advance':'Pass on claiming this round'}
            disabled={false} color="#5A5A48"
            onClick={()=>dispatch({type:pd.hasClaimed?'ADVANCE_TO_ACTION':'SKIP_CLAIM'})}/>
          {!pd.hasClaimed&&tile&&!tile.revealed&&<div style={{color:'#3A3A28',fontSize:9,padding:'4px 0'}}>Fog-of-war: tile not revealed. Reveal by claiming adjacent tiles.</div>}
        </div>
      )}

      {/* ACTION PHASE actions */}
      {phase===PHASES.ACTION && (
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {/* Tile actions */}
          {tile && (
            <div style={{border:'1px solid #1E1E12',background:'#0A0A07',padding:'7px 9px',marginBottom:2}}>
              <div style={{color:'#4A4A38',fontSize:8,marginBottom:5}}>SELECTED ({tile.x},{tile.y}) · {TERRAIN_STYLE[tile.terrain].label}</div>
              {tile.revealed&&tile.resource&&!tile.depleted&&(
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
                  <span style={{color:RESOURCE_ICON[tile.resource].color,fontSize:12}}>{RESOURCE_ICON[tile.resource].icon}</span>
                  <div style={{fontSize:9}}>
                    <div style={{color:RESOURCE_ICON[tile.resource].color}}>{RESOURCE_ICON[tile.resource].label}</div>
                    <div style={{color:'#5A5048'}}>${prices[tile.resource]}/u · depth {tile.drillLevel}/{tile.maxDepth}</div>
                  </div>
                </div>
              )}
              {tile.depleted&&<div style={{color:'#3A2A2A',fontSize:9,marginBottom:4}}>∅ DEPLETED</div>}
              <div style={{display:'flex',flexDirection:'column',gap:3}}>
                <Btn label="DRILL" sub={`$${DRILL_COSTS[tile.drillLevel]||0} · advance to depth ${tile.drillLevel+1}`}
                  disabled={!tile||tile.owner!==cp+1||tile.drillLevel>=tile.maxDepth||tile.depleted||pd.actionsLeft<1||pd.balance<(DRILL_COSTS[tile.drillLevel]||0)}
                  reason={tile.owner!==cp+1?'Not your claim':tile.depleted?'Depleted':tile.drillLevel>=tile.maxDepth?'Max depth':pd.actionsLeft<1?'No actions left':'Insufficient funds'}
                  color="#4ECDC4" onClick={()=>dispatch({type:'DRILL',x:tile.x,y:tile.y})}/>
                <Btn label="EXTRACT + SELL" sub={tile.resource&&!tile.depleted&&tile.drillLevel>0?`+$${tile.drillLevel*(prices[tile.resource]||0)} (×${tile.drillLevel} @ $${prices[tile.resource]}/u)`:'Drill first'}
                  disabled={!tile||tile.owner!==cp+1||!tile.resource||tile.drillLevel===0||tile.depleted||pd.actionsLeft<1}
                  reason={tile.owner!==cp+1?'Not your claim':!tile.resource||tile.depleted?'No resource':tile.drillLevel===0?'Must drill first':'No actions left'}
                  color="#A8E063" onClick={()=>dispatch({type:'EXTRACT',x:tile.x,y:tile.y})}/>
              </div>
            </div>
          )}

          {/* Sell from inventory */}
          {hasInv.length > 0 && (
            <div style={{border:'1px solid #1E1E12',background:'#0A0A07',padding:'7px 9px'}}>
              <div style={{color:'#4A4A38',fontSize:8,marginBottom:6}}>SELL FROM INVENTORY</div>
              <div style={{display:'flex',gap:4,marginBottom:4}}>
                <select value={sellRes} onChange={e=>setSellRes(e.target.value)} style={{flex:2,background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:9,padding:'3px'}}>
                  <option value="">select</option>
                  {hasInv.map(r=><option key={r} value={r}>{RESOURCE_ICON[r].label}×{pd.inventory[r]}</option>)}
                </select>
                <input type="number" min={1} max={sellRes?pd.inventory[sellRes]:1} value={sellQty} onChange={e=>setSellQty(Number(e.target.value))} style={{flex:1,background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:9,padding:'3px'}}/>
              </div>
              <Btn label="SELL TO BANK" sub={sellRes?`+$${sellQty*(prices[sellRes]||0)} @ $${prices[sellRes]}/u`:'Select resource'}
                disabled={!sellRes||sellQty<1||(pd.inventory[sellRes]||0)<sellQty||pd.actionsLeft<1}
                reason={!sellRes?'Select resource':pd.actionsLeft<1?'No actions left':'Insufficient inventory'}
                color="#A8E063" onClick={()=>dispatch({type:'SELL_INVENTORY',resource:sellRes,qty:sellQty})}/>
            </div>
          )}

          {/* Trade + Pass */}
          <div style={{display:'flex',gap:4}}>
            <Btn label="TRADE" sub="Offer resources to a pioneer" disabled={state.players.length<2||pd.actionsLeft<1} reason={pd.actionsLeft<1?'No actions left':'Need 2+ players'} color="#AA9944" onClick={onOpenTrade}/>
            <Btn label="PASS" sub="End actions" disabled={false} color="#5A5048" onClick={()=>dispatch({type:'PASS_ACTION'})}/>
          </div>

          {pd.actionsLeft===0 && (
            <Btn label="END TURN →" sub="Advance to next pioneer" disabled={false} color="#C8A84A" onClick={()=>dispatch({type:'RESOLVE'})}/>
          )}
        </div>
      )}

      {/* RESOLUTION auto-advances — show confirm */}
      {phase===PHASES.RESOLUTION && (
        <Btn label="RESOLVE TURN →" sub="Apply market, advance player" disabled={false} color="#C8A84A" onClick={()=>dispatch({type:'RESOLVE'})}/>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  GAME LOG
// ═══════════════════════════════════════════════════════════════════════════

function GameLog({ log }) {
  const ref = useRef(null);
  useEffect(()=>{ if(ref.current) ref.current.scrollTop=ref.current.scrollHeight; },[log]);
  return (
    <div ref={ref} style={{height:130,overflowY:'auto',fontFamily:"'Courier New',monospace",fontSize:9,lineHeight:1.7,padding:'5px 9px',border:'1px solid #1A1A10',background:'#080807',scrollbarWidth:'thin',scrollbarColor:'#2A2A1A #080807'}}>
      {log.map((e,i)=>(
        <div key={i} style={{color:e.color||'#3A3A28',marginBottom:1}}>
          <span style={{color:'#252520'}}>[{String(e.turn).padStart(3,'0')}] </span>{e.text}
        </div>
      ))}
      {log.length===0&&<div style={{color:'#252520'}}>Awaiting first action...</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TERRAIN LEGEND
// ═══════════════════════════════════════════════════════════════════════════

function Legend({ prices }) {
  return (
    <div style={{fontFamily:"'Courier New',monospace",fontSize:9}}>
      <div style={{color:'#3A3A28',fontSize:8,letterSpacing:2,marginBottom:5}}>TERRAIN</div>
      {Object.entries(TERRAIN_STYLE).map(([k,v])=>(
        <div key={k} style={{display:'flex',alignItems:'center',gap:5,marginBottom:3}}>
          <div style={{width:10,height:7,background:v.base,border:'1px solid #2A2A18'}}/>
          <span style={{color:'#4A4A38',fontSize:8}}>{v.label}</span>
        </div>
      ))}
      <div style={{color:'#3A3A28',fontSize:8,letterSpacing:2,marginTop:8,marginBottom:5}}>RESOURCES</div>
      {Object.entries(RESOURCE_ICON).map(([k,v])=>(
        <div key={k} style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
          <span style={{color:v.color}}>{v.icon} {v.label}</span>
          <span style={{color:'#5A5048'}}>${prices[k]}</span>
        </div>
      ))}
      <div style={{marginTop:8,color:'#3A3A28',fontSize:8}}>
        <div>DEPTH COSTS</div>
        {DRILL_COSTS.map((c,i)=><div key={i} style={{color:'#4A4A38'}}>{'▮'.repeat(i+1)} → ${c}</div>)}
        <div style={{marginTop:4}}>CLAIM: ${CLAIM_COST}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETUP SCREEN
// ═══════════════════════════════════════════════════════════════════════════

function SetupScreen({ onStart }) {
  const [seed, setSeed] = useState('ALASKA-DRILL-42');
  const [players, setPlayers] = useState(2);
  const [w, setW] = useState(16);
  const [h, setH] = useState(16);
  const [target, setTarget] = useState(WIN_TARGET);

  return (
    <div style={{minHeight:'100vh',background:'#080806',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Courier New',monospace"}}>
      <div style={{position:'relative',border:'1px solid #3A3A20',background:'#0D0D09',padding:'36px 44px',maxWidth:460,width:'100%',boxShadow:'0 0 60px #C8A84A14,inset 0 0 60px #00000088'}}>
        {/* Scanlines */}
        <div style={{position:'absolute',inset:0,pointerEvents:'none',background:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.12) 2px,rgba(0,0,0,0.12) 4px)',borderRadius:'inherit'}}/>

        <div style={{textAlign:'center',marginBottom:28}}>
          <div style={{color:'#3A3A28',fontSize:10,letterSpacing:4,marginBottom:6}}>GEO-STRAT SURVEY SYSTEM v1.0</div>
          <div style={{color:'#C8A84A',fontSize:24,fontWeight:'bold',letterSpacing:3,textShadow:'0 0 20px #C8A84A55'}}>
            GEOLOGICAL<br/><span style={{fontSize:13,letterSpacing:6,color:'#8A7040'}}>EXPLORATION</span>
          </div>
          <div style={{marginTop:8,color:'#4A4A38',fontSize:9,letterSpacing:2}}>FULL GAME — ALL THREE PHASES</div>
        </div>

        <div style={{marginBottom:14}}>
          <div style={{color:'#6A6050',fontSize:9,letterSpacing:2,marginBottom:3}}>SEED CODE</div>
          <input value={seed} onChange={e=>setSeed(e.target.value)} placeholder="any text or number" style={{width:'100%',background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:11,padding:'7px 9px',outline:'none'}}/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:20}}>
          {[
            {label:'PIONEERS',val:players,set:setPlayers,min:2,max:4},
            {label:'WIDTH',val:w,set:setW,min:10,max:28},
            {label:'HEIGHT',val:h,set:setH,min:10,max:28},
            {label:'TARGET $',val:target,set:setTarget,min:1000,max:10000,step:500},
          ].map(f=>(
            <div key={f.label}>
              <div style={{color:'#5A5048',fontSize:8,letterSpacing:1,marginBottom:3}}>{f.label}</div>
              <input type="number" min={f.min} max={f.max} step={f.step||1} value={f.val} onChange={e=>f.set(Number(e.target.value))} style={{width:'100%',background:'#0A0A07',border:'1px solid #2A2A18',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:11,padding:'6px 7px',outline:'none'}}/>
            </div>
          ))}
        </div>

        <div style={{marginBottom:20,padding:'9px 11px',border:'1px solid #1E1E12',background:'#0A0A07'}}>
          <div style={{color:'#3A3A28',fontSize:8,letterSpacing:1,marginBottom:5}}>PIONEER ROSTER</div>
          {Array.from({length:players},(_,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
              <div style={{width:7,height:7,background:PLAYER_COLORS[i],borderRadius:'50%'}}/>
              <span style={{color:PLAYER_COLORS[i],fontSize:9}}>{PLAYER_NAMES[i]}</span>
              <span style={{color:'#3A3A28',fontSize:8,marginLeft:'auto'}}>${INITIAL_BALANCE} starting</span>
            </div>
          ))}
        </div>

        <div style={{marginBottom:12,padding:'8px 10px',border:'1px solid #1E1E12',background:'#0A0A07',fontSize:9,color:'#5A5048',lineHeight:1.7}}>
          <span style={{color:'#C8A84A'}}>CLAIM</span> → stake a tile ($100) ·{' '}
          <span style={{color:'#4ECDC4'}}>DRILL</span> → extract at depth ·{' '}
          <span style={{color:'#A8E063'}}>EXTRACT</span> → sell at market price ·{' '}
          <span style={{color:'#AA9944'}}>TRADE</span> → peer-to-peer offers · Market fluctuates each round
        </div>

        <button onClick={()=>onStart(seed||'DEFAULT',players,w,h,target)}
          style={{width:'100%',background:'#C8A84A18',border:'2px solid #C8A84A',color:'#C8A84A',fontFamily:"'Courier New',monospace",fontSize:12,letterSpacing:4,padding:'11px',cursor:'pointer',fontWeight:'bold',boxShadow:'0 0 16px #C8A84A1A'}}
          onMouseEnter={e=>{e.target.style.background='#C8A84A2A';}}
          onMouseLeave={e=>{e.target.style.background='#C8A84A18';}}>
          INITIATE SURVEY
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  GAME OVER SCREEN
// ═══════════════════════════════════════════════════════════════════════════

function GameOverScreen({ state, onNewGame }) {
  const { winner, players, prices, round } = state;
  const sorted = players.map((pd,i)=>({pd,i,total:portfolioValue(pd,prices)})).sort((a,b)=>b.total-a.total);
  return (
    <div style={{position:'fixed',inset:0,background:'#000000EE',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,fontFamily:"'Courier New',monospace"}}>
      <div style={{border:`2px solid ${PLAYER_COLORS[winner]}`,background:'#0A0A07',padding:36,maxWidth:380,width:'100%',boxShadow:`0 0 60px ${PLAYER_COLORS[winner]}44`}}>
        <div style={{textAlign:'center',marginBottom:20}}>
          <div style={{color:PLAYER_COLORS[winner],fontSize:22,fontWeight:'bold',letterSpacing:4,textShadow:`0 0 20px ${PLAYER_COLORS[winner]}88`}}>
            SURVEY COMPLETE
          </div>
          <div style={{color:PLAYER_COLORS[winner],fontSize:13,marginTop:6,letterSpacing:2}}>{PLAYER_NAMES[winner]}</div>
          <div style={{color:'#6A6050',fontSize:10,marginTop:4}}>{round} rounds · ${portfolioValue(players[winner],prices).toLocaleString()} portfolio</div>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{color:'#3A3A28',fontSize:9,letterSpacing:2,marginBottom:8}}>FINAL STANDINGS</div>
          {sorted.map(({pd,i,total},rank)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6,padding:'5px 8px',border:`1px solid ${PLAYER_COLORS[i]}22`,background:rank===0?PLAYER_COLORS[i]+'0D':'transparent'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{color:'#3A3A28',fontSize:10}}>#{rank+1}</span>
                <span style={{color:PLAYER_COLORS[i],fontSize:10}}>{PLAYER_NAMES[i]}</span>
              </div>
              <span style={{color:'#C8A84A',fontSize:11}}>${total.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <button onClick={onNewGame} style={{width:'100%',background:'transparent',border:'1px solid #3A3A28',color:'#6A6050',fontFamily:"'Courier New',monospace",fontSize:10,padding:'9px',cursor:'pointer',letterSpacing:2}}>
          NEW SURVEY
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROOT APP
// ═══════════════════════════════════════════════════════════════════════════

export default function GeoStrat() {
  const [screen, setScreen] = useState('setup');
  const [winTarget, setWinTarget] = useState(WIN_TARGET);
  const [gameState, dispatch] = useReducer(gameReducer, null);
  const [selectedTile, setSelectedTile] = useState(null);
  const [hoveredTile, setHoveredTile] = useState(null);
  const [showResources, setShowResources] = useState(true);
  const [showTrade, setShowTrade] = useState(false);

  const startGame = (seed, playerCount, w, h, target) => {
    const mapData = generateMap(seed, w, h, playerCount);
    setWinTarget(target);
    const initial = initState(mapData, playerCount);
    // Seed log
    initial.log = [{text:`Survey initiated · seed "${seed}" · ${playerCount} pioneers · target $${target.toLocaleString()}`, color:'#C8A84A', turn:0}];
    initial.log.push({text:`— Round 1, ${PLAYER_NAMES[0]}'s turn — CLAIM PHASE`, color:'#3A3A28', turn:0});
    dispatch({type:'__INIT__', state:initial});
    setSelectedTile(null);
    setScreen('game');
  };

  // Special init action
  const realDispatch = useCallback((action) => {
    if (action.type==='__INIT__') {
      dispatch({type:'__SET_STATE__', state:action.state});
    } else {
      dispatch(action);
    }
  },[]);

  // Hacky but clean: intercept __SET_STATE__ in reducer
  const fullReducer = useCallback((state, action) => {
    if (action.type==='__SET_STATE__') return action.state;
    return gameReducer(state, action);
  },[]);

  const [gs, d] = useReducer(fullReducer, null);

  // We'll use a single reducer approach
  const [G, D] = useReducer((state, action) => {
    if (!state && action.type!=='INIT') return state;
    if (action.type==='INIT') return action.state;
    return gameReducer(state, action);
  }, null);

  const handleStart = (seed, playerCount, w, h, target) => {
    const mapData = generateMap(seed, w, h, playerCount);
    setWinTarget(target);
    const initial = initState(mapData, playerCount);
    initial.log = [
      {text:`Survey initiated · seed "${seed}" · ${playerCount} pioneers · target $${target.toLocaleString()}`, color:'#C8A84A', turn:0},
      {text:`— Round 1, ${PLAYER_NAMES[0]}'s turn — CLAIM PHASE`, color:'#3A3A28', turn:0},
    ];
    D({type:'INIT', state:initial});
    setSelectedTile(null);
    setScreen('game');
  };

  if (screen==='setup') return <SetupScreen onStart={handleStart}/>;
  if (!G) return <SetupScreen onStart={handleStart}/>;

  const cp = G.currentPlayer;
  const syncedSelected = selectedTile ? G.tiles.find(t=>t.x===selectedTile.x&&t.y===selectedTile.y)||selectedTile : null;

  return (
    <div style={{height:'100vh',background:'#080806',display:'flex',flexDirection:'column',fontFamily:"'Courier New',monospace",overflow:'hidden'}}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}} *{box-sizing:border-box} ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:#080807} ::-webkit-scrollbar-thumb{background:#2A2A18}`}</style>

      {/* Header bar */}
      <div style={{borderBottom:'1px solid #1E1E12',padding:'6px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#0B0B08',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <span style={{color:'#C8A84A',fontSize:13,fontWeight:'bold',letterSpacing:3}}>GEO-STRAT</span>
          <span style={{color:'#2A2A1E',fontSize:9}}>SEED:{G.mapData.seed}</span>
          <span style={{color:'#2A2A1E',fontSize:9}}>{G.mapData.width}×{G.mapData.height}</span>
          <span style={{color:'#2A2A1E',fontSize:9}}>RND {G.round}</span>
          <span style={{color:'#2A2A1E',fontSize:9}}>TARGET ${winTarget.toLocaleString()}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {G.phase!==PHASES.GAMEOVER&&(
            <span style={{color:PLAYER_COLORS[cp],fontSize:10,fontWeight:'bold',animation:'pulse 1.5s infinite'}}>
              ▶ {PLAYER_NAMES[cp]} · {G.phase}
            </span>
          )}
          <button onClick={()=>setShowResources(r=>!r)} style={{background:'transparent',border:'1px solid #1E1E12',color:'#4A4A38',fontFamily:"'Courier New',monospace",fontSize:8,padding:'2px 7px',cursor:'pointer'}}>
            {showResources?'HIDE':'SHOW'} RES
          </button>
          <button onClick={()=>setScreen('setup')} style={{background:'transparent',border:'1px solid #1E1E12',color:'#4A4A38',fontFamily:"'Courier New',monospace",fontSize:8,padding:'2px 7px',cursor:'pointer'}}>
            MENU
          </button>
        </div>
      </div>

      {/* Market event ticker */}
      {G.marketEvents&&G.marketEvents.length>0&&(
        <div style={{background:'#C8A84A0A',borderBottom:'1px solid #C8A84A22',padding:'3px 16px',color:'#8A7040',fontSize:9,letterSpacing:1}}>
          📊 {G.marketEvents[0]}
        </div>
      )}

      {/* Main 3-column layout */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* LEFT — player cards + legend */}
        <div style={{width:196,borderRight:'1px solid #1A1A10',padding:'10px 9px',overflowY:'auto',background:'#0A0A07',flexShrink:0}}>
          <div style={{color:'#2A2A1E',fontSize:8,letterSpacing:2,marginBottom:8}}>PIONEER ROSTER</div>
          {G.players.map((pd,i)=>(
            <PlayerCard key={i} player={i+1} pd={pd} isActive={G.currentPlayer===i&&G.phase!==PHASES.GAMEOVER}
              claimCount={G.tiles.filter(t=>t.owner===i+1).length} prices={G.prices}/>
          ))}
          <div style={{marginTop:12,borderTop:'1px solid #1A1A10',paddingTop:10}}>
            <Legend prices={G.prices}/>
          </div>
          <div style={{marginTop:12,borderTop:'1px solid #1A1A10',paddingTop:10}}>
            <MarketChart priceHistory={G.priceHistory} prices={G.prices}/>
          </div>
        </div>

        {/* CENTER — isometric board */}
        <div style={{flex:1,overflow:'auto',padding:'16px',display:'flex',alignItems:'flex-start',justifyContent:'center',background:'#080806'}}>
          <IsometricBoard
            state={G}
            onTileClick={setSelectedTile}
            onTileHover={setHoveredTile}
            hoveredTile={hoveredTile}
            selectedTile={syncedSelected}
            showResources={showResources}
          />
        </div>

        {/* RIGHT — actions + hover + log */}
        <div style={{width:232,borderLeft:'1px solid #1A1A10',padding:'10px 9px',display:'flex',flexDirection:'column',gap:8,background:'#0A0A07',flexShrink:0,overflowY:'auto'}}>

          {/* Hover info */}
          {hoveredTile&&(
            <div style={{border:'1px solid #1A1A10',background:'#0D0D09',padding:'6px 9px',flexShrink:0}}>
              <div style={{color:'#3A3A28',fontSize:8,marginBottom:2}}>CURSOR ({hoveredTile.x},{hoveredTile.y})</div>
              <div style={{color:'#5A5048',fontSize:9}}>{TERRAIN_STYLE[hoveredTile.terrain].label}</div>
              {hoveredTile.revealed&&hoveredTile.resource&&!hoveredTile.depleted&&(
                <div style={{color:RESOURCE_ICON[hoveredTile.resource].color,fontSize:9,marginTop:1}}>
                  {RESOURCE_ICON[hoveredTile.resource].icon} {RESOURCE_ICON[hoveredTile.resource].label} · ${G.prices[hoveredTile.resource]}/u
                </div>
              )}
              {hoveredTile.depleted&&<div style={{color:'#3A2A2A',fontSize:9}}>∅ DEPLETED</div>}
              {!hoveredTile.revealed&&<div style={{color:'#252520',fontSize:9}}>⬛ UNEXPLORED</div>}
              <div style={{color:'#3A3A28',fontSize:8,marginTop:1}}>
                {hoveredTile.owner?`${PLAYER_NAMES[hoveredTile.owner-1]}`:'Unclaimed'} · Depth {hoveredTile.drillLevel}/{hoveredTile.maxDepth}
              </div>
            </div>
          )}

          <ActionPanel state={G} dispatch={D} selectedTile={syncedSelected} onOpenTrade={()=>setShowTrade(true)}/>

          {/* Wealth race */}
          <div style={{border:'1px solid #1A1A10',background:'#0D0D09',padding:'7px 9px',flexShrink:0}}>
            <div style={{color:'#3A3A28',fontSize:8,letterSpacing:1,marginBottom:6}}>WEALTH RACE → ${winTarget.toLocaleString()}</div>
            {G.players.map((pd,i)=>{
              const total=portfolioValue(pd,G.prices);
              const pct=Math.min(100,(total/winTarget)*100);
              return (
                <div key={i} style={{marginBottom:5}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                    <span style={{color:PLAYER_COLORS[i],fontSize:9}}>{PLAYER_NAMES[i]}</span>
                    <span style={{color:'#5A5048',fontSize:9}}>${total.toLocaleString()}</span>
                  </div>
                  <div style={{height:3,background:'#151510'}}>
                    <div style={{height:'100%',width:`${pct}%`,background:PLAYER_COLORS[i],boxShadow:`0 0 3px ${PLAYER_COLORS[i]}77`,transition:'width 0.4s'}}/>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{color:'#2A2A1E',fontSize:8,letterSpacing:2}}>ACTIVITY LOG</div>
          <GameLog log={G.log}/>
        </div>
      </div>

      {/* Trade modal */}
      {showTrade && G.phase===PHASES.ACTION && (
        <TradeModal state={G} dispatch={D} onClose={()=>setShowTrade(false)}/>
      )}

      {/* Game over overlay */}
      {G.phase===PHASES.GAMEOVER && (
        <GameOverScreen state={G} onNewGame={()=>setScreen('setup')}/>
      )}
    </div>
  );
}
