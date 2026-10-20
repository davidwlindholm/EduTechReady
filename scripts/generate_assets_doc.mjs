// Regenerates docs/ASSETS.md: full inventory of assets-source/, slot table and GLB inspection.
// Usage: node scripts/generate_assets_doc.mjs
// The inventory is generated so that every file is accounted for.
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectAll } from './inspect_assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets-source');
const OUT = join(ROOT, 'docs', 'ASSETS.md');
const IGNORED = new Set(['.DS_Store']);
const BYTES_PER_MB = 1024 * 1024;
const GLB_LIMIT_MB = 40;
const QUATERNIUS = 'CC0 1.0, as published by Quaternius (no licence file in pack)';

// Per pack: licence file found and a summary of its content.
const PACKS = {
  'Animated Men Pack': { author: 'Quaternius', licenceFile: 'none', licence: QUATERNIUS },
  'Animated Women Pack': { author: 'Quaternius', licenceFile: 'none', licence: QUATERNIUS },
  'Furniture Pack': { author: 'Quaternius', licenceFile: 'none', licence: QUATERNIUS },
  'Ultimate Furniture Pack': { author: 'Quaternius', licenceFile: 'none', licence: QUATERNIUS },
  'Ultimate House Interior Pack': { author: 'Quaternius', licenceFile: 'none', licence: QUATERNIUS },
  'food kit': { author: 'Kenney', licenceFile: 'License.txt', licence: 'CC0 1.0 (Creative Commons Zero); personal, educational and commercial use; credit to Kenney / www.kenney.nl is optional' },
  'furniture kit': { author: 'Kenney', licenceFile: 'License.txt', licence: 'CC0 1.0 (Creative Commons Zero); personal, educational and commercial use; credit is optional' },
  'ui pack': { author: 'Kenney', licenceFile: 'License.txt', licence: 'CC0 1.0 (Creative Commons Zero); free for personal, educational and commercial use; credit is optional' },
};

