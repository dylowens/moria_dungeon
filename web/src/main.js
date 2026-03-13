import { DungeonGame } from "./game-logic.js";

const CELL_SIZE = 46;
const BOARD_PADDING = 22;
const HOLD_INITIAL_DELAY = 128;
const HOLD_REPEAT_DELAY = 108;
const ATTACK_HOLD_INITIAL_DELAY = 140;
const ATTACK_HOLD_REPEAT_DELAY = 110;
const MOVE_DURATION = 136;
const FLASH_DURATION = 190;
const FLOOR_FADE_DURATION = 420;
const INPUT_BUFFER_DELAY = 10;
const MAX_BUFFERED_ACTIONS = 3;

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

const state = {
  game: new DungeonGame(),
  heldDirections: new Map(),
  actionHeld: new Set(),
  nextAttackAt: 0,
  queuedActions: [],
  playerRender: null,
  enemyRenders: new Map(),
  effects: [],
  floorFadeStartedAt: 0,
};

state.playerRender = { current: { ...state.game.player }, tween: null };
syncEnemyRenders(state.game.snapshot().enemies);
syncHud();
requestAnimationFrame(frame);

restartButton.addEventListener("click", () => resetGame());
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", () => {
  state.heldDirections.clear();
  state.actionHeld.clear();
  state.queuedActions = [];
  state.nextAttackAt = 0;
});

function onKeyDown(event) {
  const direction = directionBindings[event.code];
  if (direction) {
    event.preventDefault();
    if (state.heldDirections.has(direction.logical)) {
      return;
    }
    const now = performance.now();
    state.heldDirections.set(direction.logical, {
      vector: direction.vector,
      at: now,
      nextRepeatAt: now + HOLD_INITIAL_DELAY,
      logical: direction.logical,
    });
    dispatchAction({
      key: `move:${direction.logical}`,
      run: () => state.game.attemptMove(direction.vector),
    });
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    if (state.actionHeld.has("attack")) {
      return;
    }
    state.actionHeld.add("attack");
    state.nextAttackAt = performance.now() + ATTACK_HOLD_INITIAL_DELAY;
    dispatchAction({ key: "attack", run: () => state.game.playerAttack() });
    return;
  }

  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    event.preventDefault();
    if (state.actionHeld.has("dash")) {
      return;
    }
    state.actionHeld.add("dash");
    dispatchAction({ key: "dash", run: () => state.game.playerDash() });
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
    state.queuedActions = state.queuedActions.filter(
      (action) => action.key !== `move:${direction.logical}` && action.key !== `move:hold:${direction.logical}`
    );
  }

  if (event.code === "Space") {
    state.actionHeld.delete("attack");
    state.nextAttackAt = 0;
  }

  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    state.actionHeld.delete("dash");
  }
}

function dispatchAction(action) {
  if (isAnimating()) {
    queueAction(action, performance.now() + INPUT_BUFFER_DELAY);
    return;
  }
  runAction(action);
}

function queueAction(action, readyAt = performance.now()) {
  const queued = { ...action, readyAt };
  if (state.queuedActions.length > 0) {
    const last = state.queuedActions[state.queuedActions.length - 1];
    if (last.key === queued.key) {
      state.queuedActions[state.queuedActions.length - 1] = queued;
      return;
    }
  }
  state.queuedActions.push(queued);
  if (state.queuedActions.length > MAX_BUFFERED_ACTIONS) {
    state.queuedActions.shift();
  }
}

