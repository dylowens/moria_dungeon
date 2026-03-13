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

function neighbors(position) {
  return [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 },
  ];
}

export class DungeonGame {
  constructor({ width = GRID_WIDTH, height = GRID_HEIGHT, seed = Date.now() } = {}) {
    this.width = width;
    this.height = height;
    this.rng = makeRng(seed);
    this.maxHp = 8;
    this.playerAttackPower = 3;
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
    this.messageLog = [];
    this.generateFloor();
    this.pushMessage("Descend into the vault and recover the relic.");
  }

  attemptMove(direction) {
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
    if (this.gameOver) {
      return { gameOver: true, logMessage: "The dungeon run is over." };
    }

    const targets = this.attackPositions();
    let enemyDefeated = 0;
    let hit = false;
    for (const enemy of [...this.enemies]) {
      if (!targets.some((position) => samePosition(position, enemy.position))) {
        continue;
      }
      enemy.hp -= this.playerAttackPower;
      hit = true;
      if (enemy.hp <= 0) {
        this.enemies = this.enemies.filter((candidate) => candidate !== enemy);
        enemyDefeated += 1;
        this.kills += 1;
        this.score += enemy.reward;
      }
    }

    return this.finishTurn({
      attacked: true,
      enemyDefeated,
      logMessage: hit ? "Your blade carves a path." : "Your swing cuts only dust.",
    });
  }

  playerDash() {
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

    const damageTaken = this.advanceEnemies();
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
        damageTaken,
        gameOver: true,
        logMessage: finalMessage,
      };
    }

    const summaryMessage = logMessage || this.composeSummary(pickedItem, enemyDefeated, damageTaken);
    this.pushMessage(summaryMessage);
    return {
      moved,
      dashed,
      attacked,
      pickedItem,
      enemyDefeated,
      damageTaken,
      logMessage: summaryMessage,
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
      return;
    }

    throw new Error("Unable to generate a valid dungeon floor.");
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
    const enemyCount = Math.min(7, 2 + this.floor * 2);

    for (let index = 0; index < enemyCount && candidates.length > 0; index += 1) {
      const kind = this.floor >= 3 && index % 3 === 2 ? "brute" : "stalker";
      enemies.push(
        kind === "brute"
          ? { id: this.nextEnemyId++, kind, position: candidates.pop(), hp: 4, maxHp: 4, damage: 2, reward: 14 }
          : { id: this.nextEnemyId++, kind, position: candidates.pop(), hp: 3, maxHp: 3, damage: 1, reward: 10 }
      );
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
    if (!samePosition(this.player, this.exit) || !this.exitUnlocked) {
      return false;
    }
    this.floor += 1;
    this.hp = Math.min(this.maxHp, this.hp + 1);
    this.score += 30;
    this.dashCooldown = 0;
    this.generateFloor();
    return true;
  }

  advanceEnemies() {
    let totalDamage = 0;
    const attackers = this.enemies.filter((enemy) => manhattan(enemy.position, this.player) === 1);
    if (attackers.length > 0) {
      for (const enemy of attackers) {
        this.hp -= enemy.damage;
        totalDamage += enemy.damage;
      }
      return totalDamage;
    }

    for (const enemy of this.enemies) {
      const step = this.enemyStep(enemy);
      if (step) {
        enemy.position = step;
      }
    }
    return totalDamage;
  }

  enemyStep(enemy) {
    const options = neighbors(enemy.position)
      .filter((position) => this.isWalkable(position))
      .filter((position) => !samePosition(position, this.player))
      .filter((position) => !this.enemies.some((other) => other !== enemy && samePosition(other.position, position)))
      .map((position) => ({ distance: manhattan(position, this.player), position }));

    if (options.length === 0) {
      return null;
    }

    if (enemy.kind === "brute" || manhattan(enemy.position, this.player) <= 7) {
      const bestDistance = Math.min(...options.map((option) => option.distance));
      const bestOptions = options.filter((option) => option.distance === bestDistance);
      return clonePosition(this.rng.choice(bestOptions).position);
    }

    return clonePosition(this.rng.choice(options).position);
  }

  attackPositions() {
    const { x, y } = this.player;
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
    return {
      width: this.width,
      height: this.height,
      floor: this.floor,
      score: this.score,
      kills: this.kills,
      hp: this.hp,
      maxHp: this.maxHp,
      facing: { ...this.facing },
      player: { ...this.player },
      relic: { ...this.relic },
      exit: { ...this.exit },
      relicCollected: this.relicCollected,
      exitUnlocked: this.exitUnlocked,
      gameOver: this.gameOver,
      dashCooldown: this.dashCooldown,
      walls: new Set(this.walls),
      items: this.items.map((item) => ({ ...item, position: { ...item.position } })),
      enemies: this.enemies.map((enemy) => ({ ...enemy, position: { ...enemy.position } })),
      messageLog: [...this.messageLog],
      attackPositions: this.attackPositions(),
    };
  }
}
