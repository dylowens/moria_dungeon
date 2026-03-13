import { DungeonGame } from "./game-logic.js";

const CELL_SIZE = 46;
const BOARD_PADDING = 22;
const ATTACK_HOLD_INITIAL_DELAY = 140;
const ATTACK_HOLD_REPEAT_DELAY = 110;
const FLASH_DURATION = 190;
const FLOOR_FADE_DURATION = 420;

const canvas = document.getElementById("game-canvas");
const context = canvas.getContext("2d");
const restartButton = document.getElementById("restart-button");

const ui = {
  floor: document.getElementById("floor-value"),
  score: document.getElementById("score-value"),
  health: document.getElementById("health-value"),
  dash: document.getElementById("dash-value"),
  objective: document.getElementById("objective-value"),
  status: document.getElementById("status-value"),
};

const directionBindings = {
  ArrowUp: { logical: "up", vector: { x: 0, y: -1 } },
  KeyW: { logical: "up", vector: { x: 0, y: -1 } },
  ArrowDown: { logical: "down", vector: { x: 0, y: 1 } },
  KeyS: { logical: "down", vector: { x: 0, y: 1 } },
  ArrowLeft: { logical: "left", vector: { x: -1, y: 0 } },
  KeyA: { logical: "left", vector: { x: -1, y: 0 } },
  ArrowRight: { logical: "right", vector: { x: 1, y: 0 } },
  KeyD: { logical: "right", vector: { x: 1, y: 0 } },
};

const enemyPalette = {
  stalker: {
    body: "#c94f45",
    face: "#361011",
    health: "#f0b97d",
    aura: "rgba(201, 79, 69, 0.18)",
    borderRadius: 11,
  },
  brute: {
    body: "#8f2f39",
    face: "#2c0d0d",
    health: "#efb17c",
    aura: "rgba(143, 47, 57, 0.22)",
    borderRadius: 9,
  },
  wisp: {
    body: "#4e78c9",
    face: "#12203b",
    health: "#9cc4ff",
    aura: "rgba(78, 120, 201, 0.2)",
    borderRadius: 13,
  },
  shade: {
    body: "#7b5fc6",
    face: "#1f1736",
    health: "#cdb6ff",
    aura: "rgba(123, 95, 198, 0.2)",
    borderRadius: 12,
  },
};

const state = {
  game: new DungeonGame(),
  heldDirections: new Map(),
  actionHeld: new Set(),
  nextAttackAt: 0,
  playerRender: null,
  enemyRenders: new Map(),
  effects: [],
  floorFadeStartedAt: 0,
  lastFrameAt: 0,
};

state.playerRender = { current: { ...state.game.snapshot().player }, tween: null };
syncEnemyRenders(state.game.snapshot().enemies);
syncHud();
requestAnimationFrame(frame);

restartButton.addEventListener("click", () => resetGame());
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", () => {
  state.heldDirections.clear();
  state.actionHeld.clear();
  state.nextAttackAt = 0;
  state.lastFrameAt = 0;
});

function onKeyDown(event) {
  const direction = directionBindings[event.code];
  if (direction) {
    event.preventDefault();
    if (state.heldDirections.has(direction.logical)) {
      return;
    }
    state.heldDirections.set(direction.logical, {
      vector: direction.vector,
      logical: direction.logical,
    });
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    if (state.actionHeld.has("attack")) {
      return;
    }
    state.actionHeld.add("attack");
    const now = performance.now();
    performAttack(now);
    state.nextAttackAt = now + ATTACK_HOLD_INITIAL_DELAY;
    return;
  }

  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    event.preventDefault();
    if (state.actionHeld.has("dash")) {
      return;
    }
    state.actionHeld.add("dash");
    performDash(performance.now());
    return;
  }

  if (event.code === "KeyR") {
    resetGame();
  }
}