function runAction(action) {
  const startedAt = performance.now();
  const before = state.game.snapshot();
  const result = action.run();
  const after = state.game.snapshot();

  if (!samePosition(before.player, after.player)) {
    state.playerRender.tween = {
      start: before.player,
      end: after.player,
      startedAt,
      duration: MOVE_DURATION,
    };
    state.playerRender.current = { ...before.player };
  } else {
    state.playerRender.tween = null;
    state.playerRender.current = { ...after.player };
  }

  const beforeEnemies = new Map(before.enemies.map((enemy) => [enemyId(enemy), enemy]));
  syncEnemyRenders(after.enemies, beforeEnemies, startedAt);
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

function syncEnemyRenders(enemies, beforeEnemies = new Map(), startedAt = performance.now()) {
  const next = new Map();
  for (const enemy of enemies) {
    const previous = beforeEnemies.get(enemyId(enemy));
    next.set(enemyId(enemy), {
      current: previous ? { ...previous.position } : { ...enemy.position },
      tween:
        previous && !samePosition(previous.position, enemy.position)
          ? { start: previous.position, end: enemy.position, startedAt, duration: MOVE_DURATION }
          : null,
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
  resizeCanvasForDisplay();
  updateAnimations(now);
  processHeldMovement(now);
  processHeldAttack(now);
  draw(now);
  requestAnimationFrame(frame);
}

function updateAnimations(now) {
  if (state.playerRender.tween) {
    const progress = Math.min(1, (now - state.playerRender.tween.startedAt) / state.playerRender.tween.duration);
    state.playerRender.current = interpolate(state.playerRender.tween.start, state.playerRender.tween.end, smoothStep(progress));
    if (progress >= 1) {
      state.playerRender.current = { ...state.playerRender.tween.end };
      state.playerRender.tween = null;
    }
  }

  for (const render of state.enemyRenders.values()) {
    if (!render.tween) {
      render.current = { ...render.enemy.position };
      continue;
    }
    const progress = Math.min(1, (now - render.tween.startedAt) / render.tween.duration);
    render.current = interpolate(render.tween.start, render.tween.end, smoothStep(progress));
    if (progress >= 1) {
      render.current = { ...render.tween.end };
      render.tween = null;
    }
  }

  state.effects = state.effects.filter((effect) => now - effect.startedAt < effect.duration);

  if (!isAnimating() && state.queuedActions.length > 0) {
    const next = state.queuedActions[0];
    if (now >= next.readyAt) {
      state.queuedActions.shift();
      runAction(next);
    }
  }
}

function processHeldMovement(now) {
  if (state.heldDirections.size === 0) {
    return;
  }
  const direction = [...state.heldDirections.values()].sort((left, right) => right.at - left.at)[0];
  if (now < direction.nextRepeatAt) {
    return;
  }
  if (isAnimating()) {
    if (
      state.playerRender.tween &&
      !hasQueuedMoveAction(direction.logical) &&
      now - state.playerRender.tween.startedAt >= state.playerRender.tween.duration * 0.72
    ) {
      queueHeldMove(direction, now);
    }
    return;
  }
  queueHeldMove(direction, now);
}

function queueHeldMove(direction, now) {
  const target = {
    x: state.game.player.x + direction.vector.x,
    y: state.game.player.y + direction.vector.y,
  };
  if (!state.game.isWalkable(target) && !state.game.enemyAt(target)) {
    direction.nextRepeatAt = now + HOLD_REPEAT_DELAY;
    return;
  }
  direction.nextRepeatAt = now + HOLD_REPEAT_DELAY;
  dispatchAction({
    key: `move:hold:${direction.logical}`,
    run: () => state.game.attemptMove(direction.vector),
  });
}

function hasQueuedMoveAction(logical) {
  return state.queuedActions.some((action) => action.key === `move:hold:${logical}`);
}

function processHeldAttack(now) {
  if (!state.actionHeld.has("attack") || isAnimating() || now < state.nextAttackAt) {
    return;
  }
  state.nextAttackAt = now + ATTACK_HOLD_REPEAT_DELAY;
  dispatchAction({ key: "attack", run: () => state.game.playerAttack() });
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
  const x = offsetX + position.x * CELL_SIZE;
  const y = offsetY + position.y * CELL_SIZE;

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
  const x = offsetX + position.x * CELL_SIZE;
  const y = offsetY + position.y * CELL_SIZE;
  const bob = Math.sin(now / 140 + enemy.position.x * 0.6 + enemy.position.y * 0.3) * 1.8;

  context.fillStyle = "#11080b";
  context.beginPath();
  context.ellipse(x + CELL_SIZE / 2, y + CELL_SIZE - 7, 15, 6, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = enemy.kind === "brute" ? "#932b31" : "#cb5d4c";
  roundRect(context, x + 8, y + 8 + bob, CELL_SIZE - 16, CELL_SIZE - 16, enemy.kind === "brute" ? 9 : 11);
  context.fill();

  context.fillStyle = "#2c0d0d";
  roundRect(context, x + 12, y + 14 + bob, CELL_SIZE - 24, 6, 3);
  context.fill();

  context.fillStyle = "#23171a";
  roundRect(context, x + 6, y + CELL_SIZE - 9, CELL_SIZE - 12, 5, 3);
  context.fill();
  context.fillStyle = "#f0b97d";
  roundRect(context, x + 7, y + CELL_SIZE - 8, (CELL_SIZE - 14) * (enemy.hp / enemy.maxHp), 3, 2);
  context.fill();
}

function drawRelic(position, offsetX, offsetY, now) {
  const x = offsetX + position.x * CELL_SIZE;
  const y = offsetY + position.y * CELL_SIZE;
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
  const x = offsetX + position.x * CELL_SIZE;
  const y = offsetY + position.y * CELL_SIZE;
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
  const x = offsetX + item.position.x * CELL_SIZE;
  const y = offsetY + item.position.y * CELL_SIZE;
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
    const x = offsetX + effect.position.x * CELL_SIZE;
    const y = offsetY + effect.position.y * CELL_SIZE;
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
  ui.dash.textContent = snapshot.dashCooldown === 0 ? "Ready" : `${snapshot.dashCooldown}T`;
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
  state.queuedActions = [];
  state.heldDirections.clear();
  state.actionHeld.clear();
  state.nextAttackAt = 0;
  state.effects = [];
  state.playerRender = { current: { ...state.game.player }, tween: null };
  state.floorFadeStartedAt = 0;
  syncEnemyRenders(state.game.snapshot().enemies);
  syncHud();
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

function isAnimating() {
  if (state.playerRender.tween) {
    return true;
  }
  for (const render of state.enemyRenders.values()) {
    if (render.tween) {
      return true;
    }
  }
  return false;
}

function interpolate(start, end, progress) {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function samePosition(a, b) {
  return a.x === b.x && a.y === b.y;
}

function enemyId(enemy) {
  return String(enemy.id);
}
