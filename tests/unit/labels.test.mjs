import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declutterLabels, MAX_SIDE_SHIFT } from '../../public/js/lib/labels.js';

const box = (id, x, y, w = 100, h = 40) => ({ id, x, y, w, h });
const overlaps = (a, b, gap) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;
const moved = (boxes, shifts) => boxes.map((b) => ({ ...b, x: b.x + shifts.get(b.id).dx, y: b.y + shifts.get(b.id).dy }));

test('labels: separate labels keep their place', () => {
  const shifts = declutterLabels([box('a', 0, 0), box('b', 300, 0), box('c', 0, 200)]);
  assert.deepEqual([...shifts.values()], [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
});

test('labels: the label further back moves up above the front one when sliding is too far', () => {
  const shifts = declutterLabels([box('back', 20, 100), box('front', 0, 110)], 2);
  assert.deepEqual(shifts.get('front'), { dx: 0, dy: 0 });
  // Sliding clear would take 82 px (over 40% of 100); moving up takes 52.
  assert.deepEqual(shifts.get('back'), { dx: 0, dy: (110 - 40 - 2) - 100 });
});

test('labels: a label that only grazes another slides sideways instead of jumping up', () => {
  const shifts = declutterLabels([box('back', 90, 80), box('front', 0, 110)], 2);
  assert.deepEqual(shifts.get('back'), { dx: 12, dy: 0 });
});

test('labels: a label keeps off other characters but not its own', () => {
  // Label "a" is drawn above its own body; "b"'s body stands right under label "a".
  const label = box('a', 0, 100);
  const bodies = [box('a', 0, 150, 20, 60), box('b', 30, 110, 20, 80)];
  const shift = declutterLabels([label], 2, bodies).get('a');
  const at = { ...label, x: label.x + shift.dx, y: label.y + shift.dy };
  assert.ok(!overlaps(at, bodies[1], 1.9), 'clear of b');
  assert.ok(Math.abs(shift.dx) <= label.w * MAX_SIDE_SHIFT);
  assert.ok(shift.dy <= 0);
  // Its own body alone never moves it.
  assert.deepEqual(declutterLabels([label], 2, [bodies[0]]).get('a'), { dx: 0, dy: 0 });
});

test('labels: a pile of labels and bodies ends with no overlaps, small side moves and only upward moves', () => {
  const boxes = [box('a', 0, 100), box('b', 30, 105), box('c', 60, 95), box('d', -40, 102), box('e', 200, 100)];
  const bodies = [box('a', 0, 150, 20, 60), box('b', 30, 155, 20, 60), box('x', 70, 90, 30, 60)];
  const shifts = declutterLabels(boxes, 2, bodies);
  const after = moved(boxes, shifts);
  for (const b of boxes) {
    assert.ok(shifts.get(b.id).dy <= 0);
    assert.ok(Math.abs(shifts.get(b.id).dx) <= b.w * MAX_SIDE_SHIFT + 1e-9);
  }
  for (let i = 0; i < after.length; i++) {
    for (let j = i + 1; j < after.length; j++) assert.ok(!overlaps(after[i], after[j], 1.9), `${after[i].id} and ${after[j].id}`);
    for (const body of bodies) {
      if (body.id !== after[i].id) assert.ok(!overlaps(after[i], body, 1.9), `${after[i].id} covers body ${body.id}`);
    }
  }
  assert.deepEqual(shifts.get('e'), { dx: 0, dy: 0 });
});
