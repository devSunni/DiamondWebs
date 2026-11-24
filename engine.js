(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DiamondEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRECTIONS = [
    { dq: 1, dr: 0 },
    { dq: -1, dr: 0 },
    { dq: 0, dr: 1 },
    { dq: 0, dr: -1 },
    { dq: 1, dr: -1 },
    { dq: -1, dr: 1 }
  ];

  const TIP_META = [
    { id: 0, name: '북', apex: { q: 4, r: -8, s: 4 }, opposite: 3 },
    { id: 1, name: '북동', apex: { q: 8, r: -4, s: -4 }, opposite: 4 },
    { id: 2, name: '남동', apex: { q: 4, r: 4, s: -8 }, opposite: 5 },
    { id: 3, name: '남', apex: { q: -4, r: 8, s: -4 }, opposite: 0 },
    { id: 4, name: '남서', apex: { q: -8, r: 4, s: 4 }, opposite: 1 },
    { id: 5, name: '북서', apex: { q: -4, r: -4, s: 8 }, opposite: 2 }
  ];

  const PLAYER_STYLES = {
    red: {
      id: 'red',
      label: '빨강',
      emoji: '🔴',
      hex: '#e11d48',
      light: '#fda4af',
      dark: '#881337',
      zoneTint: 'rgba(225, 29, 72, 0.14)'
    },
    yellow: {
      id: 'yellow',
      label: '노랑',
      emoji: '🟡',
      hex: '#eab308',
      light: '#fef08a',
      dark: '#854d0e',
      zoneTint: 'rgba(234, 179, 8, 0.16)'
    },
    blue: {
      id: 'blue',
      label: '파랑',
      emoji: '🔵',
      hex: '#2563eb',
      light: '#93c5fd',
      dark: '#1e3a8a',
      zoneTint: 'rgba(37, 99, 235, 0.14)'
    }
  };

  function keyOf(q, r) {
    return `${q},${r}`;
  }

  function axialDistance(a, b) {
    const as = -a.q - a.r;
    const bs = -b.q - b.r;
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(as - bs)) / 2;
  }

  function isInsideStar(q, r) {
    const s = -q - r;
    const aq = Math.abs(q);
    const ar = Math.abs(r);
    const as = Math.abs(s);
    if (aq > 8 || ar > 8 || as > 8) return false;
    let within4 = 0;
    if (aq <= 4) within4++;
    if (ar <= 4) within4++;
    if (as <= 4) within4++;
    return within4 >= 2;
  }

  function getTipId(q, r) {
    const s = -q - r;
    if (r < -4) return 0;
    if (q > 4) return 1;
    if (s < -4) return 2;
    if (r > 4) return 3;
    if (q < -4) return 4;
    if (s > 4) return 5;
    return -1;
  }

  function isInZone(cell, tipId, pieceCount) {
    const { q, r, s } = cell;
    if (pieceCount === 10) {
      return getTipId(q, r) === tipId;
    }
    // 15-piece classic zone: 10 tip holes + 5 adjacent 5th-row holes
    switch (tipId) {
      case 0: return r <= -4 && q >= 0 && s >= 0;
      case 1: return q >= 4 && r <= 0 && s <= 0;
      case 2: return s <= -4 && q >= 0 && r >= 0;
      case 3: return r >= 4 && q <= 0 && s <= 0;
      case 4: return q <= -4 && r >= 0 && s >= 0;
      case 5: return s >= 4 && q <= 0 && r <= 0;
      default: return false;
    }
  }

  function buildBoardGeometry() {
    const cells = [];
    const cellMap = new Map();
    const SQRT3_2 = Math.sqrt(3) / 2;

    for (let r = -8; r <= 8; r++) {
      for (let q = -8; q <= 8; q++) {
        if (!isInsideStar(q, r)) continue;
        const s = -q - r;
        const key = keyOf(q, r);
        const cell = {
          key,
          q,
          r,
          s,
          x: q + r * 0.5,
          y: r * SQRT3_2,
          tip: getTipId(q, r)
        };
        cells.push(cell);
        cellMap.set(key, cell);
      }
    }

    // Precompute neighbors for fast BFS & AI
    for (const cell of cells) {
      cell.neighbors = [];
      for (let d = 0; d < DIRECTIONS.length; d++) {
        const dir = DIRECTIONS[d];
        const nKey = keyOf(cell.q + dir.dq, cell.r + dir.dr);
        const nCell = cellMap.get(nKey) || null;
        const jKey = keyOf(cell.q + dir.dq * 2, cell.r + dir.dr * 2);
        const jCell = cellMap.get(jKey) || null;
        cell.neighbors.push({ dirIndex: d, step: nCell, jump: jCell });
      }
    }

    return { cells, cellMap };
  }

  const GEOMETRY = buildBoardGeometry();

  function getZoneKeys(tipId, pieceCount) {
    return GEOMETRY.cells
      .filter((c) => isInZone(c, tipId, pieceCount))
      .map((c) => c.key);
  }

  function createGame(options = {}) {
    const playerCount = options.playerCount === 2 ? 2 : 3;
    const pieceCount = options.pieceCount === 15 ? 15 : 10;
    const aiDifficulty = ['easy', 'medium', 'hard'].includes(options.aiDifficulty)
      ? options.aiDifficulty
      : 'medium';

    // Default human/AI setup: player 0 (red) is human, others AI unless overridden
    const controllers = Array.isArray(options.controllers)
      ? options.controllers.slice(0, playerCount)
      : playerCount === 2
        ? ['human', 'ai']
        : ['human', 'ai', 'ai'];

    const seatConfig = playerCount === 2
      ? [
          { id: 'red', startTip: 3, targetTip: 0 },
          { id: 'blue', startTip: 0, targetTip: 3 }
        ]
      : [
          { id: 'red', startTip: 3, targetTip: 0 },
          { id: 'yellow', startTip: 5, targetTip: 2 },
          { id: 'blue', startTip: 1, targetTip: 4 }
        ];

    const players = seatConfig.map((seat, idx) => {
      const style = PLAYER_STYLES[seat.id];
      const startKeys = getZoneKeys(seat.startTip, pieceCount);
      const targetKeys = getZoneKeys(seat.targetTip, pieceCount);
      const apex = TIP_META[seat.startTip].apex;
      const targetApex = TIP_META[seat.targetTip].apex;
      return {
        ...style,
        index: idx,
        controller: controllers[idx] || 'ai',
        startTip: seat.startTip,
        targetTip: seat.targetTip,
        startApexKey: keyOf(apex.q, apex.r),
        targetApex,
        targetApexKey: keyOf(targetApex.q, targetApex.r),
        startZone: new Set(startKeys),
        targetZone: new Set(targetKeys)
      };
    });

    const board = {};
    for (const cell of GEOMETRY.cells) {
      board[cell.key] = null;
    }

    for (const p of players) {
      for (const k of p.startZone) {
        board[k] = {
          owner: p.id,
          isKing: k === p.startApexKey
        };
      }
    }

    return {
      playerCount,
      pieceCount,
      aiDifficulty,
      players,
      board,
      turnIndex: 0,
      turnNumber: 1,
      winner: null,
      rankings: [],
      history: [],
      lastMove: null
    };
  }

  /**
   * Returns a Map of destinationKey -> { to, type: 'step'|'jump', path: [from, ..., to], hops }
   */
  function getValidMoves(board, fromKey) {
    const piece = board[fromKey];
    const moves = new Map();
    if (!piece) return moves;

    const startCell = GEOMETRY.cellMap.get(fromKey);
    if (!startCell) return moves;

    // 1. Adjacent single-step moves
    for (const nb of startCell.neighbors) {
      if (nb.step && !board[nb.step.key]) {
        moves.set(nb.step.key, {
          from: fromKey,
          to: nb.step.key,
          type: 'step',
          path: [fromKey, nb.step.key],
          hops: 0
        });
      }
    }

    // 2. BFS for single and multi-hop chain jumps
    const visited = new Set([fromKey]);
    const queue = [{ key: fromKey, path: [fromKey] }];

    while (queue.length > 0) {
      const current = queue.shift();
      const cell = GEOMETRY.cellMap.get(current.key);
      for (const nb of cell.neighbors) {
        if (nb.step && nb.jump && board[nb.step.key] && !board[nb.jump.key]) {
          const destKey = nb.jump.key;
          if (!visited.has(destKey)) {
            visited.add(destKey);
            const nextPath = current.path.concat(destKey);
            moves.set(destKey, {
              from: fromKey,
              to: destKey,
              type: 'jump',
              path: nextPath,
              hops: nextPath.length - 1
            });
            queue.push({ key: destKey, path: nextPath });
          }
        }
      }
    }

    return moves;
  }

  function getAllMovesForPlayer(state, playerId) {
    const all = [];
    for (const cell of GEOMETRY.cells) {
      const piece = state.board[cell.key];
      if (!piece || piece.owner !== playerId) continue;
      const moveMap = getValidMoves(state.board, cell.key);
      for (const mv of moveMap.values()) {
        all.push(mv);
      }
    }
    return all;
  }

  function countPiecesInTarget(state, player) {
    let count = 0;
    for (const k of player.targetZone) {
      const p = state.board[k];
      if (p && p.owner === player.id) count++;
    }
    return count;
  }

  function hasPlayerWon(state, player) {
    return countPiecesInTarget(state, player) === state.pieceCount;
  }

  function applyMove(state, move) {
    if (state.winner) return false;
    const currentPlayer = state.players[state.turnIndex];
    const piece = state.board[move.from];
    if (!piece || piece.owner !== currentPlayer.id) return false;

    const validMap = getValidMoves(state.board, move.from);
    const verified = validMap.get(move.to);
    if (!verified) return false;

    state.history.push({
      from: verified.from,
      to: verified.to,
      path: verified.path.slice(),
      type: verified.type,
      hops: verified.hops,
      playerId: currentPlayer.id,
      prevTurnIndex: state.turnIndex,
      prevTurnNumber: state.turnNumber,
      prevLastMove: state.lastMove
    });

    state.board[verified.to] = piece;
    state.board[verified.from] = null;
    state.lastMove = {
      ...verified,
      playerId: currentPlayer.id,
      isKing: piece.isKing
    };

    if (hasPlayerWon(state, currentPlayer)) {
      state.winner = currentPlayer.id;
      if (!state.rankings.includes(currentPlayer.id)) {
        state.rankings.push(currentPlayer.id);
      }
    } else {
      state.turnIndex = (state.turnIndex + 1) % state.players.length;
      state.turnNumber += 1;
    }

    return true;
  }

  function undoMove(state) {
    if (!state.history.length) return null;
    const last = state.history.pop();
    const piece = state.board[last.to];
    state.board[last.from] = piece;
    state.board[last.to] = null;
    state.turnIndex = last.prevTurnIndex;
    state.turnNumber = last.prevTurnNumber;
    state.lastMove = last.prevLastMove;
    state.winner = null;
    state.rankings = [];
    return last;
  }

  function evaluateBoardForPlayer(board, player, pieceCount) {
    const targetApex = player.targetApex;
    const startApex = TIP_META[player.startTip].apex;
    let totalDist = 0;
    let maxDist = 0;
    let inTargetCount = 0;
    let centerPenalty = 0;
    let deepTargetBonus = 0;

    // Axis vector from startApex to targetApex for lateral alignment
    const sx = startApex.q + startApex.r * 0.5;
    const sy = startApex.r * (Math.sqrt(3) / 2);
    const tx = targetApex.q + targetApex.r * 0.5;
    const ty = targetApex.r * (Math.sqrt(3) / 2);
    const vx = tx - sx;
    const vy = ty - sy;
    const vLen = Math.hypot(vx, vy) || 1;

    for (const cell of GEOMETRY.cells) {
      const piece = board[cell.key];
      if (!piece || piece.owner !== player.id) continue;

      const d = axialDistance(cell, targetApex);
      totalDist += d;
      if (d > maxDist) maxDist = d;

      if (player.targetZone.has(cell.key)) {
        inTargetCount++;
        // Reward filling deeper target holes first so front pieces don't block back holes
        deepTargetBonus += (5 - Math.min(4, d)) * 2.2;
      }

      // Mild preference to keep pieces near the central corridor for chain jumps
      const cross = Math.abs((cell.x - sx) * vy - (cell.y - sy) * vx) / vLen;
      centerPenalty += cross * 0.22;
    }

    if (inTargetCount === pieceCount) return 100000;

    // Strongly minimize total distance + lagging straggler distance
    return (
      -totalDist * 12.0
      - maxDist * maxDist * 0.85
      + inTargetCount * 18.0
      + deepTargetBonus
      - centerPenalty
    );
  }

  function chooseAIMove(state, difficultyOverride) {
    const player = state.players[state.turnIndex];
    if (!player || state.winner) return null;
    const difficulty = difficultyOverride || state.aiDifficulty || 'medium';
    const moves = getAllMovesForPlayer(state, player.id);
    if (!moves.length) return null;

    const scored = [];
    for (const mv of moves) {
      const piece = state.board[mv.from];
      state.board[mv.to] = piece;
      state.board[mv.from] = null;

      let score = evaluateBoardForPlayer(state.board, player, state.pieceCount);

      // Small bonus for multi-hop jumps & moving pieces out of own start zone
      if (mv.hops >= 2) score += mv.hops * 1.4;
      if (player.startZone.has(mv.from) && !player.startZone.has(mv.to)) {
        score += 3.5;
      }
      // Avoid oscillating back out of target zone unless it improves score significantly
      if (player.targetZone.has(mv.from) && !player.targetZone.has(mv.to)) {
        score -= 14.0;
      }

      state.board[mv.from] = piece;
      state.board[mv.to] = null;

      scored.push({ mv, score });
    }

    scored.sort((a, b) => b.score - a.score);

    // Immediate winning move always wins
    if (scored[0].score >= 90000) return scored[0].mv;

    if (difficulty === 'easy') {
      const poolSize = Math.min(5, scored.length);
      const idx = Math.floor(Math.random() * poolSize);
      return scored[idx].mv;
    }

    if (difficulty === 'medium') {
      const topScore = scored[0].score;
      const nearTop = scored.filter((item) => topScore - item.score <= 1.2);
      return nearTop[Math.floor(Math.random() * nearTop.length)].mv;
    }

    // Hard: 2-ply self-combo beam search (finds setup moves that unlock huge next-turn chain jumps)
    const beam = scored.slice(0, Math.min(10, scored.length));
    let bestMove = beam[0].mv;
    let bestCombined = -Infinity;

    for (const item of beam) {
      const mv = item.mv;
      const piece = state.board[mv.from];
      state.board[mv.to] = piece;
      state.board[mv.from] = null;

      const followUps = getAllMovesForPlayer(state, player.id);
      let bestSecond = item.score;
      for (const mv2 of followUps) {
        const p2 = state.board[mv2.from];
        state.board[mv2.to] = p2;
        state.board[mv2.from] = null;
        const s2 = evaluateBoardForPlayer(state.board, player, state.pieceCount);
        if (s2 > bestSecond) bestSecond = s2;
        state.board[mv2.from] = p2;
        state.board[mv2.to] = null;
      }

      state.board[mv.from] = piece;
      state.board[mv.to] = null;

      const combined = item.score * 0.65 + bestSecond * 0.35;
      if (combined > bestCombined) {
        bestCombined = combined;
        bestMove = mv;
      }
    }

    return bestMove;
  }

  return {
    DIRECTIONS,
    TIP_META,
    PLAYER_STYLES,
    GEOMETRY,
    keyOf,
    axialDistance,
    isInsideStar,
    getTipId,
    isInZone,
    getZoneKeys,
    createGame,
    getValidMoves,
    getAllMovesForPlayer,
    countPiecesInTarget,
    hasPlayerWon,
    applyMove,
    undoMove,
    evaluateBoardForPlayer,
    chooseAIMove
  };
});
