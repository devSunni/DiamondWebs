const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const Engine = require(path.join(ROOT, 'engine.js'));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const soundSource = fs.readFileSync(path.join(ROOT, 'sound.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(ROOT, 'engine.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('JS syntax validity for engine, sound, sw, and inline HTML script', () => {
  assert.doesNotThrow(() => new Function(engineSource), 'engine.js syntax');
  assert.doesNotThrow(() => new Function(soundSource), 'sound.js syntax');
  assert.doesNotThrow(() => new Function(swSource), 'sw.js syntax');

  const inlineScripts = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc\s*=/.test(m[0]))
    .map((m) => m[1]);
  assert.ok(inlineScripts.length >= 1, 'Expected inline script in index.html');
  inlineScripts.forEach((code, idx) => {
    assert.doesNotThrow(() => new Function(code), `inline script #${idx} syntax`);
  });
});

test('121-hole 6-pointed star geometry and zone integrity', () => {
  assert.equal(Engine.GEOMETRY.cells.length, 121);
  assert.equal(Engine.GEOMETRY.cellMap.size, 121);

  for (let tip = 0; tip < 6; tip++) {
    assert.equal(Engine.getZoneKeys(tip, 10).length, 10, `Tip ${tip} has 10 holes`);
    assert.equal(Engine.getZoneKeys(tip, 15).length, 15, `Tip ${tip} has 15 holes`);
  }

  // 3-player 15-piece zones (tips 3, 5, 1) must be completely disjoint
  const g3 = Engine.createGame({ playerCount: 3, pieceCount: 15 });
  const occupied = Object.values(g3.board).filter(Boolean);
  assert.equal(occupied.length, 45);
  for (const p of g3.players) {
    const owned = occupied.filter((x) => x.owner === p.id);
    assert.equal(owned.length, 15);
    assert.equal(owned.filter((x) => x.isKing).length, 1);
  }
});

test('Movement rules: single step, single jump, multi-hop chain jump, no capture, undo', () => {
  const g = Engine.createGame({ playerCount: 2, pieceCount: 10 });
  // Clear board for deterministic jump test
  for (const k of Object.keys(g.board)) g.board[k] = null;

  // Place red at (0,0), stepping stones at (0,-1) and (0,-3) -> should jump (0,0)->(0,-2)->(0,-4)
  g.board['0,0'] = { owner: 'red', isKing: true };
  g.board['0,-1'] = { owner: 'blue', isKing: false };
  g.board['0,-3'] = { owner: 'red', isKing: false };

  const moves = Engine.getValidMoves(g.board, '0,0');
  assert.ok(moves.has('1,0'), 'Adjacent step (1,0) should be valid');
  assert.equal(moves.get('1,0').type, 'step');

  assert.ok(moves.has('0,-2'), '1-hop jump to (0,-2) should be valid');
  assert.equal(moves.get('0,-2').hops, 1);

  assert.ok(moves.has('0,-4'), '2-hop chain jump to (0,-4) should be valid');
  assert.equal(moves.get('0,-4').hops, 2);
  assert.deepEqual(moves.get('0,-4').path, ['0,0', '0,-2', '0,-4']);

  // Apply chain jump and verify jumped pieces are NOT captured
  assert.equal(Engine.applyMove(g, moves.get('0,-4')), true);
  assert.equal(g.board['0,0'], null);
  assert.equal(g.board['0,-4'].owner, 'red');
  assert.equal(g.board['0,-1'].owner, 'blue', 'Jumped piece remains on board');
  assert.equal(g.board['0,-3'].owner, 'red', 'Jumped piece remains on board');

  // Undo restores exact previous state
  Engine.undoMove(g);
  assert.equal(g.board['0,0'].owner, 'red');
  assert.equal(g.board['0,-4'], null);
  assert.equal(g.turnIndex, 0);
});

test('Win detection triggers when all pieces reach opposite target zone', () => {
  const g = Engine.createGame({ playerCount: 3, pieceCount: 10 });
  for (const k of Object.keys(g.board)) g.board[k] = null;

  const red = g.players[0];
  const targetArr = [...red.targetZone];
  // Fill 9 of 10 target holes with red
  for (let i = 0; i < 9; i++) {
    g.board[targetArr[i]] = { owner: 'red', isKing: i === 0 };
  }
  const missingKey = targetArr[9];
  const missingCell = Engine.GEOMETRY.cellMap.get(missingKey);
  const adjacentOutside = missingCell.neighbors.find((nb) => nb.step && !red.targetZone.has(nb.step.key));
  assert.ok(adjacentOutside, 'Found adjacent hole outside target zone');

  g.board[adjacentOutside.step.key] = { owner: 'red', isKing: false };
  assert.equal(g.winner, null);

  const ok = Engine.applyMove(g, { from: adjacentOutside.step.key, to: missingKey });
  assert.equal(ok, true);
  assert.equal(g.winner, 'red');
});

test('AI chooses valid moves across all difficulties and modes', () => {
  for (const diff of ['easy', 'medium', 'hard']) {
    const g = Engine.createGame({ playerCount: 3, pieceCount: 10, aiDifficulty: diff });
    const mv = Engine.chooseAIMove(g, diff);
    assert.ok(mv, `AI (${diff}) returned a move`);
    assert.equal(Engine.applyMove(g, mv), true, `AI (${diff}) move is legal`);
  }
});

test('PWA manifest, icons, service worker, touch & TTS guards', () => {
  // Single static manifest link, no data: URI manifest
  const manifestLinks = html.match(/<link[^>]+rel=["']manifest["'][^>]*>/gi) || [];
  assert.equal(manifestLinks.length, 1, 'Exactly one manifest link');
  assert.match(manifestLinks[0], /href=["']\.\/manifest\.json["']/);
  assert.ok(!html.includes('data:application/manifest+json'), 'No data: URI manifest');

  // Manifest schema
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');

  const purposes = manifest.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('any'));
  assert.ok(purposes.includes('maskable'));
  assert.ok(!purposes.some((p) => p.includes('any') && p.includes('maskable')), 'No combined any maskable');

  // Icon files exist and start with PNG magic bytes
  for (const icon of manifest.icons) {
    const p = path.join(ROOT, icon.src.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(p), `Icon exists: ${icon.src}`);
    const header = fs.readFileSync(p).subarray(0, 8);
    assert.deepEqual([...header], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `Valid PNG: ${icon.src}`);
  }

  // Service worker core assets
  for (const asset of ['./index.html', './engine.js', './sound.js', './manifest.json', './icon-192.png', './icon-512.png']) {
    assert.ok(swSource.includes(asset), `SW caches ${asset}`);
  }

  // Touch & long-press guards
  assert.ok(html.includes('-webkit-touch-callout: none'));
  assert.ok(html.includes("addEventListener('contextmenu'"));
  assert.ok(html.includes("addEventListener('dragstart'"));

  // Korean TTS Chromium cancel/speak delay guard
  assert.ok(soundSource.includes('synth.cancel()'));
  assert.ok(soundSource.includes('setTimeout(doSpeak, 65)'));
  assert.ok(soundSource.includes('synth.paused'));

  // Collapsible menu & persistent settings guards
  assert.ok(html.includes('id="btnMenuHide"'));
  assert.ok(html.includes('id="btnMenuShow"'));
  assert.ok(html.includes('diamond-webs-prefs-v1'));
  assert.ok(html.includes('diamond-menu-hidden'));
});
