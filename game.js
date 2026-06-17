const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

const elixirFill = document.getElementById('elixir-fill');
const elixirText = document.getElementById('elixir-text');
const statusEl = document.getElementById('status');
const handEl = document.getElementById('hand');

const LANE_X = { left: 110, right: 310 };

function makeTower(side, lane, x, y, isKing) {
  return {
    side, lane, x, y, isKing,
    hp: isKing ? 2400 : 1400,
    maxHp: isKing ? 2400 : 1400,
    range: isKing ? 110 : 130,
    damage: isKing ? 90 : 80,
    attackInterval: 0.9,
    cooldown: 0,
    alive: true,
    radius: isKing ? 26 : 22,
    awake: !isKing, // king towers wake only once damaged or a princess tower falls
  };
}

const towers = [
  makeTower('player', 'left', LANE_X.left, 600, false),
  makeTower('player', 'right', LANE_X.right, 600, false),
  makeTower('player', 'king', W / 2, 630, true),
  makeTower('enemy', 'left', LANE_X.left, 40, false),
  makeTower('enemy', 'right', LANE_X.right, 40, false),
  makeTower('enemy', 'king', W / 2, 10, true),
];

let troops = [];
let nextId = 1;

let playerElixir = 5;
let enemyElixir = 5;
const MAX_ELIXIR = 10;
const ELIXIR_RATE = 1 / 2.8; // per second

let selectedCardIndex = null;
let playerHand = [];
let playerNext = null;
let gameOver = false;

// Drag-and-drop placement state
let dragCardIndex = null;
let dragPos = null; // {x, y} in canvas coordinates
let dragValid = false;

function pickRandomCard(exclude) {
  let pool = DECK.filter(c => c !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

function initHand() {
  playerHand = [pickRandomCard(), pickRandomCard(), pickRandomCard(), pickRandomCard()];
  playerNext = pickRandomCard();
  renderHand();
}

function renderHand() {
  handEl.innerHTML = '';
  playerHand.forEach((cardKey, i) => {
    const card = CARD_TYPES[cardKey];
    const div = document.createElement('div');
    div.className = 'card' + (selectedCardIndex === i ? ' selected' : '') + (playerElixir < card.cost ? ' disabled' : '');
    div.innerHTML = `<div class="icon">${card.icon}</div><div class="name">${card.name}</div><div class="cost">${card.cost}</div>`;
    div.onclick = () => {
      if (playerElixir < card.cost || gameOver) return;
      selectedCardIndex = selectedCardIndex === i ? null : i;
      renderHand();
    };
    div.addEventListener('pointerdown', (e) => {
      if (playerElixir < card.cost || gameOver) return;
      e.preventDefault();
      dragCardIndex = i;
      selectedCardIndex = i;
      updateDragPos(e);
      renderHand();
    });
    handEl.appendChild(div);
  });
}

function canvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (W / rect.width),
    y: (e.clientY - rect.top) * (H / rect.height),
  };
}

function isValidPlacement(x, y) {
  return x >= 0 && x <= W && y >= H / 2 + 16 && y <= H;
}

function updateDragPos(e) {
  const { x, y } = canvasCoords(e);
  dragPos = { x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(H, y)) };
  dragValid = isValidPlacement(x, y);
}

function deployCard(cardIndex, x, y) {
  const cardKey = playerHand[cardIndex];
  const card = CARD_TYPES[cardKey];
  if (playerElixir < card.cost) return;
  playerElixir -= card.cost;
  spawnTroop('player', cardKey, x, y);
  playerHand[cardIndex] = playerNext;
  playerNext = pickRandomCard();
  selectedCardIndex = null;
  renderHand();
}

window.addEventListener('pointermove', (e) => {
  if (dragCardIndex === null) return;
  updateDragPos(e);
});

window.addEventListener('pointerup', (e) => {
  if (dragCardIndex === null) return;
  const { x, y } = canvasCoords(e);
  if (!gameOver && isValidPlacement(x, y)) {
    deployCard(dragCardIndex, x, y);
  }
  dragCardIndex = null;
  dragPos = null;
  renderHand();
});

canvas.addEventListener('click', (e) => {
  if (selectedCardIndex === null || gameOver || dragCardIndex !== null) return;
  const { x, y } = canvasCoords(e);
  if (!isValidPlacement(x, y)) return;
  deployCard(selectedCardIndex, x, y);
});