// Slots: id, what, source (relative to assets-source) or null when missing, note.
const SLOTS = [
  ['char_w1', 'Woman 1', 'Animated Women Pack/Blend/Smooth_Female_Casual.blend', ''],
  ['char_w2', 'Woman 2', 'Animated Women Pack/Blend/Smooth_Female_Dress.blend', ''],
  ['char_w3', 'Woman 3', 'Animated Women Pack/Blend/Smooth_Female_TankTop.blend', ''],
  ['char_w4', 'Woman 4', 'Animated Women Pack/Blend/Smooth_Female_Alternative.blend', ''],
  ['char_m1', 'Man 1', 'Animated Men Pack/Blends/Smooth_Male_Casual.blend', ''],
  ['char_m2', 'Man 2', 'Animated Men Pack/Blends/Smooth_Male_LongSleeve.blend', ''],
  ['char_m3', 'Man 3', 'Animated Men Pack/Blends/Smooth_Male_Shirt.blend', ''],
  ['char_m4', 'Man 4', 'Animated Men Pack/Blends/Smooth_Male_Suit.blend', ''],
  ['table_long', 'Long table', 'Ultimate Furniture Pack/Blends/Table.blend', 'Rotated 90 degrees so the long side runs along X; 2.5 x 1.3 m inside a 3 x 2 tile footprint.'],
  ['chair', 'Chairs (6 or more; one model reused)', 'Ultimate Furniture Pack/Blends/Chair.blend', 'The slot is the model; level.json places six or more instances.'],
  ['sofa', 'Sofa', 'Ultimate Furniture Pack/Blends/Sofa2.blend', '2.2 m wide, three seats.'],
  ['coffee_table', 'Coffee table', 'Furniture Pack/Blends/CoffeeTable.blend', 'Rotated 90 degrees; 1.4 x 0.8 m.'],
  ['counter_drawers', 'Kitchen counter module A (1 tile)', 'Ultimate House Interior Pack/Blends/Kitchen_2Drawers.blend', 'Two linked copies of the 0.5 m module (blender_to_glb.py --tile 2).'],
  ['counter_sink', 'Kitchen counter module B, double sink (1 tile)', 'Ultimate House Interior Pack/Blends/Kitchen_Sink.blend', 'Two linked copies.'],
  ['counter_cabinet', 'Kitchen counter module C (1 tile)', 'Ultimate House Interior Pack/Blends/Kitchen_Cabinet1.blend', 'Two linked copies. A, B and C together cover 3 tiles.'],
  ['fridge', 'Fridge', 'Ultimate House Interior Pack/Blends/Kitchen_Fridge.blend', '1.8 m high.'],
  ['coffee_machine', 'Coffee machine (prop on the counter)', 'furniture kit/Models/GLTF format/kitchenCoffeeMachine.glb', 'Filled. Origin moved to the bottom centre by `gltf-transform center`; scaled to about 0.31 m tall (0.18 m x 1.75).'],
  ['microwave', 'Microwave (prop on the counter)', 'furniture kit/Models/GLTF format/kitchenMicrowave.glb', 'Extra kitchen device. About 0.30 m tall, 0.48 m wide.'],
  ['toaster', 'Toaster (prop on the counter)', 'furniture kit/Models/GLTF format/toaster.glb', 'Extra kitchen device. About 0.20 m tall.'],
  ['drawer_cabinet', 'Drawer cabinet', 'Ultimate House Interior Pack/Blends/Drawer_5.blend', ''],
  ['plant_1', 'Plant 1', 'Ultimate House Interior Pack/Blends/Houseplant_4.blend', ''],
  ['plant_2', 'Plant 2', 'Ultimate House Interior Pack/Blends/Houseplant_6.blend', ''],
  ['plant_3', 'Plant 3', 'Ultimate House Interior Pack/Blends/Houseplant_8.blend', ''],
  ['papers', 'Papers', 'generated: scripts/make_papers.mjs', 'Filled. Stack of four off-white A4 sheets (0.21 x 0.297 m, 2 mm each), no textures. No source pack.'],
  ['coffee_cup', 'Cup 1', 'food kit/Models/GLB format/cup-coffee.glb', 'Texture embedded by convert_assets.sh.'],
  ['mug', 'Cup 2', 'food kit/Models/GLB format/mug.glb', ''],
  ['food_croissant', 'Food 1', 'food kit/Models/GLB format/croissant.glb', ''],
  ['food_apple', 'Food 2', 'food kit/Models/GLB format/apple.glb', ''],
  ['food_muffin', 'Food 3', 'food kit/Models/GLB format/muffin.glb', ''],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (IGNORED.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function inventory() {
  const lines = ['## 5. Inventory of assets-source/', '',
    'Generated by `scripts/generate_assets_doc.mjs`. `.DS_Store` files are skipped. `assets-source/` itself is not committed.', ''];
  const summary = ['| Pack | Author | Files | Licence file found | Licence |', '|---|---|---|---|---|'];
  const details = [];
  for (const pack of readdirSync(SRC).sort().filter((n) => statSync(join(SRC, n)).isDirectory())) {
    const files = walk(join(SRC, pack));
    const info = PACKS[pack];
    if (!info) throw new Error(`pack ${pack} has no entry in PACKS`);
    summary.push(`| ${pack} | ${info.author} | ${files.length} | ${info.licenceFile} | ${info.licence} |`);
    details.push(`### ${pack}`, '', `Licence: ${info.licence}`, '');
    const byFolder = new Map();
    for (const f of files) {
      const folder = relative(join(SRC, pack), dirname(f)) || '.';
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(f);
    }
    for (const [folder, list] of byFolder) {
      const formats = {};
      for (const f of list) formats[extname(f).slice(1) || 'none'] = (formats[extname(f).slice(1) || 'none'] ?? 0) + 1;
      const fmt = Object.entries(formats).map(([e, n]) => `${n} .${e}`).join(', ');
      details.push(`**${pack}/${folder}** (${list.length} files: ${fmt})`, '',
        list.map((f) => f.split('/').pop()).join(', '), '');
    }
  }
  return [...lines, ...summary, '', ...details].join('\n');
}

function slotTable(inspected) {
  const byId = new Map(inspected.map((r) => [r.id, r]));
  const lines = ['## 1. Slots', '',
    '| Slot id | Purpose | Source (assets-source/) | Status | Notes |', '|---|---|---|---|---|'];
  for (const [id, what, source, note] of SLOTS) {
    const status = source === null ? 'missing' : byId.has(id) ? (source.startsWith('generated') ? 'generated' : 'converted') : 'NOT BUILT';
    lines.push(`| ${id} | ${what} | ${source ?? '-'} | ${status} | ${note} |`);
  }
  return lines.join('\n');
}

function manifestSection() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'content', 'assets.json'), 'utf8')).models;
  const lines = ['## 2. Manifest summary (public/content/assets.json)', '',
    '| Id | Kind | Scale | Rotation offset | Footprint | Clips (idle / walk / sit) | Licence |', '|---|---|---|---|---|---|---|'];
  for (const [id, m] of Object.entries(manifest)) {
    const fp = m.footprint ? `${m.footprint.w} x ${m.footprint.d}` : '-';
    const clips = m.clips ? `${m.clips.idle} / ${m.clips.walk} / ${m.clips.sit}` : '-';
    lines.push(`| ${id} | ${m.kind} | ${m.scale} | ${m.rotationOffsetDeg} | ${fp} | ${clips} | ${m.licence} |`);
  }
  return lines.join('\n');
}

