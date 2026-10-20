"""Blender (5.x) pipeline: clean, rig and animate a Hunyuan3D mesh, then export a game GLB.

blender -b --factory-startup -P tools/blender_rig.py -- <in.glb> <out.glb> <kind> ['{json opts}']

kind: biped | quadruped | flyer | static
opts:
  faces      target triangle count (default 9000)
  tex        texture size (default 1024)
  yaw        degrees to rotate the imported mesh about Z before anything else (make it face -Y)
  attack     biped attack style: melee | heavy | bow | gun | cast | spin | stab
  rider      (quadruped) path to a rider GLB that is attached rigidly to the mount's back
  rider_h    rider height relative to the mount height (default 0.75)
  preview    path to write a front/back/side preview PNG
The character always ends up 1.0 unit tall, feet at z=0, centred, facing -Y
(the glTF exporter turns that into +Z forward, Y up).
"""
import json
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST, KIND = argv[0], argv[1], argv[2]
OPTS = json.loads(argv[3]) if len(argv) > 3 else {}
FPS = 30


def log(*a):
    print('[rig]', *a, flush=True)


# ---------------------------------------------------------------- import + clean

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def import_mesh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        if o.type != 'MESH':
            continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # Unparent from glTF empties, keep transform.
    if obj.parent:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mw
    for o in new:
        if o is not obj and o.name in bpy.data.objects and o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def clean_and_reduce(obj, faces):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    tri = sum(len(p.vertices) - 2 for p in me.polygons)
    if tri > faces:
        mod = obj.modifiers.new('dec', 'DECIMATE')
        mod.ratio = faces / tri
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in me.polygons:
        p.use_smooth = True
    log('faces', sum(len(p.vertices) - 2 for p in me.polygons))


def normalize(obj, yaw_deg=0.0, height=1.0):
    if yaw_deg:
        obj.rotation_euler = (0, 0, math.radians(yaw_deg))
        bpy.ops.object.transform_apply(rotation=True)
    v = verts(obj)
    mn, mx = v.min(0), v.max(0)
    s = height / max(1e-6, (mx[2] - mn[2]))
    c = (mn + mx) / 2
    obj.data.transform(Matrix.Translation((-c[0], -c[1], -mn[2])))
    obj.data.transform(Matrix.Scale(s, 4))
    obj.data.update()


def verts(obj):
    me = obj.data
    a = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def fix_materials():
    """Painted assets are non-metallic; glTF defaults a missing metallic factor to 1."""
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                n.inputs['Metallic'].default_value = 0.0
                n.inputs['Roughness'].default_value = max(0.6, min(0.9, n.inputs['Roughness'].default_value))


def shrink_textures(size):
    for img in bpy.data.images:
        if img.size[0] > size:
            img.scale(size, size)


# ---------------------------------------------------------------- landmarks

def segments(xs, gap):
    """Split sorted 1D coordinates into clusters separated by > gap."""
    if len(xs) == 0:
        return []
    xs = np.sort(xs)
    cuts = np.where(np.diff(xs) > gap)[0]
    out = []
    start = 0
    for c in cuts:
        out.append((xs[start], xs[c]))
        start = c + 1
    out.append((xs[start], xs[-1]))
    return out


