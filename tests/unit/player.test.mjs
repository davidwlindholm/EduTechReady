// Player turning and the settled state behind the debug API's isIdle().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from '../../public/js/render/three.js';
import { Player } from '../../public/js/render/player.js';

function fakeActor() {
  return {
    root: new THREE.Group(),
    fading: false,
    played: [],
    get isFading() { return this.fading; },
    play(name) { this.played.push(name); },
    update() {},
  };
}

const openGrid = { cols: 5, rows: 5, isWalkable: (c, r) => c >= 0 && r >= 0 && c < 5 && r < 5 };

test('faceToward turns on the spot and resolves once facing the point', async () => {
  const actor = fakeActor();
  const player = new Player(actor, { col: 2, row: 2, facing: 'N' }, openGrid);
  assert.equal(player.isSettled, true);
  const turned = player.faceToward(4, 2.5); // due east
  assert.equal(player.isTurning, true);
  assert.equal(player.isSettled, false);
  let done = null;
  turned.then((v) => { done = v; });
  for (let i = 0; i < 30 && done === null; i++) {
    player.update(0.02);
    await Promise.resolve();
  }
  assert.equal(done, true);
  assert.ok(Math.abs(player.root.rotation.y - Math.PI / 2) < 1e-6);
  assert.equal(player.isSettled, true);
});

test('a moveTo during a turn cancels it; facing the current heading resolves at once', async () => {
  const player = new Player(fakeActor(), { col: 2, row: 2, facing: 'N' }, openGrid);
  const turned = player.faceToward(2.5, 4); // due south
  player.moveTo(0, 0);
  assert.equal(await turned, false);
  player.cancel();
  player.heading = player.root.rotation.y;
  assert.equal(await player.faceToward(player.root.position.x + Math.sin(player.heading), player.root.position.z + Math.cos(player.heading)), true);
});

test('isSettled waits for the animation cross-fade', () => {
  const actor = fakeActor();
  const player = new Player(actor, { col: 2, row: 2, facing: 'N' }, openGrid);
  actor.fading = true;
  assert.equal(player.isSettled, false);
  actor.fading = false;
  assert.equal(player.isSettled, true);
});
