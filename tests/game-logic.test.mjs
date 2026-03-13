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

test("enemy already adjacent still attacks on its turn", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 3 });
  game.walls = new Set();
  game.player = { x: 4, y: 4 };
  game.facing = { x: 1, y: 0 };
  game.enemies = [{ kind: "brute", position: { x: 5, y: 4 }, hp: 4, maxHp: 4, damage: 2, reward: 14 }];
  const startHp = game.hp;

  game.playerAttack();

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

  game.playerAttack();

  assert.deepEqual(game.enemies[1].position, farEnemyStart);
});

test("enemy that moves adjacent does not attack on the same turn", () => {
  const game = new DungeonGame({ width: 12, height: 10, seed: 4 });
  game.walls = new Set();
  game.player = { x: 4, y: 4 };
  game.facing = { x: 1, y: 0 };
  game.enemies = [{ kind: "stalker", position: { x: 7, y: 4 }, hp: 3, maxHp: 3, damage: 1, reward: 10 }];
  const startHp = game.hp;

  game.attemptMove({ x: 0, y: 1 });

  assert.equal(game.hp, startHp);
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
