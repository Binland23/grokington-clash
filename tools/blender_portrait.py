"""Render a card portrait of a game model (transparent PNG).

blender -b --factory-startup -P tools/blender_portrait.py -- <model.glb> <out.png> [size]
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
SIZE = int(argv[2]) if len(argv) > 2 else 512

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scn = bpy.context.scene

# Pose: a frame from the idle clip if there is one.
for o in scn.objects:
    if o.type == 'ARMATURE' and o.animation_data:
        acts = [a for a in bpy.data.actions if a.name.lower().startswith('idle')]
        if acts:
            o.animation_data.action = acts[0]
            scn.frame_set(10)

# The glTF importer adds an 'Icosphere' helper for bone display; drop it.
for o in list(scn.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in scn.objects if o.type == 'MESH']
deps = bpy.context.evaluated_depsgraph_get()
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    ev = o.evaluated_get(deps)
    for v in ev.to_mesh().vertices:
        w = o.matrix_world @ v.co
        mn = Vector(map(min, mn, w))
        mx = Vector(map(max, mx, w))
center = (mn + mx) / 2
height = mx.z - mn.z
width = max(mx.x - mn.x, mx.y - mn.y)

scn.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items.keys() else 'BLENDER_EEVEE_NEXT'
scn.render.film_transparent = True
scn.render.resolution_x = SIZE
scn.render.resolution_y = SIZE
scn.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scn.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
scn.view_settings.look = 'None'

world = bpy.data.worlds.new('w')
scn.world = world
bg = world.node_tree.nodes.get('Background')
bg.inputs[0].default_value = (0.55, 0.62, 0.78, 1)
bg.inputs[1].default_value = 0.9


def light(name, kind, energy, loc, color=(1, 1, 1), size=1.0):
    d = bpy.data.lights.new(name, kind)
    d.energy = energy
    d.color = color
    if kind == 'AREA':
        d.size = size
    o = bpy.data.objects.new(name, d)
    o.location = loc
    scn.collection.objects.link(o)
    o.rotation_euler = (center - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


r = max(height, width)
light('key', 'AREA', 220 * r * r, (center.x + r * 1.2, center.y - r * 1.8, center.z + r * 1.4), (1, 0.95, 0.88), r * 1.2)
light('fill', 'AREA', 70 * r * r, (center.x - r * 1.8, center.y - r * 1.2, center.z + r * 0.4), (0.85, 0.9, 1), r * 1.5)
light('rim', 'AREA', 260 * r * r, (center.x - r * 0.6, center.y + r * 1.8, center.z + r * 1.2), (0.75, 0.85, 1), r * 1.0)

cam_d = bpy.data.cameras.new('cam')
cam_d.lens = 55
cam = bpy.data.objects.new('cam', cam_d)
scn.collection.objects.link(cam)
scn.camera = cam
az = math.radians(-28)
el = math.radians(12)
dist = r * 2.55
target = Vector((center.x, center.y, mn.z + height * 0.5))
cam.location = target + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()

scn.render.filepath = DST
bpy.ops.render.render(write_still=True)
print('[portrait] wrote', DST, flush=True)