def silhouette(obj, res=320):
    """Rasterize the mesh's front (XZ) projection into a boolean mask [row=z, col=x]."""
    me = obj.data
    me.calc_loop_triangles()
    V = verts(obj)
    tris = np.array([t.vertices[:] for t in me.loop_triangles], dtype=np.int64)
    xmin = float(V[:, 0].min())
    span = max(float(V[:, 0].max()) - xmin, float(V[:, 2].max()))
    sc = (res - 1) / span
    P = np.stack([(V[:, 0] - xmin) * sc, V[:, 2] * sc], 1)
    grid = np.zeros((res, res), dtype=bool)
    for t in tris:
        a, b, c = P[t[0]], P[t[1]], P[t[2]]
        x0 = int(max(0, np.floor(min(a[0], b[0], c[0]))))
        x1 = int(min(res - 1, np.ceil(max(a[0], b[0], c[0]))))
        z0 = int(max(0, np.floor(min(a[1], b[1], c[1]))))
        z1 = int(min(res - 1, np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or z1 < z0:
            continue
        xs, zs = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(z0, z1 + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9:
            grid[int((a[1] + b[1] + c[1]) / 3), int((a[0] + b[0] + c[0]) / 3)] = True
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (zs - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (zs - c[1])) / d
        inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
        grid[z0:z1 + 1, x0:x1 + 1] |= inside
    return grid, xmin, sc


def runs(row):
    """Contiguous True segments of a 1D bool array as (start, end) inclusive."""
    idx = np.flatnonzero(row)
    if len(idx) == 0:
        return []
    cuts = np.flatnonzero(np.diff(idx) > 1)
    starts = np.r_[idx[0], idx[cuts + 1]]
    ends = np.r_[idx[cuts], idx[-1]]
    return list(zip(starts, ends))


def biped_landmarks(V, obj=None):
    y = V[:, 1]
    z = V[:, 2]
    grid, xmin, sc = silhouette(obj)
    res = grid.shape[0]
    top = int(np.flatnonzero(grid.any(1)).max())
    cx = int(round((0 - xmin) * sc))
    tz = lambda r: r / sc  # noqa: E731
    tx = lambda c: c / sc + xmin  # noqa: E731
    W = float(V[:, 0].max() - V[:, 0].min())
    yc = float(np.median(y[(z > 0.2) & (z < 0.6)])) if ((z > 0.2) & (z < 0.6)).any() else float(np.median(y))

    def centre_run(r):
        for a, b in runs(grid[r]):
            if a - 2 <= cx <= b + 2:
                return a, b
        return None

    # Crotch: lowest row where the centre column is filled (legs merge).
    crotch_r = None
    for r in range(2, int(top * 0.6)):
        if grid[r, max(0, cx - 1):cx + 2].any():
            crotch_r = r
            break
    crotch = tz(crotch_r) if crotch_r is not None else 0.17
    # Capes, robes and coats fill the gap between the legs: fall back to chibi proportions.
    if crotch < 0.11:
        crotch = 0.17
    crotch = float(np.clip(crotch, 0.11, 0.4))

    # Arm gap: rows above the crotch with an arm run on both sides of the torso run.
    armpit_r = None
    lowest_arm_r = None
    for r in range(int(crotch * sc) + 2, int(top * 0.85)):
        rs = runs(grid[r])
        cr = centre_run(r)
        if cr is None or len(rs) < 3:
            continue
        left = [s for s in rs if s[1] < cr[0]]
        right = [s for s in rs if s[0] > cr[1]]
        if left and right:
            armpit_r = r
            if lowest_arm_r is None:
                lowest_arm_r = r
    if armpit_r is not None:
        cr = centre_run(armpit_r)
        torso = max(0.05, (tx(cr[1]) - tx(cr[0])) / 2)
        shoulder_z = tz(armpit_r) + 0.035
    else:
        torso = 0.14
        shoulder_z = crotch + 0.3
    shoulder_z = float(np.clip(shoulder_z, crotch + 0.12, 0.75))

    # Hands: outermost silhouette pixel per side between crotch and shoulder.
    hands = {}
    band = grid[int(crotch * sc * 0.8):int(shoulder_z * sc)]
    for side in (1, -1):
        cols = np.flatnonzero(band.any(0))
        if len(cols) == 0:
            hands[side] = np.array([side * W * 0.45, yc, shoulder_z - 0.2])
            continue
        c = cols.max() if side > 0 else cols.min()
        rows = np.flatnonzero(band[:, c]) + int(crotch * sc * 0.8)
        hz = tz(float(np.mean(rows)))
        hx = tx(c) - side * 0.03
        near = (np.abs(V[:, 0] - hx) < 0.05) & (np.abs(V[:, 2] - hz) < 0.05)
        hy = float(np.median(V[near, 1])) if near.any() else yc
        hands[side] = np.array([hx, hy, hz])

    # Neck: narrowest torso-run width in the band above the shoulders.
    neck = shoulder_z + 0.05
    best = 1e9
    for r in range(int((shoulder_z + 0.02) * sc), min(top, int((shoulder_z + 0.11) * sc))):
        cr = centre_run(r)
        if cr is None:
            continue
        w = cr[1] - cr[0]
        if w < best:
            best = w
            neck = tz(r)
    neck = float(np.clip(neck, shoulder_z + 0.02, 0.9))

    # Leg centres from the rows below the crotch.
    legs = {1: 0.08, -1: 0.08}
    lr = max(1, int(crotch * sc * 0.5))
    for side in (1, -1):
        rs = runs(grid[lr])
        ss = [s for s in rs if (tx((s[0] + s[1]) / 2) * side) > 0]
        if ss:
            s0 = max(ss, key=lambda s: s[1] - s[0])
            legs[side] = abs(tx((s0[0] + s0[1]) / 2))
    # Robes/capes can merge the legs into one blob: keep the hips a plausible distance apart.
    spread = max(legs[1], legs[-1])
    for side in (1, -1):
        if legs[side] < 0.05:
            legs[side] = max(0.07, spread * 0.9)
    return dict(crotch=crotch, shoulder=shoulder_z, torso=float(torso), hands=hands,
                neck=neck, legs=legs, yc=yc, width=W)


# ---------------------------------------------------------------- armature helpers

def new_armature():
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm = bpy.context.object
    arm.name = 'Rig'
    eb = arm.data.edit_bones
    for b in list(eb):
        eb.remove(b)
    return arm


def add_bone(arm, name, head, tail, parent=None, connect=False):
    b = arm.data.edit_bones.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    if (b.tail - b.head).length < 1e-3:
        b.tail = b.head + Vector((0, 0, 0.02))
    b.align_roll(Vector((0, -1, 0)) if abs((b.tail - b.head).normalized().y) < 0.9 else Vector((0, 0, 1)))
    if parent:
        b.parent = arm.data.edit_bones[parent]
        b.use_connect = connect
    return b


def build_biped(arm, L):
    c, s, n = L['crotch'], L['shoulder'], L['neck']
    yc = L['yc']
    hips = (0, yc, c + 0.03)
    spine = (0, yc, c + (s - c) * 0.45)
    chest = (0, yc, c + (s - c) * 0.85)
    add_bone(arm, 'hips', hips, spine)
    add_bone(arm, 'spine', spine, chest, 'hips', True)
    add_bone(arm, 'chest', chest, (0, yc, n), 'spine', True)
    add_bone(arm, 'head', (0, yc, n), (0, yc, 1.0), 'chest', True)
    for side, sfx in ((1, 'L'), (-1, 'R')):
        sh = Vector((side * L['torso'] * 0.85, yc, s - 0.03))
        hand = Vector(L['hands'][side])
        hand.y = yc + (hand.y - yc) * 0.5
        elbow = sh.lerp(hand, 0.5) + Vector((0, 0.02, 0))
        add_bone(arm, f'upperarm.{sfx}', sh, elbow, 'chest')
        add_bone(arm, f'forearm.{sfx}', elbow, hand, f'upperarm.{sfx}', True)
        d = (hand - elbow).normalized()
        add_bone(arm, f'hand.{sfx}', hand, hand + d * 0.06, f'forearm.{sfx}', True)
        lx = L['legs'][side]
        hip = Vector((side * max(lx * 0.9, 0.03), yc, c))
        ankle = Vector((side * lx, yc, 0.05))
        knee = hip.lerp(ankle, 0.5) + Vector((0, -0.01, 0))
        add_bone(arm, f'thigh.{sfx}', hip, knee, 'hips')
        add_bone(arm, f'shin.{sfx}', knee, ankle, f'thigh.{sfx}', True)
        add_bone(arm, f'foot.{sfx}', ankle, ankle + Vector((0, -0.07, -0.03)), f'shin.{sfx}', True)


def quadruped_landmarks(V):
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    low = z < 0.22
    feet = V[low]
    # Four leg clusters by quadrant around the body centre (front = -Y).
    cy = float(np.median(y))
    legs = {}
    for fx, fy, name in ((1, -1, 'FL'), (-1, -1, 'FR'), (1, 1, 'BL'), (-1, 1, 'BR')):
        q = feet[(np.sign(feet[:, 0]) == fx) & (np.sign(feet[:, 1] - cy) == fy)]
        legs[name] = q.mean(0) if len(q) else np.array([fx * 0.15, cy + fy * 0.25, 0.05])
    belly = float(np.percentile(z[(np.abs(x) < 0.08)], 5)) if (np.abs(x) < 0.08).sum() else 0.35
    front = float(y.min())
    back = float(y.max())
    top = float(z.max())
    return dict(legs=legs, belly=max(0.18, belly), front=front, back=back, top=top, cy=cy)


def build_quadruped(arm, Q):
    b = Q['belly']
    body_z = b + 0.15
    add_bone(arm, 'hips', (0, Q['back'] * 0.55, body_z), (0, 0, body_z + 0.02))
    add_bone(arm, 'spine', (0, 0, body_z + 0.02), (0, Q['front'] * 0.45, body_z + 0.04), 'hips', True)
    add_bone(arm, 'neck', (0, Q['front'] * 0.45, body_z + 0.04), (0, Q['front'] * 0.75, body_z + 0.12), 'spine', True)
    add_bone(arm, 'head', (0, Q['front'] * 0.75, body_z + 0.12), (0, Q['front'] * 1.0, body_z + 0.1), 'neck', True)
    add_bone(arm, 'tail', (0, Q['back'] * 0.6, body_z + 0.03), (0, Q['back'] * 1.0, body_z + 0.1), 'hips')
    for name, p in Q['legs'].items():
        parent = 'spine' if name.startswith('F') else 'hips'
        top = Vector((p[0], p[1], b + 0.02))
        foot = Vector((p[0], p[1], 0.03))
        knee = top.lerp(foot, 0.5) + Vector((0, 0.015 if name.startswith('F') else -0.015, 0))
        add_bone(arm, f'leg.{name}', top, knee, parent)
        add_bone(arm, f'shin.{name}', knee, foot, f'leg.{name}', True)


def flyer_landmarks(V):
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    W = float(x.max())
    # Body half width: central cluster width around mid height.
    m = np.abs(z - 0.45) < 0.03
    segs = segments(x[m], 0.03) if m.sum() else [(-0.15, 0.15)]
    centre = min(segs, key=lambda s: abs((s[0] + s[1]) / 2))
    body = max(0.08, (centre[1] - centre[0]) / 2)
    # Wing attachment height: where outer parts exist, weighted by mass.
    outer = np.abs(x) > body * 1.3
    wz = float(np.median(z[outer])) if outer.sum() > 10 else 0.6
    tips = {}
    for side in (1, -1):
        mm = side * x > body * 1.3
        tips[side] = V[np.argmax(side * x * mm.astype(float) - (~mm) * 9)].copy() if mm.sum() else np.array([side * W, 0, wz])
    return dict(body=body, wz=wz, tips=tips, yc=float(np.median(y)), top=float(z.max()))


def build_flyer(arm, F):
    yc = F['yc']
    add_bone(arm, 'hips', (0, yc, 0.25), (0, yc, 0.5))
    add_bone(arm, 'chest', (0, yc, 0.5), (0, yc, 0.68), 'hips', True)
    add_bone(arm, 'head', (0, yc, 0.68), (0, yc, 1.0), 'chest', True)
    add_bone(arm, 'tail', (0, yc + 0.05, 0.25), (0, yc + 0.3, 0.1), 'hips')
    for side, sfx in ((1, 'L'), (-1, 'R')):
        root = Vector((side * F['body'] * 0.9, yc, F['wz']))
        tip = Vector(F['tips'][side])
        mid = root.lerp(tip, 0.5)
        add_bone(arm, f'wing1.{sfx}', root, mid, 'chest')
        add_bone(arm, f'wing2.{sfx}', mid, tip, f'wing1.{sfx}', True)
        add_bone(arm, f'leg.{sfx}', (side * F['body'] * 0.5, yc, 0.25), (side * F['body'] * 0.5, yc, 0.02), 'hips')


# ---------------------------------------------------------------- skinning

def skin(obj, arm):
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    except Exception as e:
        log('auto weights raised', e)
    # Validate: fraction of vertices with no weights.
    me = obj.data
    unweighted = sum(1 for v in me.vertices if not any(g.weight > 1e-3 for g in v.groups))
    frac = unweighted / max(1, len(me.vertices))
    log(f'unweighted vertices: {frac:.1%}')
    if frac > 0.02:
        log('falling back to distance weights')
        distance_weights(obj, arm)
    rigid_hands(obj, arm)


def rigid_hands(obj, arm):
    """Weapons/shields held in a hand move rigidly with it instead of bending."""
    bones = arm.data.bones
    V = verts(obj)
    vg = obj.vertex_groups
    for sfx in ('L', 'R'):
        if f'hand.{sfx}' not in bones:
            continue
        hand = np.array(bones[f'hand.{sfx}'].head_local)
        elbow = np.array(bones[f'forearm.{sfx}'].head_local)
        names = {f'hand.{sfx}', f'forearm.{sfx}'}
        idx = [g.index for g in vg if g.name in names]
        sel = []
        for v in obj.data.vertices:
            w = sum(g.weight for g in v.groups if g.group in idx)
            if w < 0.5:
                continue
            p = V[v.index]
            if np.linalg.norm(p - hand) < np.linalg.norm(p - elbow) * 0.9:
                sel.append(v.index)
        if not sel:
            continue
        for g in vg:
            g.remove(sel)
        vg[f'hand.{sfx}'].add(sel, 1.0, 'REPLACE')
        log(f'rigid hand.{sfx}: {len(sel)} verts')


def distance_weights(obj, arm):
    """Robust fallback: weight each vertex to its 2 nearest bone segments."""
    if not obj.parent:
        obj.parent = arm
    mod = next((m for m in obj.modifiers if m.type == 'ARMATURE'), None) or obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    obj.vertex_groups.clear()
    bones = [(b.name, np.array(b.head_local), np.array(b.tail_local)) for b in arm.data.bones]
    groups = {n: obj.vertex_groups.new(name=n) for n, _, _ in bones}
    V = verts(obj)
    D = np.zeros((len(V), len(bones)))
    for i, (_, h, t) in enumerate(bones):
        ab = t - h
        tt = np.clip(((V - h) @ ab) / max(1e-9, ab @ ab), 0, 1)
        P = h + tt[:, None] * ab
        D[:, i] = np.linalg.norm(V - P, axis=1)
    # Side constraint: vertices clearly on one side should not bind to the other side's limbs.
    for i, (n, h, t) in enumerate(bones):
        if n.endswith('.L'):
            D[V[:, 0] < -0.01, i] += 10
        if n.endswith('.R'):
            D[V[:, 0] > 0.01, i] += 10
    order = np.argsort(D, axis=1)[:, :2]
    for vi in range(len(V)):
        a, b = order[vi]
        da, db = D[vi, a] + 1e-4, D[vi, b] + 1e-4
        wa = (1 / da ** 4)
        wb = (1 / db ** 4)
        s = wa + wb
        groups[bones[a][0]].add([vi], wa / s, 'REPLACE')
        if wb / s > 0.05:
            groups[bones[b][0]].add([vi], wb / s, 'REPLACE')


# ---------------------------------------------------------------- animation

class Anim:
    """Keyframe helper working in world-axis rotations about each bone's head."""

    def __init__(self, arm):
        self.arm = arm
        self.pb = arm.pose.bones
        for p in self.pb:
            p.rotation_mode = 'QUATERNION'
        arm.animation_data_create()

    def q(self, bone, axis, deg):
        if bone not in self.pb:
            return Quaternion()
        M = self.pb[bone].bone.matrix_local.to_3x3()
        R = Matrix.Rotation(math.radians(deg), 3, axis)
        return (M.inverted() @ R @ M).to_quaternion()

    def begin(self, name):
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        self.arm.animation_data.action = act
        self.name = name
        return act

    def pose(self, frame, rots=None, locs=None):
        """rots: {bone: [(axis, deg), ...]}, locs: {bone: (x,y,z) world offset}. Unlisted bones rest."""
        rots = rots or {}
        locs = locs or {}
        for p in self.pb:
            qq = Quaternion()
            for axis, deg in rots.get(p.name, []):
                qq = self.q(p.name, axis, deg) @ qq
            p.rotation_quaternion = qq
            off = Vector(locs.get(p.name, (0, 0, 0)))
            p.location = p.bone.matrix_local.to_3x3().inverted() @ off
            p.keyframe_insert('rotation_quaternion', frame=frame)
            p.keyframe_insert('location', frame=frame)

    def end(self, start, stop):
        act = self.arm.animation_data.action
        track = self.arm.animation_data.nla_tracks.new()
        track.name = self.name
        track.strips.new(self.name, int(start), act)
        self.arm.animation_data.action = None


X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))


def biped_anims(A, style):
    # Idle: breathe and sway (2 s loop).
    A.begin('idle')
    for f, k in ((0, 0), (30, 1), (60, 0)):
        A.pose(f, {
            'chest': [(X, 2.5 * k)], 'head': [(X, -2 * k)], 'spine': [(Z, 1.5 * k)],
            'upperarm.L': [(Y, -3 * k)], 'upperarm.R': [(Y, 3 * k)],
        }, {'hips': (0, 0, -0.006 * k)})
    A.end(0, 60)

    # Walk: 0.8 s stride cycle.
    A.begin('walk')
    T = 24
    for i in range(0, T + 1, 3):
        ph = (i / T) * 2 * math.pi
        sw = math.sin(ph)
        bob = abs(math.cos(ph))
        A.pose(i, {
            'thigh.L': [(X, -30 * sw)], 'thigh.R': [(X, 30 * sw)],
            'shin.L': [(X, 35 * max(0, math.sin(ph + 1.6)))], 'shin.R': [(X, 35 * max(0, math.sin(ph + 1.6 + math.pi)))],
            'upperarm.L': [(X, 24 * sw)], 'upperarm.R': [(X, -24 * sw)],
            'forearm.L': [(X, -15 - 10 * sw)], 'forearm.R': [(X, -15 + 10 * sw)],
            'spine': [(X, 6), (Z, 5 * sw)], 'chest': [(Z, -4 * sw)], 'head': [(X, -4)],
        }, {'hips': (0, 0, 0.022 * (1 - bob) - 0.008)})
    A.end(0, T)

    # Attack.
    A.begin('attack')
    if style == 'heavy':
        keys = [
            (0, {}, {}),
            (7, {'upperarm.L': [(X, -150)], 'upperarm.R': [(X, -150)], 'forearm.L': [(X, -30)], 'forearm.R': [(X, -30)], 'spine': [(X, -10)], 'thigh.L': [(X, -10)], 'thigh.R': [(X, 10)]}, {'hips': (0, 0.02, 0.01)}),
            (11, {'upperarm.L': [(X, 25)], 'upperarm.R': [(X, 25)], 'spine': [(X, 22)], 'chest': [(X, 10)], 'thigh.L': [(X, -25)], 'shin.L': [(X, 30)], 'thigh.R': [(X, 15)], 'shin.R': [(X, 30)]}, {'hips': (0, -0.05, -0.05)}),
            (15, {'upperarm.L': [(X, 30)], 'upperarm.R': [(X, 30)], 'spine': [(X, 18)], 'thigh.L': [(X, -20)], 'shin.L': [(X, 25)], 'shin.R': [(X, 25)]}, {'hips': (0, -0.04, -0.04)}),
            (22, {}, {}),
        ]
    elif style == 'bow':
        keys = [
            (0, {}, {}),
            (6, {'upperarm.L': [(X, -85), (Z, -15)], 'upperarm.R': [(X, -80), (Z, 20)], 'forearm.R': [(Z, 70)], 'chest': [(Z, 15)], 'head': [(Z, -10)]}, {}),
            (10, {'upperarm.L': [(X, -88), (Z, -15)], 'upperarm.R': [(X, -78), (Z, 30)], 'forearm.R': [(Z, 95)], 'chest': [(Z, 18)], 'head': [(Z, -12)]}, {}),
            (12, {'upperarm.L': [(X, -80), (Z, -15)], 'upperarm.R': [(X, -60), (Z, -10)], 'chest': [(Z, 8), (X, -4)]}, {'hips': (0, 0.02, 0)}),
            (20, {}, {}),
        ]
    elif style == 'gun':
        keys = [
            (0, {}, {}),
            (5, {'upperarm.R': [(X, -75)], 'upperarm.L': [(X, -70), (Z, -25)], 'forearm.L': [(Z, -40)], 'chest': [(Z, 10)]}, {}),
            (8, {'upperarm.R': [(X, -95)], 'upperarm.L': [(X, -88), (Z, -25)], 'forearm.L': [(Z, -40)], 'chest': [(X, -10), (Z, 10)], 'head': [(X, -6)]}, {'hips': (0, 0.05, 0)}),
            (13, {'upperarm.R': [(X, -78)], 'upperarm.L': [(X, -72), (Z, -25)], 'forearm.L': [(Z, -40)], 'chest': [(Z, 8)]}, {}),
            (20, {}, {}),
        ]
    elif style == 'cast':
        keys = [
            (0, {}, {}),
            (8, {'upperarm.R': [(X, -160)], 'forearm.R': [(X, -10)], 'upperarm.L': [(X, -40), (Y, -30)], 'spine': [(X, -8)], 'head': [(X, -10)]}, {'hips': (0, 0.02, 0.01)}),
            (12, {'upperarm.R': [(X, -85)], 'upperarm.L': [(X, -60)], 'spine': [(X, 14)], 'chest': [(X, 6)]}, {'hips': (0, -0.04, -0.01)}),
            (16, {'upperarm.R': [(X, -80)], 'upperarm.L': [(X, -50)], 'spine': [(X, 10)]}, {'hips': (0, -0.03, 0)}),
            (24, {}, {}),
        ]
    elif style == 'spin':
        keys = [(0, {}, {})]
        for i, f in enumerate(range(3, 19, 3)):
            ang = -360 * (i + 1) / 6
            keys.append((f, {'hips': [(Z, ang)], 'upperarm.L': [(Y, -55)], 'upperarm.R': [(Y, 55)], 'forearm.R': [(Y, 20)]}, {'hips': (0, 0, 0.02)}))
        keys.append((22, {}, {}))
    elif style == 'stab':
        keys = [
            (0, {}, {}),
            (4, {'upperarm.R': [(X, 30)], 'forearm.R': [(X, -60)], 'spine': [(Z, 15)], 'chest': [(Z, 10)]}, {}),
            (7, {'upperarm.R': [(X, -80)], 'forearm.R': [(X, 0)], 'spine': [(X, 15), (Z, -15)], 'thigh.R': [(X, -25)], 'shin.R': [(X, 20)]}, {'hips': (0, -0.06, -0.02)}),
            (11, {'upperarm.R': [(X, -70)], 'spine': [(X, 10)]}, {'hips': (0, -0.04, -0.01)}),
            (16, {}, {}),
        ]
    else:  # melee: overhead diagonal slash with the right arm
        keys = [
            (0, {}, {}),
            (6, {'upperarm.R': [(X, -120), (Y, 25)], 'forearm.R': [(X, -35)], 'chest': [(Z, 14)], 'spine': [(X, -6), (Z, 8)], 'upperarm.L': [(X, -25)]}, {'hips': (0, 0.02, 0)}),
            (9, {'upperarm.R': [(X, 35), (Y, -10)], 'forearm.R': [(X, -5)], 'chest': [(Z, -18)], 'spine': [(X, 14), (Z, -10)], 'upperarm.L': [(X, 15)], 'thigh.R': [(X, -22)], 'shin.R': [(X, 18)]}, {'hips': (0, -0.05, -0.02)}),
            (13, {'upperarm.R': [(X, 50), (Y, -15)], 'chest': [(Z, -22)], 'spine': [(X, 12), (Z, -12)], 'thigh.R': [(X, -18)], 'shin.R': [(X, 15)]}, {'hips': (0, -0.04, -0.02)}),
            (19, {}, {}),
        ]
    for f, r, l in keys:
        A.pose(f, r, l)
    A.end(0, keys[-1][0])

    # Hit react.
    A.begin('hit')
    A.pose(0)
    A.pose(3, {'spine': [(X, -14)], 'chest': [(X, -8)], 'head': [(X, -10)], 'upperarm.L': [(Y, -20)], 'upperarm.R': [(Y, 20)]}, {'hips': (0, 0.04, 0)})
    A.pose(9)
    A.end(0, 9)

    # Death: knees buckle, topple backward.
    A.begin('death')
    A.pose(0)
    A.pose(5, {'spine': [(X, -8)], 'head': [(X, -10)], 'shin.L': [(X, 25)], 'shin.R': [(X, 25)], 'thigh.L': [(X, -12)], 'thigh.R': [(X, -12)]}, {'hips': (0, 0.02, -0.05)})
    A.pose(13, {'hips': [(X, -70)], 'spine': [(X, -10)], 'thigh.L': [(X, -30)], 'thigh.R': [(X, -25)], 'shin.L': [(X, 20)], 'shin.R': [(X, 15)], 'upperarm.L': [(Y, -25)], 'upperarm.R': [(Y, 25)]}, {'hips': (0, 0.18, -0.15)})
    A.pose(20, {'hips': [(X, -82)], 'spine': [(X, -6)], 'thigh.L': [(X, -25)], 'thigh.R': [(X, -20)], 'upperarm.L': [(Y, -30)], 'upperarm.R': [(Y, 30)]}, {'hips': (0, 0.24, -0.2)})
    A.end(0, 20)


def quadruped_anims(A):
    A.begin('idle')
    for f, k in ((0, 0), (30, 1), (60, 0)):
        A.pose(f, {'spine': [(X, 1.5 * k)], 'neck': [(X, -4 * k)], 'head': [(X, 3 * k)], 'tail': [(Z, 15 * (k - 0.5))]}, {'hips': (0, 0, -0.008 * k)})
    A.end(0, 60)
    A.begin('walk')  # gallop-ish trot
    T = 16
    for i in range(0, T + 1, 2):
        ph = (i / T) * 2 * math.pi
        s = math.sin(ph)
        A.pose(i, {
            'leg.FL': [(X, -35 * s)], 'leg.BR': [(X, -35 * s)], 'leg.FR': [(X, 35 * s)], 'leg.BL': [(X, 35 * s)],
            'shin.FL': [(X, -30 * max(0, -s))], 'shin.BR': [(X, 30 * max(0, -s))], 'shin.FR': [(X, -30 * max(0, s))], 'shin.BL': [(X, 30 * max(0, s))],
            'spine': [(X, 3 * s)], 'neck': [(X, -6 * s)], 'tail': [(X, 20 * s)],
        }, {'hips': (0, 0, 0.03 * abs(math.cos(ph)))})
    A.end(0, T)
    A.begin('attack')  # rear up and stomp / tusk swipe
    A.pose(0)
    A.pose(6, {'hips': [(X, -22)], 'leg.FL': [(X, -50)], 'leg.FR': [(X, -45)], 'neck': [(X, -10)]}, {'hips': (0, 0.03, 0.04)})
    A.pose(10, {'hips': [(X, 10)], 'neck': [(X, 25)], 'head': [(X, 20)], 'leg.FL': [(X, 10)], 'leg.FR': [(X, 10)]}, {'hips': (0, -0.06, -0.02)})
    A.pose(18)
    A.end(0, 18)
    A.begin('hit')
    A.pose(0)
    A.pose(3, {'hips': [(Z, 8)], 'neck': [(X, -12)]}, {'hips': (0, 0.04, 0)})
    A.pose(9)
    A.end(0, 9)
    A.begin('death')
    A.pose(0)
    A.pose(8, {'hips': [(Y, 40)], 'leg.FL': [(X, -30)], 'leg.BL': [(X, 30)]}, {'hips': (0, 0, -0.06)})
    A.pose(18, {'hips': [(Y, 88)], 'neck': [(X, -20)], 'leg.FL': [(X, -40)], 'leg.BL': [(X, 40)], 'leg.FR': [(X, -20)]}, {'hips': (0.15, 0, -0.18)})
    A.end(0, 18)


def flyer_anims(A):
    def flap(frames, amp, speed_bob):
        T = frames
        for i in range(0, T + 1, 2):
            ph = (i / T) * 2 * math.pi
            s = math.sin(ph)
            A.pose(i, {
                'wing1.L': [(Y, -amp * s)], 'wing1.R': [(Y, amp * s)],
                'wing2.L': [(Y, -amp * 0.6 * math.sin(ph - 0.8))], 'wing2.R': [(Y, amp * 0.6 * math.sin(ph - 0.8))],
                'tail': [(X, 10 * math.sin(ph + 1))], 'head': [(X, 3 * s)],
                'leg.L': [(X, 8 * s)], 'leg.R': [(X, 8 * s)],
            }, {'hips': (0, 0, speed_bob * math.cos(ph))})
        return T
    A.begin('idle')
    A.end(0, flap(20, 32, 0.03))
    A.begin('walk')
    A.end(0, flap(14, 40, 0.02))
    A.begin('attack')
    A.pose(0)
    A.pose(5, {'chest': [(X, -15)], 'head': [(X, -20)], 'wing1.L': [(Y, 40)], 'wing1.R': [(Y, -40)]}, {'hips': (0, 0.06, 0.03)})
    A.pose(9, {'chest': [(X, 20)], 'head': [(X, 25)], 'wing1.L': [(Y, -30)], 'wing1.R': [(Y, 30)]}, {'hips': (0, -0.1, -0.02)})
    A.pose(16)
    A.end(0, 16)
    A.begin('hit')
    A.pose(0)
    A.pose(3, {'chest': [(X, -15)], 'head': [(X, -12)]}, {'hips': (0, 0.05, 0.02)})
    A.pose(9)
    A.end(0, 9)
    A.begin('death')
    A.pose(0)
    A.pose(8, {'wing1.L': [(Y, 60)], 'wing1.R': [(Y, -60)], 'hips': [(X, -40)]}, {'hips': (0, 0, -0.3)})
    A.pose(18, {'wing1.L': [(Y, 75)], 'wing1.R': [(Y, -75)], 'hips': [(X, -80)]}, {'hips': (0, 0.1, -0.9)})
    A.end(0, 18)


# ---------------------------------------------------------------- preview

def render_preview(path, objs):
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_WORKBENCH'
    scn.display.shading.light = 'STUDIO'
    scn.display.shading.color_type = 'TEXTURE'
    scn.render.resolution_x = 768
    scn.render.resolution_y = 384
    scn.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    scn.world = world
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.3
    cam = bpy.data.objects.new('cam', cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    shots = []
    import os
    base = os.path.splitext(path)[0]
    for i, (pos, rot) in enumerate((((0, -3, 0.5), (math.pi / 2, 0, 0)), ((3, 0, 0.5), (math.pi / 2, 0, math.pi / 2)), ((0, 3, 0.5), (math.pi / 2, 0, math.pi)))):
        cam.location = pos
        cam.rotation_euler = rot
        scn.render.filepath = f'{base}_{i}.png'
        bpy.ops.render.render(write_still=True)
        shots.append(scn.render.filepath)
    log('preview', shots)


def render_anim_preview(path, rig):
    """Render a strip of frames from each action (3/4 view) for eyeballing the animation."""
    import os
    scn = bpy.context.scene
    if scn.camera is None:
        render_preview(os.path.splitext(path)[0] + '_rest.png', [])
    cam = scn.camera
    cam.location = (2.2, -2.6, 1.3)
    cam.rotation_euler = (math.radians(72), 0, math.radians(40))
    cam.data.ortho_scale = 2.0
    scn.render.resolution_x = 256
    scn.render.resolution_y = 256
    base = os.path.splitext(path)[0]
    tracks = {t.name: t for t in rig.animation_data.nla_tracks}
    for t in tracks.values():
        t.mute = True
    for name in ('walk', 'attack', 'death'):
        if name not in tracks:
            continue
        act = tracks[name].strips[0].action
        rig.animation_data.action = act
        end = int(tracks[name].strips[0].frame_end)
        for k, f in enumerate(np.linspace(0, end, 6).astype(int)):
            scn.frame_set(int(f))
            scn.render.filepath = f'{base}_{name}_{k}.png'
            bpy.ops.render.render(write_still=True)
        rig.animation_data.action = None
    log('anim preview written', base)


# ---------------------------------------------------------------- main

def main():
    reset()
    obj = import_mesh(SRC)
    clean_and_reduce(obj, int(OPTS.get('faces', 9000)))
    normalize(obj, float(OPTS.get('yaw', 0)))
    shrink_textures(int(OPTS.get('tex', 1024)))
    fix_materials()
    rig = None
    if KIND == 'biped':
        L = biped_landmarks(verts(obj), obj)
        log('landmarks', {k: (v if not isinstance(v, dict) else {kk: (vv.tolist() if hasattr(vv, 'tolist') else vv) for kk, vv in v.items()}) for k, v in L.items()})
        rig = new_armature()
        build_biped(rig, L)
    elif KIND == 'quadruped':
        if OPTS.get('rider'):
            rider = import_mesh(OPTS['rider'])
            clean_and_reduce(rider, int(OPTS.get('rider_faces', 5000)))
            normalize(rider, float(OPTS.get('rider_yaw', 0)), float(OPTS.get('rider_h', 0.75)))
            Vm = verts(obj)
            Qm = quadruped_landmarks(Vm)
            # Saddle height: top surface near the middle of the back.
            mid = (np.abs(Vm[:, 0]) < 0.08) & (np.abs(Vm[:, 1] - Qm['cy']) < 0.1)
            saddle = float(np.percentile(Vm[mid, 2], 80)) if mid.sum() > 10 else Qm['belly'] + 0.3
            rh = float(OPTS.get('rider_h', 0.75))
            rider.data.transform(Matrix.Translation((0, Qm['cy'] + 0.02, saddle - rh * 0.3)))
            log('saddle', saddle)
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            rider.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.join()
            obj = bpy.context.view_layer.objects.active
            normalize(obj)
        Q = quadruped_landmarks(verts(obj))
        log('quadruped', {k: (v if not isinstance(v, dict) else {kk: vv.tolist() for kk, vv in v.items()}) for k, v in Q.items()})
        rig = new_armature()
        build_quadruped(rig, Q)
    elif KIND == 'flyer':
        F = flyer_landmarks(verts(obj))
        rig = new_armature()
        build_flyer(rig, F)
    if rig is not None:
        bpy.ops.object.mode_set(mode='OBJECT')
        skin(obj, rig)
        A = Anim(rig)
        if KIND == 'biped':
            biped_anims(A, OPTS.get('attack', 'melee'))
        elif KIND == 'quadruped':
            quadruped_anims(A)
        else:
            flyer_anims(A)
        for p in rig.pose.bones:
            p.rotation_quaternion = Quaternion()
            p.location = (0, 0, 0)
    if OPTS.get('preview'):
        render_preview(OPTS['preview'], [obj])
    if OPTS.get('anim_preview') and rig is not None:
        render_anim_preview(OPTS['anim_preview'], rig)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=DST,
        export_format='GLB',
        use_selection=False,
        export_animations=rig is not None,
        export_animation_mode='ACTIONS',
        export_image_format='JPEG',
        export_jpeg_quality=86,
        export_apply=False,
        export_yup=True,
    )
    log('exported', DST)


main()
