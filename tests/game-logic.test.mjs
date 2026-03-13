import test from "node:test";
import assert from "node:assert/strict";

import { DungeonGame } from "../web/src/game-logic.js";

test("collecting relic unlocks exit", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 1 });
  game.walls = new Set();
  game.player = { x: 2, y: 2 };
  game.relic = { x: 3, y: 2 };
  game.exit = { x: 9, y: 7 };
  game.items = [];
  game.enemies = [];
  game.relicCollected = false;
  game.exitUnlocked = false;

  game.attemptMove({ x: 1, y: 0 });

  assert.equal(game.relicCollected, true);
  assert.equal(game.exitUnlocked, true);
  assert.equal(game.score >= 25, true);
});

test("attack defeats a stalker in one clean hit", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 2 });
  game.walls = new Set();
  game.player = { x: 4, y: 4 };
  game.facing = { x: 1, y: 0 };
  game.enemies = [{ kind: "stalker", position: { x: 5, y: 4 }, hp: 3, maxHp: 3, damage: 1, reward: 10 }];
  game.items = [];

  game.playerAttack();

  assert.equal(game.enemies.length, 0);
});

test("moving into an enemy does not attack", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 22 });
  game.walls = new Set();
  game.player = { x: 4, y: 4 };
  game.facing = { x: 1, y: 0 };
  game.enemies = [{ id: 1, kind: "stalker", position: { x: 5, y: 4 }, hp: 3, maxHp: 3, damage: 1, reward: 10 }];
  const startHp = game.hp;

  const result = game.attemptMove({ x: 1, y: 0 });

  assert.equal(result.logMessage, "An enemy blocks your path.");
  assert.deepEqual(game.player, { x: 4, y: 4 });
  assert.equal(game.enemies[0].hp, 3);
  assert.equal(game.hp, startHp);
});

test("enemy already adjacent attacks on an autonomous world tick", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 3 });
  game.walls = new Set();
  game.player = { x: 4, y: 4 };
  game.facing = { x: 1, y: 0 };
  game.enemies = [{ kind: "brute", position: { x: 5, y: 4 }, hp: 4, maxHp: 4, damage: 2, reward: 14 }];
  const startHp = game.hp;

  game.worldTick();

  assert.equal(game.hp, startHp - 2);
});

test("enemy attack phase does not also move other enemies", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 33 });
  game.walls = new Set();
  game.player = { x: 4, y: 4 };
  game.facing = { x: 1, y: 0 };
  game.enemies = [
    { id: 1, kind: "brute", position: { x: 5, y: 4 }, hp: 4, maxHp: 4, damage: 2, reward: 14 },
    { id: 2, kind: "stalker", position: { x: 8, y: 4 }, hp: 3, maxHp: 3, damage: 1, reward: 10 },
  ];
  const farEnemyStart = { ...game.enemies[1].position };

  game.worldTick();

  assert.deepEqual(game.enemies[1].position, farEnemyStart);
});

test("enemy that moves adjacent does not attack on the same autonomous tick", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 4 });
  game.walls = new Set();
  game.player = { x: 4, y: 4 };
  game.facing = { x: 1, y: 0 };
  game.enemies = [{ kind: "stalker", position: { x: 7, y: 4 }, hp: 3, maxHp: 3, damage: 1, reward: 10 }];
  const startHp = game.hp;

  game.alertTicks = 3;
  game.worldTick();

  assert.equal(game.hp, startHp);
});

test("enemies roam on their own without player input", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 44 });
  game.walls = new Set();
  game.player = { x: 2, y: 2 };
  game.enemies = [{ id: 1, kind: "stalker", position: { x: 7, y: 4 }, hp: 3, maxHp: 3, damage: 1, reward: 10 }];
  const start = { ...game.enemies[0].position };

  const result = game.worldTick();

  assert.equal(result.enemyMoved, true);
  assert.notDeepEqual(game.enemies[0].position, start);
});