function inspectionSection(rows) {
  const total = rows.reduce((s, r) => s + r.bytes, 0) / BYTES_PER_MB;
  const lines = ['## 3. GLB inspection (node scripts/inspect_assets.mjs)', '',
    'Bounding boxes are in metres at scale 1.0, in the bind pose, before the manifest `scale` and `rotationOffsetDeg`.',
    'Characters are about 4.8 units tall in the files, hence manifest scales of about 0.36.',
    'Origin convention: furniture origins are not reliably centred (the chair\'s is near its back legs; see the bbox min and max), so the game centres each furniture model on its footprint from its bounding box and puts the bottom on the floor (`render/furniture.js`). Props stand on their origin (bottom centre after `gltf-transform center`); characters stand at the origin.', '',
    '| Id | Size (KB) | Triangles | Bbox size x, y, z | Bbox min | Bbox max | Clips | Materials | Textures |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    lines.push(`| ${r.id} | ${Math.round(r.bytes / 1024)} | ${r.triangles} | ${r.size.join(', ')} | ${r.bboxMin.join(', ')} | ${r.bboxMax.join(', ')} | ${r.clips.join(', ') || '-'} | ${r.materials.join(', ') || '-'} | ${r.textures} |`);
  }
  lines.push('', `Total: ${rows.length} GLB files, ${total.toFixed(2)} MB (limit ${GLB_LIMIT_MB} MB).`);
  return lines.join('\n');
}

const NOTES = `## 4. Notes and decisions

- **Variant:** the \`Smooth_\` variant of every character is used (consistent, softer shading). Each source blend holds 12 actions (Clapping, Death, Idle, Jump, Punch, Roll, Run, RunningJump, Sitting, Standing, SwordSlash, Walk). Only Idle, Walk and Sitting are exported to keep files small. Re-run \`scripts/convert_assets.sh\` with other action names if more are needed.
- **Clip mapping:** every character has \`idle\` (Female_Idle or Man_Idle), \`walk\` and \`sit\` (the Sitting clip). No stop condition about clips is triggered.
- **Sitting pose:** after scaling, the Sitting clips assume a seat about 0.32 m (Female_Sitting) and 0.34 m (Man_Sitting) high, lower than the chair seat (0.519 m) and the sofa cushion (0.405 m; \`SEATS\` in \`lib/seating.js\`). \`render/seatedPose.js\` fits them: \`CLIP_SEAT_HEIGHT\` holds the clips' seat heights, the character is lifted by the difference (\`seatLift\`), and each frame a two-bone leg solve puts the feet back on the floor. A new sit clip needs its seat height measured and added there.
- **Facing:** every model faces +Z after conversion (checked on \`public/dev/assets.html\`). \`rotationOffsetDeg\` is 90 only for the two tables, to put their long side along X.
- **Blender material fixes:** Quaternius blends carry a second Material Output wired to a Diffuse BSDF and Furniture Pack uses bare Diffuse BSDFs. \`blender_to_glb.py\` selects the Principled output and converts Diffuse to Principled so colours reach the GLB.
- **Counter modules:** one Quaternius counter module is only 0.5 m wide at real size, so each counter id is two linked copies side by side (about 1 m, one tile). Ids A, B and C cover 3 tiles.
- **Kenney food kit GLBs** reference \`Textures/colormap.png\` externally; \`convert_assets.sh\` rewrites them through gltf-transform so the texture is embedded.
- **Licences:** Quaternius packs ship no licence file. Quaternius packs: ${QUATERNIUS}. Kenney packs (food kit, furniture kit, ui pack) ship License.txt with CC0 1.0. The generated papers model is CC0 1.0.
- **Furniture kit (Kenney Furniture Kit 2.0, folder furniture kit):** coffee_machine, microwave and toaster come from \`Models/GLTF format\`. The models are not in metres and have their origin at a corner of the footprint, so \`convert_assets.sh\` runs \`gltf-transform center --pivot below\` (origin at bottom centre) and \`assets.json\` sets real-world scales (about 0.31 m, 0.30 m and 0.20 m tall). They face +Z.
- **Papers:** generated by \`scripts/make_papers.mjs\` with @gltf-transform/core (four thin off-white boxes, slightly offset and rotated). Origin at the bottom centre, scale 1.0.
- **Viewer:** \`npm run serve\`, then open \`/dev/assets.html\` (options: \`?clip=walk\`, \`?clip=sit\`, \`?ids=a,b\`).
`;

if (!existsSync(SRC)) throw new Error('assets-source/ not found');
const inspected = await inspectAll();
writeFileSync(OUT, ['# Assets', '',
  'Inventory, slot choices and conversion results for the EduTechReady models.', '',
  'Rebuild: `scripts/convert_assets.sh` (needs Blender 4.2 or later; set `BLENDER=/path/to/Blender` if it is not at /Applications/Blender.app), then `node scripts/generate_assets_doc.mjs`, then `npm test` and `npm run validate` (the validator checks material and clip names against the new GLBs). One character model can draw several figures: `char_m1` is Jonas and also the alien behind the hallway door (`THEME.alien` in `render/theme.js`), and `char_m3` is both Lars and Henrik, so look at all of them after rebuilding one.', '',
  slotTable(inspected), '', manifestSection(), '', inspectionSection(inspected), '', NOTES, inventory(), ''].join('\n'));
console.log(`wrote ${relative(ROOT, OUT)}`);
