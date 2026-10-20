"""Export one model from a .blend file to a GLB (+Y up, animations, modifiers applied).

Run in Blender background mode:

    blender -b <source.blend> --python-exit-code 1 --python scripts/blender_to_glb.py -- \
        <source.blend> <output.glb> [object-or-collection-name] [--actions A,B,C] [--tile N]

Arguments after "--":
  source   the .blend file (used only for messages; Blender already opened it)
  output   destination .glb path
  name     optional object or collection name. Only that object (with its
           children and armature) or that collection's objects are exported.
           Without it the whole file is exported.
  --tile N  optional. Place N linked copies of the (single, un-rigged) object side
           by side along X before export, to build a wider counter run from
           one real module. Copies are centred on the original position.
  --actions  optional comma separated list of actions to keep. All other
           actions are dropped before export, which keeps character files small.

Cameras and lights are never exported. Images are embedded in the GLB.
"""
import os
import sys

import bpy

EXPORT_FORMAT = "GLB"


USAGE = (
    "usage: blender -b src.blend --python-exit-code 1 --python blender_to_glb.py -- "
    "src.blend out.glb [name] [--actions A,B] [--tile N]"
)


def parse_args(argv):
    """Return (source, output, name, kept_actions, tile_count) from the args after '--'.

    Exits with the usage text on a wrong argument count or a bad option value.
    """
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    kept = None
    tile = 1
    if "--tile" in args:
        idx = args.index("--tile")
        if idx + 1 >= len(args):
            sys.exit("--tile needs a number\n" + USAGE)
        try:
            tile = int(args[idx + 1])
        except ValueError:
            sys.exit("--tile needs an integer, got %r\n%s" % (args[idx + 1], USAGE))
        if tile < 1:
            sys.exit("--tile must be at least 1\n" + USAGE)
        del args[idx:idx + 2]
    if "--actions" in args:
        idx = args.index("--actions")
        if idx + 1 >= len(args):
            sys.exit("--actions needs a comma separated list\n" + USAGE)
        kept = [a for a in args[idx + 1].split(",") if a]
        del args[idx:idx + 2]
    if len(args) < 2 or len(args) > 3:
        sys.exit("expected 2 or 3 positional arguments, got %d\n%s" % (len(args), USAGE))
    if any(a.startswith("--") for a in args):
        sys.exit("unknown option in %r\n%s" % (args, USAGE))
    name = args[2] if len(args) > 2 else None
    return args[0], args[1], name, kept, tile


def select_target(name):
    """Select the named object (plus children) or collection contents. Return True if a selection was made."""
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    if name is None:
        return False
    targets = []
    if name in bpy.data.collections:
        targets = list(bpy.data.collections[name].all_objects)
    elif name in bpy.data.objects:
        root = bpy.data.objects[name]
        targets = [root] + list(root.children_recursive)
        if root.parent is not None and root.parent.type == "ARMATURE":
            targets.append(root.parent)
    else:
        sys.exit("no object or collection named %r" % name)
    for obj in targets:
        if obj.type in {"MESH", "ARMATURE", "EMPTY", "CURVE"}:
            obj.select_set(True)
    return True


def drop_other_actions(kept):
    for action in list(bpy.data.actions):
        if action.name not in kept:
            bpy.data.actions.remove(action)
    missing = [k for k in kept if k not in bpy.data.actions]
    if missing:
        sys.exit("actions not found: %s" % missing)


def diffuse_to_principled():
    """Furniture Pack materials use a bare Diffuse BSDF, which the glTF exporter ignores.

    Insert a Principled BSDF carrying the diffuse colour (roughness 0.8, not metallic).
    A linked colour (an image texture, such as the suit's Tie.png) is linked to the
    Principled Base Color too; copying only the unlinked default value lost it.
    """
    for material in bpy.data.materials:
        tree = material.node_tree
        if tree is None:
            continue
        for output in [n for n in tree.nodes if n.type == "OUTPUT_MATERIAL"]:
            surface = output.inputs["Surface"]
            if not surface.is_linked or surface.links[0].from_node.type != "BSDF_DIFFUSE":
                continue
            diffuse = surface.links[0].from_node
            principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
            colour = diffuse.inputs["Color"]
            principled.inputs["Base Color"].default_value = colour.default_value
            if colour.is_linked:
                link = colour.links[0]
                tree.links.new(link.from_socket, principled.inputs["Base Color"])
            principled.inputs["Roughness"].default_value = 0.8
            tree.links.new(principled.outputs["BSDF"], surface)


def prefer_principled_outputs():
    """Quaternius materials hold a second Material Output wired to a plain Diffuse BSDF.

    The glTF exporter can pick that one and lose every colour. Make the output
    that is fed by a Principled BSDF the active one for all render targets.
    """
    for material in bpy.data.materials:
        if material.node_tree is None:
            continue
        outputs = [n for n in material.node_tree.nodes if n.type == "OUTPUT_MATERIAL"]
        wanted = [
            n for n in outputs
            if n.inputs["Surface"].is_linked
            and n.inputs["Surface"].links[0].from_node.type == "BSDF_PRINCIPLED"
        ]
        if not wanted:
            continue
        for node in outputs:
            node.is_active_output = node is wanted[0]
        wanted[0].target = "ALL"


def tile_meshes(count):
    """Duplicate the only mesh object (count - 1) times along X, edge to edge."""
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        sys.exit("--tile needs exactly one mesh object, found %d" % len(meshes))
    original = meshes[0]
    width = original.dimensions.x
    collection = original.users_collection[0]
    base_x = original.location.x
    for index in range(count):
        target = original if index == 0 else original.copy()
        if index != 0:
            collection.objects.link(target)
        target.location.x = base_x + (index - (count - 1) / 2) * width


def main():
    source, output, name, kept, tile = parse_args(sys.argv)
    diffuse_to_principled()
    prefer_principled_outputs()
    if tile > 1:
        tile_meshes(tile)
    if kept is not None:
        drop_other_actions(kept)
    use_selection = select_target(name)
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output,
        export_format=EXPORT_FORMAT,
        export_yup=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_cameras=False,
        export_lights=False,
        use_selection=use_selection,
    )
    print("EXPORTED %s -> %s" % (os.path.basename(source), output))


main()
