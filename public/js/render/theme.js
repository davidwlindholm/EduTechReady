// Scene colours and lighting values, matched to the original mockup:
// light wood floor, light walls with taupe cut tops, grey frames, pale blue glass.
// All room colours live here; render/room.js only reads them.

export const THEME = Object.freeze({
  // Clear colour, never seen: the grass is refitted to the view in the same
  // resize handler, before the next frame. Deliberately not green, so a
  // missing or misfitted ground shows (and fails the e2e corner check).
  background: 0xe4e9ee,
  hemisphereSky: 0xf4f6ff,
  hemisphereGround: 0xa38667,
  hemisphereIntensity: 1.5,
  sunColor: 0xfff3e0,
  sunIntensity: 2.2,
  // Sun offset from the level centre: high, from the back left as in the mockup.
  sunOffset: Object.freeze({ x: -5, y: 11, z: -3 }),
  // Front fill toward the camera side (+X, +Z), no shadows.
  fillColor: 0xfff8f0,
  fillIntensity: 1.5,
  fillOffset: Object.freeze({ x: 6, y: 5, z: 8 }),
  shadowMapSize: 2048,
  shadowRadius: 4,

  room: Object.freeze({
    // Floor: vertex tints multiply a near-white plank texture.
    floor: 0xd2ab81, // lounge, light wood (lighter, less orange, as the mockup)
    floorHallway: 0xdde3e5, // hallway, pale cool grey as in the mockup
    floorOutside: 0xb9a999, // floor strip outside the outer walls (plinth)
    plankBase: 0xffffff,
    plankShade: 0.1, // per-plank brightness variation, 0 to 1
    plankGap: 0xa48a70, // seam colour in the texture (before the tint)
    floorRoughness: 0.8,
    // Walls
    wall: 0xf5f0e8, // wall faces
    wallTop: 0xbcaa98, // cut tops, as in the mockup's wall sections
    sill: 0xf3f1ec,
    // Frames, doors, glass
    frame: 0x5d6266,
    doorPanel: 0x9da3a8,
    glass: 0xcfe4f0,
    glassOpacity: 0.28,
    wallRoughness: 0.9,
  }),

  // Furniture material colours by asset id and material name (names from
  // docs/ASSETS.md), replacing the source colours to match the mockup: light
  // wood table and chairs, beige sofa, white kitchen with a wooden top.
  furniture: Object.freeze({
    table_long: Object.freeze({ Wood: 0xc99a62, DarkWood: 0xa9794a }),
    chair: Object.freeze({ Wood: 0xb68250 }),
    coffee_table: Object.freeze({ 'Wood.009': 0xc99a62, 'DarkWood.007': 0xa9794a }),
    sofa: Object.freeze({ Sofa: 0xd8cfc0 }),
    counter_drawers: Object.freeze({ Kitchen: 0xeeebe5, KitchenTop: 0xc0905c }),
    counter_sink: Object.freeze({ Kitchen: 0xeeebe5, KitchenTop: 0xc0905c }),
    counter_cabinet: Object.freeze({ Kitchen: 0xeeebe5 }),
    drawer_cabinet: Object.freeze({ Wood: 0xb08050, Wood_Dark: 0x8f6440, Wood_Light: 0xc99a62 }),
  }),

  // Outside the building: a soft, slightly muted grass, a gravel
  // path along the window wall and a few low bushes.
  outside: Object.freeze({
    grass: 0x9fb57f,
    grassShade: 0.07, // per-patch brightness variation in the texture, 0 to 1
    grassRoughness: 0.95,
    path: 0xd8ccb3,
    pathEdge: 0xbfb197,
    pathShade: 0.1,
    bush: 0x6e8f56,
    bushDark: 0x5c7c49,
  }),

  // The closed door's easter egg: a dark closet behind the door and
  // a friendly neon-green alien (a character model, recoloured by material name).
  alien: Object.freeze({
    // false turns the easter egg off: the door stays shut and a click on it
    // walks the player there like any other tile (docs/CONTENT.md).
    enabled: true,
    closet: 0x16191d,
    model: 'char_m1',
    // Child size (at 1.7 m its head was cut off by the top of the door), so
    // the whole head shows in the opening.
    height: 1.25,
    // Neon green. Hair, trousers and socks are exactly the skin colour, so it
    // reads as one body rather than a person in clothes; only the shirt is a
    // darker green.
    materialColors: Object.freeze({
      Skin: '#39ff14', Hair: '#39ff14', Pants: '#39ff14', Socks: '#39ff14', Shirt: '#1f9e1a',
    }),
  }),

  // Player ring (a dashed blue ring under the player, as in the mockup) and
  // the short-lived marker at a click target.
  markers: Object.freeze({
    ring: 0x2f8cf0,
    ringOpacity: 0.9,
    click: 0x2f8cf0,
    clickOpacity: 0.85,
  }),

  // Debug grid overlay (debug=1, G key): walkable, occupied (furniture or a
  // standing character) and wall-type tiles.
  debugGrid: Object.freeze({
    walkable: 0x2fbf4f,
    occupied: 0xe0402f,
    wall: 0x5d6266,
    opacity: 0.45,
  }),
});