function onKeyUp(event) {
  const direction = directionBindings[event.code];
  if (direction) {
    state.heldDirections.delete(direction.logical);
  }

  if (event.code === "Space") {
    state.actionHeld.delete("attack");
    state.nextAttackAt = 0;
  }

  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    state.actionHeld.delete("dash");
  }
}

function updateGameFrame(now, deltaSeconds) {
  const before = state.game.snapshot();
  const result = state.game.updateRealtime(deltaSeconds, movementVector());
  const after = state.game.snapshot();
  applySnapshotTransition(before, after, result, now);
}

function performAttack(now) {
  const before = state.game.snapshot();
  const result = state.game.realtimePlayerAttack();
  const after = state.game.snapshot();
  applySnapshotTransition(before, after, result, now);
}

function performDash(now) {
  const before = state.game.snapshot();
  const result = state.game.realtimePlayerDash();
  const after = state.game.snapshot();
  applySnapshotTransition(before, after, result, now);
}

function applySnapshotTransition(before, after, result, startedAt) {
  state.playerRender.current = { ...after.player };
  syncEnemyRenders(after.enemies);
  spawnEffects(before, after, result, startedAt);
  if (before.floor !== after.floor) {
    state.floorFadeStartedAt = startedAt;
  }
  syncHud();
}

function spawnEffects(before, after, result, startedAt) {
  if (result.attacked) {
    for (const cell of before.attackPositions) {
      state.effects.push({ kind: "slash", position: cell, startedAt, duration: FLASH_DURATION });
    }
  }

  const beforeItems = new Set(before.items.map((item) => `${item.kind}:${item.position.x},${item.position.y}`));
  for (const item of before.items) {
    const signature = `${item.kind}:${item.position.x},${item.position.y}`;
    if (!after.items.find((candidate) => `${candidate.kind}:${candidate.position.x},${candidate.position.y}` === signature)) {
      state.effects.push({
        kind: "pickup",
        position: item.position,
        color: item.kind === "gold" ? "#f5d76d" : "#8d76ff",
        startedAt,
        duration: 280,
      });
      beforeItems.delete(signature);
    }
  }

  const afterById = new Map(after.enemies.map((enemy) => [enemyId(enemy), enemy]));
  for (const enemy of before.enemies) {
    const match = afterById.get(enemyId(enemy));
    if (!match) {
      state.effects.push({ kind: "burst", position: enemy.position, startedAt, duration: 230, color: "#ffd7a0" });
      continue;
    }
    if (match.hp < enemy.hp) {
      state.effects.push({ kind: "hit", position: match.position, startedAt, duration: 180, color: "#ff8d6a" });
    }
  }

  if (result.damageTaken) {
    state.effects.push({ kind: "player-hit", position: after.player, startedAt, duration: 220, color: "#ff7a63" });
  }
}

function syncEnemyRenders(enemies) {
  const next = new Map();
  for (const enemy of enemies) {
    next.set(enemyId(enemy), {
      current: { ...enemy.position },
      tween: null,
      enemy,
    });
  }
  state.enemyRenders = next;
}

function resizeCanvasForDisplay() {
  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  if (!displayWidth || !displayHeight) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const targetWidth = Math.round(displayWidth * ratio);
  const targetHeight = Math.round(displayHeight * ratio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(ratio, ratio);
  }
}

function frame(now) {
  if (state.lastFrameAt === 0) {
    state.lastFrameAt = now;
  }
  resizeCanvasForDisplay();
  const deltaSeconds = Math.min((now - state.lastFrameAt) / 1000, 0.05);
  state.lastFrameAt = now;
  updateGameFrame(now, deltaSeconds);
  processHeldAttack(now);
  state.effects = state.effects.filter((effect) => now - effect.startedAt < effect.duration);
  draw(now);
  requestAnimationFrame(frame);
}

function processHeldAttack(now) {
  if (!state.actionHeld.has("attack") || now < state.nextAttackAt) {
    return;
  }
  state.nextAttackAt = now + ATTACK_HOLD_REPEAT_DELAY;
  performAttack(now);
}

