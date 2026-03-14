export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 14;
const MAX_GENERATION_ATTEMPTS = 80;

function makeRng(seed = Date.now()) {
  let state = seed >>> 0;
  return {
    next() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    int(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    choice(values) {
      return values[Math.floor(this.next() * values.length)];
    },
    shuffle(values) {
      for (let index = values.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(this.next() * (index + 1));
        [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
      }
      return values;
    },
  };
}

function keyOf(position) {
  return `${position.x},${position.y}`;
}

function samePosition(a, b) {
  return a.x === b.x && a.y === b.y;
}

function clonePosition(position) {
  return { x: position.x, y: position.y };
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

function neighbors(position) {
  return [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 },
  ];
}

const ENEMY_PROFILES = {
  stalker: {
    hp: 3,
    damage: 1,
    reward: 10,
    speed: 2.35,
    radius: 0.25,
    attackCooldown: 0.9,
    personality: "aggressive",
    hpGrowth: 1,
    damageTaken: { slash: 1.25, thrust: 1, crush: 0.9 },
    staggerThreshold: 0.45,
  },
  brute: {
    hp: 7,
    damage: 2,
    reward: 18,
    speed: 1.72,
    radius: 0.3,
    attackCooldown: 1.15,
    personality: "aggressive",
    hpGrowth: 2,
    damageTaken: { slash: 0.45, thrust: 0.82, crush: 1.3 },
    staggerThreshold: 1.1,
  },
  wisp: {
    hp: 2,
    damage: 1,
    reward: 12,
    speed: 2.7,
    radius: 0.22,
    attackCooldown: 0.78,
    personality: "random",
    hpGrowth: 1,
    damageTaken: { slash: 1, thrust: 1.35, crush: 0.72 },
    staggerThreshold: 0.35,
  },
  shade: {
    hp: 4,
    damage: 1,
    reward: 14,
    speed: 2.05,
    radius: 0.24,
    attackCooldown: 1,
    personality: "confused",
    hpGrowth: 1,
    damageTaken: { slash: 1.15, thrust: 0.72, crush: 1.05 },
    staggerThreshold: 0.65,
  },
};

const ATTACK_STYLES = [
  { key: "slash", name: "Slash", damage: 3, range: 1.42, minAlignment: 0.12, recovery: 0.2, comboWindow: 0.7, staggerPower: 0.45, staggerDuration: 0.34 },
  { key: "thrust", name: "Thrust", damage: 3, range: 1.82, minAlignment: 0.62, recovery: 0.24, comboWindow: 0.62, staggerPower: 0.72, staggerDuration: 0.42 },
  { key: "crush", name: "Crush", damage: 4, range: 1.5, minAlignment: 0.22, recovery: 0.34, comboWindow: 0.78, staggerPower: 1.25, staggerDuration: 0.7 },
];

export class DungeonGame {
  constructor({ width = GRID_WIDTH, height = GRID_HEIGHT, seed = Date.now() } = {}) {
    this.width = width;
    this.height = height;
    this.rng = makeRng(seed);
    this.maxHp = 8;
    this.playerMoveSpeed = 4.8;
    this.playerRadius = 0.28;
    this.enemyAttackRange = 0.76;
    this.alertDuration = 1.35;
    this.realtimeDashCooldownDuration = 2.4;
    this.restart();
  }

  restart() {
    this.nextEnemyId = 1;
    this.floor = 1;
    this.score = 0;
    this.kills = 0;
    this.hp = this.maxHp;
    this.facing = { x: 0, y: 1 };
    this.relicCollected = false;
    this.exitUnlocked = false;
    this.gameOver = false;
    this.turnCount = 0;
    this.dashCooldown = 0;
    this.alertTicks = 0;
    this.alertTimer = 0;
    this.realtimeDashCooldown = 0;
    this.realtimeAttackRecovery = 0;
    this.attackComboIndex = 0;
    this.attackComboTimer = 0;
    this.messageLog = [];
    this.generateFloor();
    this.pushMessage("Descend into the vault and recover the relic.");
  }

  attemptMove(direction) {
    this.syncTurnState();
    if (this.gameOver) {
      return { gameOver: true, logMessage: "The dungeon run is over." };
    }

    this.facing = { ...direction };
    const target = { x: this.player.x + direction.x, y: this.player.y + direction.y };
    if (this.enemyAt(target)) {
      return { logMessage: "An enemy blocks your path." };
    }

    if (!this.isWalkable(target)) {
      return this.finishTurn({ logMessage: "Stone blocks the way." });
    }

    this.player = target;
    this.alertTicks = 3;
    const pickedItem = this.collectItemAtPlayer();
    if (samePosition(this.player, this.relic) && !this.relicCollected) {
      this.relicCollected = true;
      this.exitUnlocked = true;
      this.score += 25;
      this.pushMessage("The relic hums. The exit gate is open.");
    }
    const floorCleared = this.tryExitFloor();
    return this.finishTurn({ moved: true, pickedItem, floorCleared });
  }

  playerAttack() {
    this.syncTurnState();
    if (this.gameOver) {
      return { gameOver: true, logMessage: "The dungeon run is over." };
    }
    const outcome = this.resolvePlayerAttack({
      playerPosition: this.player,
      facing: this.facing,
      useRealtimeRecovery: false,
    });
    return this.finishTurn({
      attacked: true,
      enemyDefeated: outcome.enemyDefeated,
      logMessage: outcome.logMessage,
    });
  }

  playerDash() {
    this.syncTurnState();
    if (this.gameOver) {
      return { gameOver: true, logMessage: "The dungeon run is over." };
    }
    if (this.dashCooldown > 0) {
      return { logMessage: `Dash recharges in ${this.dashCooldown} turn(s).` };
    }

    let nextPosition = clonePosition(this.player);
    for (let step = 0; step < 2; step += 1) {
      const candidate = { x: nextPosition.x + this.facing.x, y: nextPosition.y + this.facing.y };
      if (!this.isWalkable(candidate) || this.enemyAt(candidate)) {
        break;
      }
      nextPosition = candidate;
    }

    if (samePosition(nextPosition, this.player)) {
      return this.finishTurn({ logMessage: "No room to dash forward." });
    }

    this.player = nextPosition;
    this.dashCooldown = 4;
    this.alertTicks = 4;
    const pickedItem = this.collectItemAtPlayer();
    if (samePosition(this.player, this.relic) && !this.relicCollected) {
      this.relicCollected = true;
      this.exitUnlocked = true;
      this.score += 25;
      this.pushMessage("You snatch the relic mid-dash. The exit gate opens.");
    }
    const floorCleared = this.tryExitFloor();
    return this.finishTurn({ dashed: true, pickedItem, floorCleared });
  }

  updateRealtime(deltaSeconds, movementInput = { x: 0, y: 0 }) {
    if (this.gameOver) {
      return { gameOver: true, logMessage: "The dungeon run is over." };
    }

    const clampedDelta = Math.min(deltaSeconds, 0.05);
    if (this.realtimeDashCooldown > 0) {
      this.realtimeDashCooldown = Math.max(0, this.realtimeDashCooldown - clampedDelta);
    }
    if (this.realtimeAttackRecovery > 0) {
      this.realtimeAttackRecovery = Math.max(0, this.realtimeAttackRecovery - clampedDelta);
    }
    if (this.attackComboTimer > 0) {
      this.attackComboTimer = Math.max(0, this.attackComboTimer - clampedDelta);
      if (this.attackComboTimer === 0) {
        this.attackComboIndex = 0;
      }
    }

    const direction = normalize(movementInput);
    let playerMoved = false;
    if (direction.x !== 0 || direction.y !== 0) {
      this.facing = direction;
      playerMoved = this.moveWorldEntity(this.playerWorld, direction, this.playerMoveSpeed * clampedDelta, null, this.playerRadius);
      if (playerMoved) {
        this.alertTimer = this.alertDuration;
      }
    } else if (this.alertTimer > 0) {
      this.alertTimer = Math.max(0, this.alertTimer - clampedDelta);
    }

    const pickedItem = this.collectItemAtWorldPosition();
    let relicCollected = false;
    if (!this.relicCollected && distance(this.playerWorld, this.relic) <= 0.34) {
      this.relicCollected = true;
      this.exitUnlocked = true;
      this.score += 25;
      relicCollected = true;
      this.pushMessage("The relic hums. The exit gate is open.");
    }

    if (this.exitUnlocked && distance(this.playerWorld, this.exit) <= 0.38) {
      const previousFloor = this.floor;
      const floorCleared = this.tryExitFloor();
      return {
        moved: playerMoved,
        pickedItem,
        relicCollected,
        floorCleared,
        floorChanged: this.floor !== previousFloor,
        damageTaken: 0,
      };
    }

    let damageTaken = 0;
    const trackingPlayer = playerMoved || this.alertTimer > 0;
    for (const enemy of this.enemies) {
      enemy.attackCooldown = Math.max(0, (enemy.attackCooldown ?? 0) - clampedDelta);
      enemy.staggerTimer = Math.max(0, (enemy.staggerTimer ?? 0) - clampedDelta);
      const enemyPosition = enemy.worldPosition ?? enemy.position;
      if (enemy.staggerTimer > 0) {
        continue;
      }
      const enemyDistance = distance(enemyPosition, this.playerWorld);
      if (enemyDistance <= this.enemyAttackRange) {
        enemy.facing = this.directionTowardPlayer(enemyPosition);
        if (enemy.attackCooldown <= 0) {
          this.hp -= enemy.damage;
          damageTaken += enemy.damage;
          enemy.attackCooldown = this.enemyProfile(enemy.kind).attackCooldown;
        }
        continue;
      }

      const desiredDirection = this.enemyDesiredDirection(enemy, enemyPosition, trackingPlayer, clampedDelta);
      enemy.facing = desiredDirection;
      this.moveWorldEntity(
        enemyPosition,
        desiredDirection,
        this.enemyProfile(enemy.kind).speed * clampedDelta,
        enemy,
        this.enemyProfile(enemy.kind).radius
      );
      enemy.worldPosition = enemyPosition;
    }

    if (this.hp <= 0) {
      this.gameOver = true;
      const finalMessage = "You fall beneath the dungeon.";
      this.pushMessage(finalMessage);
      return { gameOver: true, damageTaken, logMessage: finalMessage };
    }

    return {
      moved: playerMoved,
      pickedItem,
      relicCollected,
      damageTaken,
      enemyMoved: true,
    };
  }

  directionTowardPlayer(enemyPosition) {
    return normalize({
      x: this.playerWorld.x - enemyPosition.x,
      y: this.playerWorld.y - enemyPosition.y,
    });
  }

  directionAwayFromPlayer(enemyPosition) {
    return normalize({
      x: enemyPosition.x - this.playerWorld.x,
      y: enemyPosition.y - this.playerWorld.y,
    });
  }

  enemyDesiredDirection(enemy, enemyPosition, trackingPlayer, deltaSeconds) {
    const personality = enemy.personality ?? this.enemyProfile(enemy.kind).personality;
    if (!trackingPlayer) {
      return this.directionForRoaming(enemy, deltaSeconds);
    }

    if (personality === "random") {
      enemy.randomModeTimer = (enemy.randomModeTimer ?? 0) - deltaSeconds;
      if (enemy.randomModeTimer <= 0 || !enemy.randomMode) {
        enemy.randomMode = this.rng.next() < 0.58 ? "roam" : "track";
        enemy.randomModeTimer = this.rng.next() * 0.55 + 0.3;
      }
      return enemy.randomMode === "roam"
        ? this.directionForRoaming(enemy, deltaSeconds)
        : this.directionTowardPlayer(enemyPosition);
    }

    if (personality === "confused") {
      enemy.confusedTimer = (enemy.confusedTimer ?? 0) - deltaSeconds;
      if (enemy.confusedTimer <= 0) {
        enemy.confusedTimer = this.rng.next() * 0.9 + 0.35;
        enemy.confusedMode = enemy.confusedMode === "flee" ? "chase" : "flee";
      }
      return enemy.confusedMode === "flee"
        ? this.directionAwayFromPlayer(enemyPosition)
        : this.directionTowardPlayer(enemyPosition);
    }

    return this.directionTowardPlayer(enemyPosition);
  }

  directionForRoaming(enemy, deltaSeconds) {
    enemy.wanderTimer = (enemy.wanderTimer ?? 0) - deltaSeconds;
    if (enemy.wanderTimer <= 0 || !enemy.wanderDirection) {
      enemy.wanderDirection = this.randomWanderDirection();
      enemy.wanderTimer = this.rng.next() * 1.2 + 0.5;
    }
    return normalize(enemy.wanderDirection);
  }

  currentAttackStyle() {
    if (this.attackComboTimer <= 0) {
      this.attackComboIndex = 0;
    }
    return ATTACK_STYLES[this.attackComboIndex] ?? ATTACK_STYLES[0];
  }

  resolvePlayerAttack({ playerPosition, facing, useRealtimeRecovery }) {
    const normalizedFacing = normalize(facing.x === 0 && facing.y === 0 ? { x: 0, y: 1 } : facing);
    const style = this.currentAttackStyle();
    let enemyDefeated = 0;
    let hitCount = 0;
    let staggeredCount = 0;

    for (const enemy of [...this.enemies]) {
      const enemyPosition = enemy.worldPosition ?? enemy.position;
      const toEnemy = {
        x: enemyPosition.x - playerPosition.x,
        y: enemyPosition.y - playerPosition.y,
      };
      const enemyDistance = Math.hypot(toEnemy.x, toEnemy.y);
      if (enemyDistance > style.range) {
        continue;
      }

      const enemyDirection = enemyDistance === 0
        ? normalizedFacing
        : { x: toEnemy.x / enemyDistance, y: toEnemy.y / enemyDistance };
      const alignment = enemyDirection.x * normalizedFacing.x + enemyDirection.y * normalizedFacing.y;
      if (alignment < style.minAlignment) {
        continue;
      }

      const profile = this.enemyProfile(enemy.kind);
      const multiplier = profile.damageTaken?.[style.key] ?? 1;
      const damage = Math.max(1, Math.round(style.damage * multiplier));
      enemy.hp -= damage;
      hitCount += 1;

      if (style.staggerPower >= (profile.staggerThreshold ?? 1)) {
        enemy.staggerTimer = Math.max(enemy.staggerTimer ?? 0, style.staggerDuration ?? 0.4);
        staggeredCount += 1;
      }

      if (enemy.hp <= 0) {
        this.enemies = this.enemies.filter((candidate) => candidate !== enemy);
        enemyDefeated += 1;
        this.kills += 1;
        this.score += enemy.reward;
      }
    }

    if (useRealtimeRecovery) {
      this.realtimeAttackRecovery = style.recovery;
    }

    if (hitCount > 0) {
      this.attackComboIndex = (this.attackComboIndex + 1) % ATTACK_STYLES.length;
      this.attackComboTimer = style.comboWindow;
    } else {
      this.attackComboIndex = 0;
      this.attackComboTimer = 0;
    }

    return {
      style,
      enemyDefeated,
      hitCount,
      staggeredCount,
      logMessage: this.attackLogMessage(style, hitCount, enemyDefeated, staggeredCount),
    };
  }

  attackLogMessage(style, hitCount, enemyDefeated, staggeredCount) {
    if (hitCount === 0) {
      return `${style.name} misses and the air answers back.`;
    }
    if (enemyDefeated > 0) {
      return `${style.name} lands hard. ${enemyDefeated === 1 ? "A foe falls." : "Foes fall."}`;
    }
    if (staggeredCount > 0) {
      return `${style.name} breaks their footing.`;
    }
    return `${style.name} bites into the line.`;
  }

  moveWorldEntity(position, direction, distanceAmount, selfEnemy = null, radius = this.playerRadius) {
    if (!position || distanceAmount <= 0 || (direction.x === 0 && direction.y === 0)) {
      return false;
    }

    const normalized = normalize(direction);
    const deltaX = normalized.x * distanceAmount;
    const deltaY = normalized.y * distanceAmount;
    let moved = false;

    if (deltaX !== 0) {
      const candidate = { x: position.x + deltaX, y: position.y };
      if (!this.collidesAtWorldPosition(candidate, radius, selfEnemy)) {
        position.x = candidate.x;
        moved = true;
      }
    }

    if (deltaY !== 0) {
      const candidate = { x: position.x, y: position.y + deltaY };
      if (!this.collidesAtWorldPosition(candidate, radius, selfEnemy)) {
        position.y = candidate.y;
        moved = true;
      }
    }

    return moved;
  }

  collidesAtWorldPosition(position, radius, selfEnemy = null) {
    const minTileX = Math.floor(position.x - radius - 0.5);
    const maxTileX = Math.ceil(position.x + radius + 0.5);
    const minTileY = Math.floor(position.y - radius - 0.5);
    const maxTileY = Math.ceil(position.y + radius + 0.5);

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        if (!this.walls.has(`${tileX},${tileY}`)) {
          continue;
        }
        const nearestX = clamp(position.x, tileX - 0.5, tileX + 0.5);
        const nearestY = clamp(position.y, tileY - 0.5, tileY + 0.5);
        if (Math.hypot(position.x - nearestX, position.y - nearestY) < radius) {
          return true;
        }
      }
    }

    for (const enemy of this.enemies) {
      if (enemy === selfEnemy) {
        continue;
      }
      const enemyPosition = enemy.worldPosition ?? enemy.position;
      const enemyRadius = this.enemyProfile(enemy.kind).radius;
      if (distance(position, enemyPosition) < radius + enemyRadius - 0.02) {
        return true;
      }
    }

    if (selfEnemy && distance(position, this.playerWorld) < radius + this.playerRadius - 0.02) {
      return true;
    }

    return false;
  }

  collectItemAtWorldPosition() {
    const item = this.items.find((candidate) => distance(candidate.position, this.playerWorld) <= 0.34);
    if (!item) {
      return null;
    }
    this.items = this.items.filter((candidate) => candidate !== item);
    if (item.kind === "gold") {
      this.score += item.value;
    } else if (item.kind === "potion") {
      this.hp = Math.min(this.maxHp, this.hp + item.value);
    }
    return item.kind;
  }

  realtimePlayerAttack() {
    if (this.gameOver) {
      return { gameOver: true, logMessage: "The dungeon run is over." };
    }
    if (this.realtimeAttackRecovery > 0) {
      return { attacked: false, enemyDefeated: 0, logMessage: "" };
    }

    const outcome = this.resolvePlayerAttack({
      playerPosition: this.playerWorld,
      facing: this.facing,
      useRealtimeRecovery: true,
    });
    this.pushMessage(outcome.logMessage);
    return { attacked: true, enemyDefeated: outcome.enemyDefeated, logMessage: outcome.logMessage };
  }

  realtimePlayerDash() {
    if (this.gameOver) {
      return { gameOver: true, logMessage: "The dungeon run is over." };
    }
    if (this.realtimeDashCooldown > 0) {
      return { logMessage: `Dash recharges in ${this.realtimeDashCooldown.toFixed(1)}s.` };
    }

    const facing = normalize(this.facing.x === 0 && this.facing.y === 0 ? { x: 0, y: 1 } : this.facing);
    const start = clonePosition(this.playerWorld);
    const steps = 14;
    for (let step = 0; step < steps; step += 1) {
      const candidate = {
        x: this.playerWorld.x + (facing.x * 2) / steps,
        y: this.playerWorld.y + (facing.y * 2) / steps,
      };
      if (this.collidesAtWorldPosition(candidate, this.playerRadius, null)) {
        break;
      }
      this.playerWorld = candidate;
    }

    if (distance(start, this.playerWorld) < 0.08) {
      return { logMessage: "No room to dash forward." };
    }

    this.realtimeDashCooldown = this.realtimeDashCooldownDuration;
    this.alertTimer = this.alertDuration;
    const pickedItem = this.collectItemAtWorldPosition();
    if (!this.relicCollected && distance(this.playerWorld, this.relic) <= 0.34) {
      this.relicCollected = true;
      this.exitUnlocked = true;
      this.score += 25;
      this.pushMessage("You snatch the relic mid-dash. The exit gate opens.");
    }
    const previousFloor = this.floor;
    const floorCleared = this.exitUnlocked && distance(this.playerWorld, this.exit) <= 0.38 ? this.tryExitFloor() : false;
    return {
      dashed: true,
      pickedItem,
      floorCleared,
      floorChanged: this.floor !== previousFloor,
      logMessage: floorCleared ? "You descend deeper into the dungeon." : "",
    };
  }

  finishTurn({
    moved = false,
    dashed = false,
    attacked = false,
    pickedItem = null,
    enemyDefeated = 0,
    floorCleared = false,
    logMessage = "",
  } = {}) {
    if (floorCleared) {
      const summary = {
        moved,
        dashed,
        attacked,
        pickedItem,
        enemyDefeated,
        floorCleared: true,
        logMessage: logMessage || "You descend deeper into the dungeon.",
      };
      this.pushMessage(summary.logMessage);
      return summary;
    }

    this.turnCount += 1;
    if (this.dashCooldown > 0) {
      this.dashCooldown -= 1;
    }

    if (this.hp <= 0) {
      this.gameOver = true;
      const finalMessage = "You fall beneath the dungeon.";
      this.pushMessage(finalMessage);
      return {
        moved,
        dashed,
        attacked,
        pickedItem,
        enemyDefeated,
        gameOver: true,
        logMessage: finalMessage,
      };
    }

    const summaryMessage = logMessage || this.composeSummary(pickedItem, enemyDefeated, 0);
    this.pushMessage(summaryMessage);
    return {
      moved,
      dashed,
      attacked,
      pickedItem,
      enemyDefeated,
      damageTaken: 0,
      logMessage: summaryMessage,
    };
  }

  worldTick() {
    this.syncTurnState();
    if (this.gameOver) {
      return { gameOver: true, logMessage: "The dungeon run is over." };
    }

    const trackingPlayer = this.alertTicks > 0;
    const { damageTaken, enemyMoved } = this.advanceEnemies({ trackingPlayer });
    if (this.alertTicks > 0) {
      this.alertTicks -= 1;
    }

    if (this.hp <= 0) {
      this.gameOver = true;
      const finalMessage = "You fall beneath the dungeon.";
      this.pushMessage(finalMessage);
      return {
        damageTaken,
        gameOver: true,
        enemyMoved,
        logMessage: finalMessage,
      };
    }

    const logMessage = damageTaken
      ? `The vault's guardians strike for ${damageTaken}.`
      : trackingPlayer
        ? "The vault stirs around your steps."
        : "";

    if (logMessage) {
      this.pushMessage(logMessage);
    }

    return {
      damageTaken,
      enemyMoved,
      logMessage,
    };
  }

  composeSummary(pickedItem, enemyDefeated, damageTaken) {
    const parts = [];
    if (pickedItem === "gold") {
      parts.push("You pocket scattered gold.");
    } else if (pickedItem === "potion") {
      parts.push("You drink a crimson tonic.");
    }
    if (enemyDefeated === 1) {
      parts.push("An enemy crumples.");
    } else if (enemyDefeated > 1) {
      parts.push("Several foes crumple.");
    }
    if (damageTaken) {
      parts.push(`You suffer ${damageTaken} damage.`);
    }
    if (parts.length === 0) {
      parts.push("The chamber shifts around you.");
    }
    return parts.join(" ");
  }

  generateFloor() {
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const walls = this.buildWalls();
      const floors = [];
      for (let y = 1; y < this.height - 1; y += 1) {
        for (let x = 1; x < this.width - 1; x += 1) {
          if (!walls.has(`${x},${y}`)) {
            floors.push({ x, y });
          }
        }
      }

      if (floors.length < 25) {
        continue;
      }

      const player = this.rng.choice(floors);
      const distances = this.bfsDistances(player, walls);
      const reachable = [...distances.entries()]
        .filter(([, distance]) => distance >= 4)
        .map(([encoded]) => {
          const [x, y] = encoded.split(",").map(Number);
          return { x, y };
        });

      if (reachable.length < 10) {
        continue;
      }

      const relic = reachable.reduce((best, position) =>
        distances.get(keyOf(position)) > distances.get(keyOf(best)) ? position : best
      );
      const exitCandidates = reachable.filter((position) => !samePosition(position, relic));
      const exit = exitCandidates.reduce((best, position) =>
        distances.get(keyOf(position)) > distances.get(keyOf(best)) ? position : best
      );

      const reserved = new Set([keyOf(player), keyOf(relic), keyOf(exit)]);
      const items = this.placeItems(distances, reserved);
      for (const item of items) {
        reserved.add(keyOf(item.position));
      }
      const enemies = this.placeEnemies(distances, reserved);
      if (enemies.length === 0) {
        continue;
      }

      this.walls = walls;
      this.player = clonePosition(player);
      this.relic = clonePosition(relic);
      this.exit = clonePosition(exit);
      this.items = items;
      this.enemies = enemies;
      this.relicCollected = false;
      this.exitUnlocked = false;
      this.alertTicks = 0;
      this.initializeRealtimeState();
      return;
    }

    throw new Error("Unable to generate a valid dungeon floor.");
  }

  initializeRealtimeState() {
    this.playerWorld = clonePosition(this.player);
    this.alertTimer = 0;
    this.realtimeDashCooldown = 0;
    this.realtimeAttackRecovery = 0;
    this.attackComboIndex = 0;
    this.attackComboTimer = 0;
    for (const enemy of this.enemies) {
      enemy.worldPosition = clonePosition(enemy.position);
      enemy.wanderDirection = this.randomWanderDirection();
      enemy.wanderTimer = this.rng.next() * 0.8 + 0.35;
      enemy.attackCooldown = 0;
      enemy.staggerTimer = 0;
      enemy.personality = enemy.personality ?? this.enemyProfile(enemy.kind).personality;
      enemy.confusedTimer = this.rng.next() * 0.7 + 0.2;
      enemy.randomMode = "roam";
      enemy.randomModeTimer = this.rng.next() * 0.45 + 0.25;
    }
  }

  randomWanderDirection() {
    return clonePosition(this.rng.choice([
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]));
  }

  enemyProfile(kind) {
    return ENEMY_PROFILES[kind] ?? ENEMY_PROFILES.stalker;
  }

  createEnemy(kind, position) {
    const profile = this.enemyProfile(kind);
    const floorTier = Math.floor((this.floor - 1) / 3);
    const scaledHp = profile.hp + floorTier * (profile.hpGrowth ?? 1);
    return {
      id: this.nextEnemyId++,
      kind,
      position: clonePosition(position),
      hp: scaledHp,
      maxHp: scaledHp,
      damage: profile.damage,
      reward: profile.reward + floorTier * 3,
      personality: profile.personality,
      staggerTimer: 0,
    };
  }

  syncTurnState() {
    this.playerWorld = clonePosition(this.player);
    for (const enemy of this.enemies) {
      enemy.worldPosition = clonePosition(enemy.position);
    }
  }

  buildWalls() {
    const walls = new Set();
    for (let x = 0; x < this.width; x += 1) {
      walls.add(`${x},0`);
      walls.add(`${x},${this.height - 1}`);
    }
    for (let y = 0; y < this.height; y += 1) {
      walls.add(`0,${y}`);
      walls.add(`${this.width - 1},${y}`);
    }

    const pillarCount = 10 + this.floor * 2;
    for (let index = 0; index < pillarCount; index += 1) {
      const x = this.rng.int(2, this.width - 3);
      const y = this.rng.int(2, this.height - 3);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
        if (this.rng.next() < 0.7) {
          walls.add(`${x + dx},${y + dy}`);
        }
      }
    }

    return walls;
  }

  placeItems(distances, reserved) {
    const candidates = [...distances.entries()]
      .filter(([, distance]) => distance >= 2)
      .map(([encoded]) => {
        const [x, y] = encoded.split(",").map(Number);
        return { x, y };
      })
      .filter((position) => !reserved.has(keyOf(position)));
    this.rng.shuffle(candidates);
    const items = [];
    const goldCount = Math.min(5, Math.max(3, this.floor + 2));
    const potionCount = this.hp >= this.maxHp - 2 ? 2 : 3;

    for (let index = 0; index < goldCount && candidates.length > 0; index += 1) {
      items.push({ kind: "gold", position: candidates.pop(), value: 5 });
    }
    for (let index = 0; index < potionCount && candidates.length > 0; index += 1) {
      items.push({ kind: "potion", position: candidates.pop(), value: 2 });
    }
    return items;
  }

  placeEnemies(distances, reserved) {
    const candidates = [...distances.entries()]
      .filter(([, distance]) => distance >= 4)
      .map(([encoded]) => {
        const [x, y] = encoded.split(",").map(Number);
        return { x, y };
      })
      .filter((position) => !reserved.has(keyOf(position)));
    this.rng.shuffle(candidates);
    const enemies = [];
    const enemyCount = Math.min(10, 4 + Math.floor(this.floor * 1.35));
    const kinds = ["stalker", "wisp", "shade", "brute"];

    for (const kind of kinds) {
      if (candidates.length === 0) {
        break;
      }
      enemies.push(this.createEnemy(kind, candidates.pop()));
    }

    while (enemies.length < enemyCount && candidates.length > 0) {
      const kind = kinds[enemies.length % kinds.length];
      enemies.push(this.createEnemy(kind, candidates.pop()));
    }
    return enemies;
  }

  collectItemAtPlayer() {
    const item = this.items.find((candidate) => samePosition(candidate.position, this.player));
    if (!item) {
      return null;
    }
    this.items = this.items.filter((candidate) => candidate !== item);
    if (item.kind === "gold") {
      this.score += item.value;
    } else if (item.kind === "potion") {
      this.hp = Math.min(this.maxHp, this.hp + item.value);
    }
    return item.kind;
  }

  tryExitFloor() {
    const playerPosition = this.playerWorld ?? this.player;
    const atExit = this.playerWorld ? distance(playerPosition, this.exit) <= 0.38 : samePosition(playerPosition, this.exit);
    if (!atExit || !this.exitUnlocked) {
      return false;
    }
    this.floor += 1;
    this.hp = Math.min(this.maxHp, this.hp + 1);
    this.score += 30;
    this.dashCooldown = 0;
    this.generateFloor();
    return true;
  }

  advanceEnemies({ trackingPlayer = false } = {}) {
    let totalDamage = 0;
    const attackers = this.enemies.filter((enemy) => manhattan(enemy.position, this.player) === 1);
    if (attackers.length > 0) {
      for (const enemy of attackers) {
        this.hp -= enemy.damage;
        totalDamage += enemy.damage;
      }
      return { damageTaken: totalDamage, enemyMoved: false };
    }

    let enemyMoved = false;
    for (const enemy of this.enemies) {
      const step = this.enemyStep(enemy, trackingPlayer);
      if (step) {
        enemy.position = step;
        enemyMoved = true;
      }
    }
    return { damageTaken: totalDamage, enemyMoved };
  }

  enemyStep(enemy, trackingPlayer = false) {
    const options = neighbors(enemy.position)
      .filter((position) => this.isWalkable(position))
      .filter((position) => !samePosition(position, this.player))
      .filter((position) => !this.enemies.some((other) => other !== enemy && samePosition(other.position, position)))
      .map((position) => ({ distance: manhattan(position, this.player), position }));

    if (options.length === 0) {
      return null;
    }

    if (trackingPlayer) {
      const bestDistance = Math.min(...options.map((option) => option.distance));
      const bestOptions = options.filter((option) => option.distance === bestDistance);
      return clonePosition(this.rng.choice(bestOptions).position);
    }

    return clonePosition(this.rng.choice(options).position);
  }

  attackPositions() {
    const { x, y } = this.playerWorld ?? this.player;
    const { x: dx, y: dy } = this.facing;
    const targets = [{ x: x + dx, y: y + dy }];
    if (dx !== 0) {
      targets.push({ x: x + dx, y: y + 1 }, { x: x + dx, y: y - 1 });
    } else {
      targets.push({ x: x + 1, y: y + dy }, { x: x - 1, y: y + dy });
    }
    return targets;
  }

  enemyAt(position) {
    return this.enemies.find((enemy) => samePosition(enemy.position, position)) || null;
  }

  isWalkable(position) {
    return (
      position.x >= 0 &&
      position.x < this.width &&
      position.y >= 0 &&
      position.y < this.height &&
      !this.walls.has(keyOf(position))
    );
  }

  bfsDistances(start, walls = this.walls) {
    const distances = new Map([[keyOf(start), 0]]);
    const queue = [clonePosition(start)];

    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of neighbors(current)) {
        const encoded = keyOf(neighbor);
        if (
          distances.has(encoded) ||
          walls.has(encoded) ||
          neighbor.x <= 0 ||
          neighbor.x >= this.width - 1 ||
          neighbor.y <= 0 ||
          neighbor.y >= this.height - 1
        ) {
          continue;
        }
        distances.set(encoded, distances.get(keyOf(current)) + 1);
        queue.push(neighbor);
      }
    }

    return distances;
  }

  pushMessage(message) {
    if (!message) {
      return;
    }
    this.messageLog.push(message);
    this.messageLog = this.messageLog.slice(-5);
  }

  snapshot() {
    const attackStyle = this.currentAttackStyle();
    return {
      width: this.width,
      height: this.height,
      floor: this.floor,
      score: this.score,
      kills: this.kills,
      hp: this.hp,
      maxHp: this.maxHp,
      facing: { ...this.facing },
      player: { ...(this.playerWorld ?? this.player) },
      relic: { ...this.relic },
      exit: { ...this.exit },
      relicCollected: this.relicCollected,
      exitUnlocked: this.exitUnlocked,
      gameOver: this.gameOver,
      dashCooldown: this.playerWorld ? this.realtimeDashCooldown : this.dashCooldown,
      attackStyle: attackStyle.name,
      attackRecovery: this.realtimeAttackRecovery,
      comboDepth: this.attackComboIndex + 1,
      walls: new Set(this.walls),
      items: this.items.map((item) => ({ ...item, position: { ...item.position } })),
      enemies: this.enemies.map((enemy) => ({
        ...enemy,
        position: { ...(enemy.worldPosition ?? enemy.position) },
      })),
      messageLog: [...this.messageLog],
      attackPositions: this.attackPositions(),
    };
  }
}
