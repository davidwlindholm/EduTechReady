#!/usr/bin/env bash
# Builds public/assets/models/<id>.glb for every chosen source file.
# .blend files are exported with Blender in background mode (scripts/blender_to_glb.py);
# existing .glb files are copied (textures embedded). One line per asset id below.
#
# Usage: scripts/convert_assets.sh        (set BLENDER=/path/to/Blender to override)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/assets-source"
OUT="$ROOT/public/assets/models"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"

WOMEN="$SRC/Animated Women Pack/Blend"
MEN="$SRC/Animated Men Pack/Blends"
FURN="$SRC/Furniture Pack/Blends"
UFURN="$SRC/Ultimate Furniture Pack/Blends"
HOUSE="$SRC/Ultimate House Interior Pack/Blends"
FOOD="$SRC/food kit/Models/GLB format"
KIT="$SRC/furniture kit/Models/GLTF format"

LOGS="$ROOT/scripts/.logs"   # per-asset Blender output (gitignored)

mkdir -p "$OUT" "$LOGS"

# blend <id> <source.blend> [object-or-collection-name|-] [actions] [tile-count]
blend() {
  local id="$1" src="$2" name="${3:--}" actions="${4:-}" tile="${5:-1}"
  local args=("$src" "$OUT/$id.glb")
  [[ "$name" != "-" ]] && args+=("$name")
  [[ -n "$actions" ]] && args+=(--actions "$actions")
  [[ "$tile" -gt 1 ]] && args+=(--tile "$tile")
  echo "convert $id <- ${src#"$SRC/"}"
  # Delete the old output first so a failed run cannot pass the check with stale data.
  # Blender exits 0 when the script raises unless --python-exit-code is given.
  rm -f "$OUT/$id.glb"
  if ! "$BLENDER" -b "$src" --python-exit-code 1 --python "$ROOT/scripts/blender_to_glb.py" -- "${args[@]}" >"$LOGS/$id.log" 2>&1 \
    || [[ ! -f "$OUT/$id.glb" ]]; then
    echo "FAILED: $id (Blender log: scripts/.logs/$id.log)" >&2
    tail -n 20 "$LOGS/$id.log" >&2
    exit 1
  fi
}

# copy <id> <source.glb>
# Kenney GLBs reference Textures/colormap.png externally; re-writing through
# gltf-transform embeds the texture so the output is self-contained.
copy() {
  echo "copy    $1 <- ${2#"$SRC/"}"
  rm -f "$OUT/$1.glb"
  (cd "$ROOT" && npx --no-install gltf-transform copy "$2" "$OUT/$1.glb" >/dev/null)
}

# copy_centered <id> <source.glb>
# Kenney Furniture Kit models have their origin at a corner of the footprint; this
# moves the origin to the bottom centre (x/z centred, base on y = 0).
copy_centered() {
  echo "center  $1 <- ${2#"$SRC/"}"
  rm -f "$OUT/$1.glb"
  (cd "$ROOT" && npx --no-install gltf-transform center "$2" "$OUT/$1.glb" --pivot below >/dev/null)
}

FEM="Female_Idle,Female_Walk,Female_Sitting"
MAN="Man_Idle,Man_Walk,Man_Sitting"

# Characters (Smooth_ variants throughout, keep only idle, walk and sitting clips)
blend char_w1 "$WOMEN/Smooth_Female_Casual.blend"      - "$FEM"
blend char_w2 "$WOMEN/Smooth_Female_Dress.blend"       - "$FEM"
blend char_w3 "$WOMEN/Smooth_Female_TankTop.blend"     - "$FEM"
blend char_w4 "$WOMEN/Smooth_Female_Alternative.blend" - "$FEM"
blend char_m1 "$MEN/Smooth_Male_Casual.blend"          - "$MAN"
blend char_m2 "$MEN/Smooth_Male_LongSleeve.blend"      - "$MAN"
blend char_m3 "$MEN/Smooth_Male_Shirt.blend"           - "$MAN"
blend char_m4 "$MEN/Smooth_Male_Suit.blend"            - "$MAN"

# Furniture
blend table_long      "$UFURN/Table.blend"
blend chair           "$UFURN/Chair.blend"
blend sofa            "$UFURN/Sofa2.blend"
blend coffee_table    "$FURN/CoffeeTable.blend"
# Counter modules are half a tile wide at real size, so each id is two linked copies (about 1 m wide)
blend counter_drawers "$HOUSE/Kitchen_2Drawers.blend" - "" 2
blend counter_sink    "$HOUSE/Kitchen_Sink.blend"     - "" 2
blend counter_cabinet "$HOUSE/Kitchen_Cabinet1.blend" - "" 2
blend fridge          "$HOUSE/Kitchen_Fridge.blend"
blend drawer_cabinet  "$HOUSE/Drawer_5.blend"
blend plant_1         "$HOUSE/Houseplant_4.blend"
blend plant_2         "$HOUSE/Houseplant_6.blend"
blend plant_3         "$HOUSE/Houseplant_8.blend"

# Props (Kenney food kit ships GLB, copied with textures embedded)
copy coffee_cup    "$FOOD/cup-coffee.glb"
copy mug           "$FOOD/mug.glb"
copy food_croissant "$FOOD/croissant.glb"
copy food_apple    "$FOOD/apple.glb"
copy food_muffin   "$FOOD/muffin.glb"

# Kitchen devices for the counter (Kenney Furniture Kit 2.0, CC0; not in metres, scaled in assets.json)
copy_centered coffee_machine "$KIT/kitchenCoffeeMachine.glb"
copy_centered microwave      "$KIT/kitchenMicrowave.glb"
copy_centered toaster        "$KIT/toaster.glb"

# Papers: generated white sheets, no source pack
echo "make    papers <- scripts/make_papers.mjs"
node "$ROOT/scripts/make_papers.mjs" "$OUT/papers.glb"

echo "done: $(ls "$OUT"/*.glb | wc -l | tr -d ' ') GLB files in public/assets/models"