function spawnTroop(side, cardKey, x, y) {
  const def = CARD_TYPES[cardKey];
  troops.push({
    id: nextId++,
    side,
    cardKey,
    x, y,
    hp: def.hp,
    maxHp: def.hp,
    cooldown: 0,
    target: null,
    def,
  });
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function aliveTowers(side) {
  return towers.filter(t => t.side === side && t.alive);
}

function findTarget(unit) {
  const enemySide = unit.side === 'player' ? 'enemy' : 'player';
  const candidates = [];
  for (const t of troops) {
    if (t.side === enemySide && t.hp > 0) {
      if (unit.def.targets === 'buildings') continue;
      if (unit.def.targets === 'ground' && t.def.flying) continue;
      candidates.push({ obj: t, isTower: false });
    }
  }
  for (const tw of aliveTowers(enemySide)) {
    candidates.push({ obj: tw, isTower: true });
  }
  let best = null, bestDist = Infinity;
  for (const c of candidates) {
    const d = dist(unit, c.obj);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function update(dt) {
  if (gameOver) return;

  playerElixir = Math.min(MAX_ELIXIR, playerElixir + ELIXIR_RATE * dt);
  enemyElixir = Math.min(MAX_ELIXIR, enemyElixir + ELIXIR_RATE * dt);

  enemyAI(dt);

  // Troop behavior
  for (const unit of troops) {
    if (unit.hp <= 0) continue;
    const found = findTarget(unit);
    const range = unit.def.range;
    if (found) {
      const target = found.obj;
      const d = dist(unit, target);
      if (d <= range) {
        unit.cooldown -= dt;
        if (unit.cooldown <= 0) {
          target.hp -= unit.def.damage;
          unit.cooldown = unit.def.attackInterval;
          if (found.isTower && target.isKing === undefined) {}
        }
      } else {
        const dirX = target.x - unit.x;
        const dirY = target.y - unit.y;
        const len = Math.hypot(dirX, dirY) || 1;
        unit.x += (dirX / len) * unit.def.speed * dt;
        unit.y += (dirY / len) * unit.def.speed * dt;
      }
    } else {
      const dy = unit.side === 'player' ? -unit.def.speed * dt : unit.def.speed * dt;
      unit.y += dy;
    }
  }

  // Tower attacks
  for (const tower of towers) {
    if (!tower.alive) continue;
    if (tower.isKing && !tower.awake) continue;
    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;
    const enemySide = tower.side === 'player' ? 'enemy' : 'player';
    let best = null, bestDist = Infinity;
    for (const t of troops) {
      if (t.side === enemySide && t.hp > 0) {
        const d = dist(tower, t);
        if (d <= tower.range && d < bestDist) { bestDist = d; best = t; }
      }
    }
    if (best) {
      best.hp -= tower.damage;
      tower.cooldown = tower.attackInterval;
    }
  }

  // Cleanup dead troops
  troops = troops.filter(t => t.hp > 0);

  // Tower deaths
  for (const tower of towers) {
    if (tower.alive && tower.hp <= 0) {
      tower.alive = false;
      tower.hp = 0;
      if (!tower.isKing) {
        const king = towers.find(t => t.side === tower.side && t.isKing);
        if (king) king.awake = true;
      }
    }
  }

  checkWin();
  render();
  updateHud();
}

function enemyAI(dt) {
  enemyElixir = enemyElixir; // already incremented above
  if (Math.random() < dt * 0.5 && enemyElixir >= 2) {
    const affordable = DECK.filter(c => CARD_TYPES[c].cost <= enemyElixir);
    if (affordable.length === 0) return;
    const cardKey = affordable[Math.floor(Math.random() * affordable.length)];
    const cost = CARD_TYPES[cardKey].cost;
    enemyElixir -= cost;
    const lane = Math.random() < 0.5 ? LANE_X.left : LANE_X.right;
    spawnTroop('enemy', cardKey, lane + (Math.random() * 30 - 15), 90 + Math.random() * 20);
  }
}

function checkWin() {
  const playerKing = towers.find(t => t.side === 'player' && t.isKing);
  const enemyKing = towers.find(t => t.side === 'enemy' && t.isKing);
  if (!playerKing.alive) {
    gameOver = true;
    statusEl.textContent = 'Defeat! Your King Tower has fallen.';
  } else if (!enemyKing.alive) {
    gameOver = true;
    statusEl.textContent = 'Victory! You destroyed the enemy King Tower!';
  }
}

function updateHud() {
  const pct = (playerElixir / MAX_ELIXIR) * 100;
  elixirFill.style.width = pct + '%';
  elixirText.textContent = `${playerElixir.toFixed(1)}/${MAX_ELIXIR}`;
  if (!gameOver) renderHand();
}

function drawTower(t) {
  if (!t.alive) {
    ctx.fillStyle = '#333';
  } else {
    ctx.fillStyle = t.side === 'player' ? '#4a90e2' : '#e24a4a';
  }
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (t.alive) {
    const barW = t.radius * 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(t.x - barW / 2, t.y - t.radius - 10, barW, 5);
    ctx.fillStyle = '#4ad64a';
    ctx.fillRect(t.x - barW / 2, t.y - t.radius - 10, barW * (t.hp / t.maxHp), 5);
  }
}

function drawTroop(u) {
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(u.def.icon, u.x, u.y + 7);
  const barW = 26;
  ctx.fillStyle = '#000';
  ctx.fillRect(u.x - barW / 2, u.y - 22, barW, 4);
  ctx.fillStyle = u.side === 'player' ? '#4a90e2' : '#e24a4a';
  ctx.fillRect(u.x - barW / 2, u.y - 22, barW * (u.hp / u.maxHp), 4);
}

function render() {
  ctx.clearRect(0, 0, W, H);

  // river
  ctx.fillStyle = '#3a6fb0';
  ctx.fillRect(0, H / 2 - 14, W, 28);
  // bridges
  ctx.fillStyle = '#8a6d3b';
  ctx.fillRect(LANE_X.left - 24, H / 2 - 14, 48, 28);
  ctx.fillRect(LANE_X.right - 24, H / 2 - 14, 48, 28);

  for (const t of towers) drawTower(t);
  for (const u of troops) drawTroop(u);

  if (selectedCardIndex !== null) {
    ctx.fillStyle = dragCardIndex !== null
      ? (dragValid ? 'rgba(80,220,80,0.15)' : 'rgba(220,80,80,0.15)')
      : 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, H / 2 + 16, W, H / 2 - 16);
  }

  if (dragCardIndex !== null && dragPos) {
    const cardKey = playerHand[dragCardIndex];
    const def = CARD_TYPES[cardKey];
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(dragPos.x, dragPos.y, def.range, 0, Math.PI * 2);
    ctx.strokeStyle = dragValid ? 'rgba(80,220,80,0.6)' : 'rgba(220,80,80,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.icon, dragPos.x, dragPos.y + 9);
    ctx.restore();
  }
}

initHand();
renderHand();
render();

let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