function movementVector() {
  let x = 0;
  let y = 0;
  for (const direction of state.heldDirections.values()) {
    x += direction.vector.x;
    y += direction.vector.y;
  }
  return { x, y };
}

function draw(now) {
  const snapshot = state.game.snapshot();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);

  context.fillStyle = "#0a0e12";
  context.fillRect(0, 0, width, height);

  const boardWidth = snapshot.width * CELL_SIZE;
  const boardHeight = snapshot.height * CELL_SIZE;
  const offsetX = BOARD_PADDING;
  const offsetY = BOARD_PADDING;

  context.strokeStyle = "rgba(85, 108, 119, 0.6)";
  context.lineWidth = 2;
  roundRect(context, offsetX - 14, offsetY - 14, boardWidth + 28, boardHeight + 28, 28);
  context.stroke();

  for (let y = 0; y < snapshot.height; y += 1) {
    for (let x = 0; x < snapshot.width; x += 1) {
      const x1 = offsetX + x * CELL_SIZE;
      const y1 = offsetY + y * CELL_SIZE;
      const wall = snapshot.walls.has(`${x},${y}`);
      context.fillStyle = wall ? "#0f1418" : (x + y + snapshot.floor) % 2 === 0 ? "#243039" : "#1f2b33";
      roundRect(context, x1 + 1, y1 + 1, CELL_SIZE - 2, CELL_SIZE - 2, 9);
      context.fill();
      if (wall) {
        context.strokeStyle = "#53616c";
        context.lineWidth = 1.5;
        roundRect(context, x1 + 2, y1 + 2, CELL_SIZE - 4, CELL_SIZE - 4, 8);
        context.stroke();
        context.fillStyle = "#232d36";
        roundRect(context, x1 + 6, y1 + 6, CELL_SIZE - 12, CELL_SIZE - 12, 5);
        context.fill();
        drawWallGlyph(x1, y1);
        context.strokeStyle = "rgba(189, 204, 214, 0.16)";
        context.beginPath();
        context.moveTo(x1 + 10, y1 + 14);
        context.lineTo(x1 + CELL_SIZE - 12, y1 + 11);
        context.lineTo(x1 + CELL_SIZE - 17, y1 + CELL_SIZE - 11);
        context.stroke();
      }
    }
  }

  if (!snapshot.relicCollected) {
    drawRelic(snapshot.relic, offsetX, offsetY, now);
  }
  drawExit(snapshot.exit, snapshot.exitUnlocked, offsetX, offsetY, now);
  for (const item of snapshot.items) {
    drawItem(item, offsetX, offsetY, now);
  }

  for (const render of state.enemyRenders.values()) {
    drawEnemy(render.enemy, render.current, offsetX, offsetY, now);
  }

  drawEffects(offsetX, offsetY, now);
  drawPlayer(snapshot, offsetX, offsetY, now);

  if (snapshot.gameOver) {
    drawOverlay("You fell in the vault", "Press R or Restart Run");
  } else if (state.floorFadeStartedAt && now - state.floorFadeStartedAt < FLOOR_FADE_DURATION) {
    drawFloorFade(snapshot.floor, now);
  }
}

function drawPlayer(snapshot, offsetX, offsetY, now) {
  const pulse = Math.sin(now / 130) * 1.6;
  const position = state.playerRender.current;
  const { x, y } = worldToScreen(position, offsetX, offsetY);

  context.fillStyle = "#081016";
  context.beginPath();
  context.ellipse(x + CELL_SIZE / 2, y + CELL_SIZE - 8, 16, 7, 0, 0, Math.PI * 2);
  context.fill();

  if (snapshot.hp <= 2 && !snapshot.gameOver) {
    context.strokeStyle = "#ff7a63";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, 21 + Math.sin(now / 80) * 2, 0, Math.PI * 2);
    context.stroke();
  }

  context.fillStyle = "#f5c451";
  context.beginPath();
  context.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, 16 + pulse, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff1b7";
  context.beginPath();
  context.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, 9, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#5a3e0d";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(x + CELL_SIZE / 2, y + CELL_SIZE / 2);
  context.lineTo(
    x + CELL_SIZE / 2 + snapshot.facing.x * 13,
    y + CELL_SIZE / 2 + snapshot.facing.y * 13
  );
  context.stroke();

  drawPlayerHealthBar(snapshot, x, y);
}

