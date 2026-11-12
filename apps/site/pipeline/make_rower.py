"""Build the 3D rower for the home page with Blender + MPFB (MakeHuman), output CC0.

Run headless:
  BLENDER_USER_RESOURCES=<profile with MPFB installed> blender -b --python make_rower.py -- OUT.glb
Produces an athletic male with the MPFB "game engine" skeleton (Unreal-style bone names).
The red vertex colour channel marks the kit (a rowing all-in-one), so one material can shade skin and kit.
"""
import importlib
import os
import sys

import bpy


def dynamic_import(package, key):
    for name in list(sys.modules):
        if name.endswith(package):
            return getattr(importlib.import_module(name), key)
    raise ValueError(package)


HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

macro = {
    "gender": 1.0, "age": 0.5, "muscle": 0.8, "weight": 0.42, "proportions": 0.9,
    "height": 0.8, "cupsize": 0.5, "firmness": 0.5,
    "race": {"asian": 0.2, "caucasian": 0.6, "african": 0.2},
}
# detailed_helpers must be on: the rig is fitted to the joint helper cubes. Without them every
# bone silently falls back to the default (unmorphed) position and the skeleton sits outside the body.
body = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
                                 feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
TargetService.bake_targets(body)
rig = HumanService.add_builtin_rig(body, "game_engine", import_weights=True)

# ---- Check that the skeleton really sits inside the body.
W = body.matrix_world
vz = [(W @ v.co) for v in body.data.vertices if not any(
    body.vertex_groups[g.group].name in ("HelperGeometry", "JointCubes") for g in v.groups)]
top, bottom = max(p.z for p in vz), min(p.z for p in vz)
bone = lambda n: rig.matrix_world @ rig.data.bones[n].head_local
height = top - bottom
leg = (bone("thigh_l") - bone("calf_l")).length + (bone("calf_l") - bone("foot_l")).length
print(f"height {height:.3f}  leg {leg:.3f}  ankle z {bone('foot_l').z:.3f}  head z {bone('head').z:.3f}")
assert 0.03 * height < bone("foot_l").z - bottom < 0.08 * height, "ankle bone is not at the ankle"
assert 0.84 * height < bone("head").z - bottom < 0.93 * height, "head bone is not in the head"
assert 0.44 < leg / height < 0.52, "leg bones do not match the body"
assert 0.48 < (bone("pelvis").z - bottom) / height < 0.60, "pelvis bone is not in the pelvis"

# ---- Kit mask: an all-in-one from mid-thigh to the shoulders, with a scooped neck and open arms.
mesh = body.data
names = {g.index: g.name for g in body.vertex_groups}
knee, hipj, sh, neck = bone("calf_l"), bone("thigh_l"), bone("upperarm_l"), bone("neck_01")
leg_cut = knee.z + 0.42 * (hipj.z - knee.z)
ARM = ("upperarm", "lowerarm", "hand", "index", "middle", "ring", "pinky", "thumb")
col = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
for v in mesh.vertices:
    p = W @ v.co
    arm = sum(g.weight for g in v.groups if names[g.group].startswith(ARM))
    head = sum(g.weight for g in v.groups if names[g.group] in ("neck_01", "head"))
    k = 0.0
    if leg_cut < p.z < neck.z + 0.01 and arm < 0.45 and head < 0.35:
        k = 1.0
        if p.z > sh.z - 0.02:  # shoulder straps and neck scoop
            strap = 0.045 < abs(p.x) < abs(sh.x) - 0.035
            k = 1.0 if strap and p.z < neck.z - 0.005 else 0.0
        if p.z > sh.z - 0.11 and abs(p.x) < 0.05 + (p.z - (sh.z - 0.11)) * 0.5 and p.y < 0:
            k = 0.0  # scooped front (the body faces -y in Blender)
        if abs(p.x) > abs(sh.x) - 0.045 and p.z > sh.z - 0.13:
            k = 0.0  # arm holes
    col.data[v.index].color = (k, k, k, 1.0)
mesh.color_attributes.active_color = col
mesh.color_attributes.render_color_index = 0

for poly in mesh.polygons:
    poly.use_smooth = True

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
print("bones:", len(rig.data.bones), "verts:", len(mesh.vertices))

bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True,
    export_apply=True,             # applies the helper mask, keeps the skin
    export_skins=True, export_animations=False, export_morph=False,
    export_draco_mesh_compression_enable=False,
    export_materials="NONE", export_vertex_color="ACTIVE", export_all_vertex_colors=False,
)
size = os.path.getsize(out) / 1e6
print(f"wrote {out} ({size:.2f} MB)")
assert size < 5, "GLB is over 5 MB"
