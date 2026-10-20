import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  facingToRotation, followRoute, headingOf, smoothCorners, tileAt, tileCenter, turnToward, wrapAngle,
  CORNER_RADIUS,
} from '../../public/js/lib/movement.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('tile centre and tile lookup follow the one-metre tile grid', () => {
  assert.deepEqual(tileCenter(2, 5), { x: 2.5, z: 5.5 });
  assert.deepEqual(tileAt(2.99, 5.01), { col: 2, row: 5 });
  assert.deepEqual(tileAt(-0.1, 0), { col: -1, row: 0 });
});

test('facings map to rotation.y for a +Z model', () => {
  close(facingToRotation('S'), 0);
  close(facingToRotation('E'), Math.PI / 2);
  close(facingToRotation('N'), Math.PI);
  close(facingToRotation('W'), -Math.PI / 2);
  assert.throws(() => facingToRotation('X'), RangeError);
});

test('headingOf agrees with the facings', () => {
  close(headingOf(0, 1), facingToRotation('S'));
  close(headingOf(1, 0), facingToRotation('E'));
  close(Math.abs(headingOf(0, -1)), Math.PI);
  close(headingOf(-1, 0), facingToRotation('W'));
});

test('turnToward takes the short way round and never overshoots', () => {
  close(turnToward(0, 1, 0.25), 0.25);
  close(turnToward(0, 1, 2), 1);
  // From just below +π to just above -π is a short step across the seam.
  close(turnToward(3.0, -3.0, 0.1), 3.1);
  close(wrapAngle(3 * Math.PI), Math.PI);
  close(wrapAngle(-Math.PI), Math.PI);
});

test('smoothCorners rounds bends inside the bend tile and keeps the ends', () => {
  const pts = [{ x: 0.5, z: 0.5 }, { x: 1.5, z: 0.5 }, { x: 1.5, z: 1.5 }];
  const out = smoothCorners(pts);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[2]);
  assert.ok(out.length > 3, 'the bend is sampled');
  // Nothing passes through the bend point itself, and every curve point stays
  // within the corner radius of it, so inside tile (1, 0).
  const curve = out.slice(1, -1);
  for (const p of curve) {
    assert.ok(Math.hypot(p.x - 1.5, p.z - 0.5) <= CORNER_RADIUS + 1e-9);
    assert.deepEqual(tileAt(p.x, p.z), { col: 1, row: 0 });
  }
  assert.ok(curve.every((p) => Math.hypot(p.x - 1.5, p.z - 0.5) > 0.01));
  // Straight runs stay as they are.
  const straight = [{ x: 0.5, z: 0.5 }, { x: 1.5, z: 0.5 }, { x: 2.5, z: 0.5 }];
  assert.deepEqual(smoothCorners(straight), straight);
});

test('followRoute walks the given distance along the polyline', () => {
  const route = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 2 }];
  const a = followRoute(route, 1, route[0], 0.5);
  assert.deepEqual({ x: a.x, z: a.z, index: a.index, arrived: a.arrived }, { x: 0.5, z: 0, index: 1, arrived: false });
  close(headingOf(a.dx, a.dz), Math.PI / 2); // facing E
  const b = followRoute(route, a.index, a, 1.5); // round the bend
  close(b.x, 1);
  close(b.z, 1);
  assert.equal(b.index, 2);
  close(headingOf(b.dx, b.dz), 0); // facing S
  const c = followRoute(route, b.index, b, 5);
  assert.deepEqual({ x: c.x, z: c.z, arrived: c.arrived }, { x: 1, z: 2, arrived: true });
});