function drawPlayerHealthBar(snapshot, x, y) {
  const width = CELL_SIZE - 8;
  const ratio = snapshot.hp / snapshot.maxHp;
  context.fillStyle = "#11171c";
  roundRect(context, x + 4, y - 11, width, 6, 4);
  context.fill();
  context.fillStyle = ratio > 0.5 ? "#93ec9f" : ratio > 0.25 ? "#f4c65e" : "#ff7a63";
  roundRect(context, x + 5, y - 10, Math.max(0, (width - 2) * ratio), 4, 3);
  context.fill();
}

function drawEnemy(enemy, position, offsetX, offsetY, now) {
  const { x, y } = worldToScreen(position, offsetX, offsetY);
  const bob = Math.sin(now / 140 + enemy.position.x * 0.6 + enemy.position.y * 0.3) * 1.8;
  const palette = enemyPalette[enemy.kind] ?? enemyPalette.stalker;

  context.fillStyle = palette.aura;
  context.beginPath();
  context.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, 17 + Math.sin(now / 180) * 1.4, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#11080b";
  context.beginPath();
  context.ellipse(x + CELL_SIZE / 2, y + CELL_SIZE - 7, 15, 6, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.body;
  roundRect(context, x + 8, y + 8 + bob, CELL_SIZE - 16, CELL_SIZE - 16, palette.borderRadius);
  context.fill();

  context.fillStyle = palette.face;
  roundRect(context, x + 12, y + 14 + bob, CELL_SIZE - 24, 6, 3);
  context.fill();

  drawEnemySigil(enemy, x, y, bob);

  context.fillStyle = "#23171a";
  roundRect(context, x + 6, y + CELL_SIZE - 9, CELL_SIZE - 12, 5, 3);
  context.fill();
  context.fillStyle = palette.health;
  roundRect(context, x + 7, y + CELL_SIZE - 8, (CELL_SIZE - 14) * (enemy.hp / enemy.maxHp), 3, 2);
  context.fill();
}

function drawEnemySigil(enemy, x, y, bob) {
  const centerX = x + CELL_SIZE / 2;
  const centerY = y + CELL_SIZE / 2 + bob + 3;
  context.strokeStyle = "rgba(246, 239, 219, 0.66)";
  context.lineWidth = 1.1;
  context.beginPath();
  if (enemy.kind === "wisp") {
    context.arc(centerX, centerY, 5, 0.5, Math.PI * 1.9);
    context.moveTo(centerX - 2, centerY - 6);
    context.lineTo(centerX + 4, centerY - 2);
  } else if (enemy.kind === "shade") {
    context.moveTo(centerX - 5, centerY);
    context.quadraticCurveTo(centerX, centerY - 6, centerX + 5, centerY);
    context.moveTo(centerX - 4, centerY + 3);
    context.quadraticCurveTo(centerX, centerY + 7, centerX + 4, centerY + 3);
  } else if (enemy.kind === "brute") {
    context.moveTo(centerX - 5, centerY - 4);
    context.lineTo(centerX, centerY + 5);
    context.lineTo(centerX + 5, centerY - 4);
  } else {
    context.moveTo(centerX - 5, centerY - 4);
    context.lineTo(centerX + 5, centerY + 4);
    context.moveTo(centerX + 5, centerY - 4);
    context.lineTo(centerX - 5, centerY + 4);
  }
  context.stroke();
}

function drawRelic(position, offsetX, offsetY, now) {
  const { x, y } = worldToScreen(position, offsetX, offsetY);
  const pulse = Math.sin(now / 180) * 3;
  context.fillStyle = "rgba(60, 125, 118, 0.35)";
  context.beginPath();
  context.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, 18 + pulse, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#65d6c2";
  context.beginPath();
  context.moveTo(x + CELL_SIZE / 2, y + 6);
  context.lineTo(x + CELL_SIZE - 10, y + CELL_SIZE / 2);
  context.lineTo(x + CELL_SIZE / 2, y + CELL_SIZE - 6);
  context.lineTo(x + 10, y + CELL_SIZE / 2);
  context.closePath();
  context.fill();
}

function drawExit(position, unlocked, offsetX, offsetY, now) {
  const { x, y } = worldToScreen(position, offsetX, offsetY);
  context.strokeStyle = unlocked ? "#88f0c2" : "#6d7480";
  context.lineWidth = 3;
  roundRect(context, x + 7, y + 7, CELL_SIZE - 14, CELL_SIZE - 14, 10);
  context.stroke();
  if (unlocked) {
    context.fillStyle = `rgba(136, 240, 194, ${0.26 + Math.sin(now / 120) * 0.08})`;
    roundRect(context, x + 12, y + 12, CELL_SIZE - 24, CELL_SIZE - 24, 8);
    context.fill();
  }
}

function drawItem(item, offsetX, offsetY, now) {
  const { x, y } = worldToScreen(item.position, offsetX, offsetY);
  const bob = Math.sin(now / 150 + item.position.x * 0.4) * 2;
  if (item.kind === "gold") {
    context.fillStyle = "#f5d76d";
    context.beginPath();
    context.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2 + bob, 10, 0, Math.PI * 2);
    context.fill();
  } else {
    context.fillStyle = "#8d76ff";
    roundRect(context, x + 15, y + 11 + bob, CELL_SIZE - 30, CELL_SIZE - 22, 8);
    context.fill();
    context.fillStyle = "#e8e0ff";
    roundRect(context, x + 18, y + 8 + bob, CELL_SIZE - 36, 5, 2);
    context.fill();
  }
}