test("player movement alerts enemies toward the player", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 55 });
  game.walls = new Set();
  game.player = { x: 2, y: 2 };
  game.enemies = [{ id: 1, kind: "stalker", position: { x: 8, y: 2 }, hp: 3, maxHp: 3, damage: 1, reward: 10 }];

  game.attemptMove({ x: 1, y: 0 });
  const beforeTickDistance = Math.abs(game.enemies[0].position.x - game.player.x) + Math.abs(game.enemies[0].position.y - game.player.y);
  game.worldTick();
  const afterTickDistance = Math.abs(game.enemies[0].position.x - game.player.x) + Math.abs(game.enemies[0].position.y - game.player.y);

  assert.equal(afterTickDistance < beforeTickDistance, true);
});

test("wisp personality can ignore the player and roam randomly", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 77 });
  game.walls = new Set();
  game.player = { x: 2, y: 2 };
  game.playerWorld = { x: 2, y: 2 };
  game.enemies = [{
    id: 1,
    kind: "wisp",
    personality: "random",
    position: { x: 6, y: 6 },
    worldPosition: { x: 6, y: 6 },
    hp: 2,
    maxHp: 2,
    damage: 1,
    reward: 12,
    wanderDirection: { x: 0, y: 1 },
    wanderTimer: 1,
    attackCooldown: 0,
  }];
  game.alertTimer = 1;
  const beforeDistance = Math.hypot(game.enemies[0].worldPosition.x - game.playerWorld.x, game.enemies[0].worldPosition.y - game.playerWorld.y);

  game.updateRealtime(0.016, { x: 0, y: 0 });

  const afterDistance = Math.hypot(game.enemies[0].worldPosition.x - game.playerWorld.x, game.enemies[0].worldPosition.y - game.playerWorld.y);
  assert.equal(afterDistance >= beforeDistance - 0.01, true);
});

test("shade personality can flee while alerted", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 88 });
  game.walls = new Set();
  game.player = { x: 4, y: 4 };
  game.playerWorld = { x: 4, y: 4 };
  game.enemies = [{
    id: 1,
    kind: "shade",
    personality: "confused",
    position: { x: 6, y: 4 },
    worldPosition: { x: 6, y: 4 },
    hp: 3,
    maxHp: 3,
    damage: 1,
    reward: 13,
    wanderDirection: { x: 1, y: 0 },
    wanderTimer: 1,
    confusedMode: "flee",
    confusedTimer: 0.5,
    attackCooldown: 0,
  }];
  game.alertTimer = 1;
  const beforeDistance = Math.hypot(game.enemies[0].worldPosition.x - game.playerWorld.x, game.enemies[0].worldPosition.y - game.playerWorld.y);

  game.updateRealtime(0.016, { x: 0, y: 0 });

  const afterDistance = Math.hypot(game.enemies[0].worldPosition.x - game.playerWorld.x, game.enemies[0].worldPosition.y - game.playerWorld.y);
  assert.equal(afterDistance > beforeDistance, true);
});

test("realtime exit collision advances to the next floor", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 66 });
  game.walls = new Set();
  game.floor = 1;
  game.player = { x: 2, y: 2 };
  game.playerWorld = { x: 8.95, y: 7 };
  game.exit = { x: 9, y: 7 };
  game.relic = { x: 5, y: 5 };
  game.relicCollected = true;
  game.exitUnlocked = true;
  game.items = [];
  game.enemies = [];

  const result = game.updateRealtime(0.016, { x: 1, y: 0 });

  assert.equal(result.floorCleared, true);
  assert.equal(game.floor, 2);
});

test("dash moves up to two cells and collects loot", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 5 });
  game.walls = new Set();
  game.player = { x: 2, y: 2 };
  game.facing = { x: 1, y: 0 };
  game.items = [{ kind: "gold", position: { x: 4, y: 2 }, value: 5 }];
  game.enemies = [];

  game.playerDash();

  assert.deepEqual(game.player, { x: 4, y: 2 });
  assert.equal(game.score, 5);
  assert.equal(game.dashCooldown, 3);
});