function drawEffects(offsetX, offsetY, now) {
  for (const effect of state.effects) {
    const progress = (now - effect.startedAt) / effect.duration;
    const { x, y } = worldToScreen(effect.position, offsetX, offsetY);
    if (effect.kind === "slash") {
      context.strokeStyle = `rgba(246, 238, 224, ${1 - progress})`;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x + 9, y + CELL_SIZE - 8);
      context.lineTo(x + CELL_SIZE - 8, y + 8);
      context.stroke();
      continue;
    }
    if (effect.kind === "pickup") {
      context.strokeStyle = effect.color;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, 8 + progress * 14, 0, Math.PI * 2);
      context.stroke();
      continue;
    }
    context.strokeStyle = effect.color;
    context.lineWidth = 3;
    roundRect(context, x + 6 - progress * 6, y + 6 - progress * 6, CELL_SIZE - 12 + progress * 12, CELL_SIZE - 12 + progress * 12, 12);
    context.stroke();
  }
}

function drawWallGlyph(x, y) {
  const midX = x + CELL_SIZE / 2;
  const topY = y + 9;
  const bottomY = y + CELL_SIZE - 8;
  context.strokeStyle = "rgba(206, 196, 170, 0.2)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(midX - 11, bottomY);
  context.lineTo(midX - 11, topY + 10);
  context.bezierCurveTo(midX - 11, topY + 4, midX - 5, topY, midX, topY - 3);
  context.bezierCurveTo(midX + 5, topY, midX + 11, topY + 4, midX + 11, topY + 10);
  context.lineTo(midX + 11, bottomY);

  context.moveTo(midX - 7, bottomY);
  context.lineTo(midX - 7, topY + 14);
  context.quadraticCurveTo(midX, topY + 4, midX + 7, topY + 14);
  context.lineTo(midX + 7, bottomY);

  context.moveTo(midX, topY + 3);
  context.lineTo(midX, bottomY - 1);
  context.moveTo(midX - 11, bottomY - 7);
  context.quadraticCurveTo(midX, bottomY - 11, midX + 11, bottomY - 7);
  context.moveTo(midX - 5, topY + 5);
  context.quadraticCurveTo(midX, topY + 1, midX + 5, topY + 5);
  context.moveTo(midX - 14, topY + 22);
  context.quadraticCurveTo(midX - 18, topY + 18, midX - 16, topY + 12);
  context.moveTo(midX + 14, topY + 22);
  context.quadraticCurveTo(midX + 18, topY + 18, midX + 16, topY + 12);
  context.stroke();

  context.strokeStyle = "rgba(150, 191, 183, 0.16)";
  context.beginPath();
  context.moveTo(midX - 2, topY + 1);
  context.lineTo(midX, topY - 2);
  context.lineTo(midX + 2, topY + 1);
  context.moveTo(midX - 3, topY + 17);
  context.lineTo(midX, topY + 14);
  context.lineTo(midX + 3, topY + 17);
  context.stroke();
}

function drawOverlay(title, subtitle) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const panelWidth = 430;
  const panelHeight = 148;
  const panelX = (width - panelWidth) / 2;
  const panelY = (height - panelHeight) / 2;
  context.fillStyle = "rgba(6, 8, 10, 0.72)";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#151b20";
  roundRect(context, panelX, panelY, panelWidth, panelHeight, 24);
  context.fill();
  context.strokeStyle = "rgba(117, 138, 151, 0.5)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#edf4f7";
  context.font = "700 32px Avenir Next";
  context.textAlign = "center";
  context.fillText(title, width / 2, panelY + 58);
  context.fillStyle = "#98a5ae";
  context.font = "500 18px Avenir Next";
  context.fillText(subtitle, width / 2, panelY + 94);
}

function drawFloorFade(floor, now) {
  const progress = Math.min(1, (now - state.floorFadeStartedAt) / FLOOR_FADE_DURATION);
  context.fillStyle = `rgba(8, 12, 15, ${0.55 - progress * 0.45})`;
  context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (progress < 0.8) {
    context.fillStyle = `rgba(237, 244, 247, ${1 - progress})`;
    context.font = "700 36px Avenir Next";
    context.textAlign = "center";
    context.fillText(`Floor ${floor}`, canvas.clientWidth / 2, canvas.clientHeight / 2);
  }
}

function syncHud() {
  const snapshot = state.game.snapshot();
  ui.floor.textContent = String(snapshot.floor);
  ui.score.textContent = `${snapshot.score} / ${snapshot.kills}K`;
  ui.health.textContent = `${snapshot.hp}/${snapshot.maxHp}`;
  ui.dash.textContent = snapshot.dashCooldown <= 0.05 ? "Ready" : `${snapshot.dashCooldown.toFixed(1)}s`;
  ui.objective.textContent = snapshot.gameOver
    ? "Run ended. Restart."
    : snapshot.relicCollected
      ? "Take the exit."
      : snapshot.hp <= 2
        ? "Low HP. Find a potion."
        : "Find the relic.";
  const status = snapshot.messageLog.at(-1) || "Explore the chamber.";
  ui.status.textContent =
    snapshot.hp <= 2 && !snapshot.gameOver
      ? `${snapshot.hp}/${snapshot.maxHp} HP. ${status}`
      : status;
}

function resetGame() {
  state.game.restart();
  state.heldDirections.clear();
  state.actionHeld.clear();
  state.nextAttackAt = 0;
  state.lastFrameAt = 0;
  state.effects = [];
  state.playerRender = { current: { ...state.game.snapshot().player }, tween: null };
  state.floorFadeStartedAt = 0;
  syncEnemyRenders(state.game.snapshot().enemies);
  syncHud();
}

function worldToScreen(position, offsetX, offsetY) {
  return {
    x: offsetX + position.x * CELL_SIZE,
    y: offsetY + position.y * CELL_SIZE,
  };
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function samePosition(a, b) {
  return a.x === b.x && a.y === b.y;
}

function enemyId(enemy) {
  return String(enemy.id);
}
