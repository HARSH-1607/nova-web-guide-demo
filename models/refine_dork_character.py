"""Refine the editable Drok character and export the web avatar.

Run in Blender with the original Drok scene open. Re-running is safe: named
detail objects are replaced, while the existing animation rig is retained.
"""

import bpy
from math import radians

PROJECT = 'K:/Projects/Unity/Test'
SCENE = bpy.data.scenes['Drok | web avatar']
ROOT = bpy.data.objects['DROK_ROOT | animation rig']


def material(name, color, metallic, roughness, emission=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Coat Weight'].default_value = .28
    shader.inputs['Coat Roughness'].default_value = .2
    if emission:
        shader.inputs['Emission Color'].default_value = (*emission[0], 1)
        shader.inputs['Emission Strength'].default_value = emission[1]
    return mat


armor = material('Drok revised | graphite armor', (.045, .075, .115), .68, .28)
edge = material('Drok revised | cool titanium edge', (.16, .30, .38), .72, .21,
                ((.015, .12, .16), .22))
shadow = material('Drok revised | face relief', (.016, .026, .044), .18, .46)
light = material('Drok revised | restrained cyan', (.07, .48, .54), .34, .28,
                 ((.02, .32, .4), .38))

# Give the original silhouette more depth without changing its recognizable shape.
body_mat = bpy.data.materials['Drok PBR | satin obsidian']
body_shader = next(n for n in body_mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
body_shader.inputs['Base Color'].default_value = (.019, .026, .041, 1)
body_shader.inputs['Metallic'].default_value = .34
body_shader.inputs['Roughness'].default_value = .31
face_mat = bpy.data.materials['Drok PBR | deep face']
face_shader = next(n for n in face_mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
face_shader.inputs['Base Color'].default_value = (.027, .041, .063, 1)
face_shader.inputs['Roughness'].default_value = .39


def ellipsoid(name, parent, loc, size, mat, rotation=(0, 0, 0), segments=20, rings=12):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rotation
    obj.scale = size
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


# Layered temple and jaw forms make the face read as a physical mask.
for side, label in [(-1, 'L'), (1, 'R')]:
    ellipsoid(f'Drok revised {label} temple plate', ROOT,
              (side * .475, -.365, 1.955), (.12, .042, .24), armor,
              (0, side * radians(17), 0))
    ellipsoid(f'Drok revised {label} temple edge', ROOT,
              (side * .51, -.401, 1.958), (.018, .012, .16), edge,
              (0, side * radians(17), 0), 14, 8)
    ellipsoid(f'Drok revised {label} cheek guard', ROOT,
              (side * .392, -.33, 1.47), (.135, .028, .083), shadow,
              (0, side * radians(-26), 0))
    # Lower the visual weight of the eyes slightly and preserve the animated gaze.
    eye = bpy.data.objects[f'Drok {label} white eye']
    eye.scale.x = .137
    eye.scale.z = .164
    brow = bpy.data.objects[f'Drok {label} expressive brow']
    brow.data.materials.clear()
    brow.data.materials.append(armor)

ellipsoid('Drok revised nose bridge', ROOT, (0, -.431, 1.684),
          (.025, .012, .082), armor, segments=16, rings=10)
ellipsoid('Drok revised nose light', ROOT, (0, -.445, 1.687),
          (.009, .006, .035), edge, segments=12, rings=8)
for obsolete in ('Drok revised L cheek seam', 'Drok revised R cheek seam',
                 'Drok revised chin plate', 'Drok revised chin highlight'):
    old = bpy.data.objects.get(obsolete)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)

# Facial intent in every loop: eyebrows and eyes prepare, hold, then release.
def face_key(frame, brow=0, eye=1, gaze=0):
    SCENE.frame_set(frame)
    for side, label in [(-1, 'L'), (1, 'R')]:
        b = bpy.data.objects[f'Drok {label} eyebrow pose']
        b.rotation_euler.y = side * brow
        b.keyframe_insert(data_path='rotation_euler', frame=frame)
        e = bpy.data.objects[f'Drok {label} eye blink']
        e.scale.z = eye
        e.keyframe_insert(data_path='scale', frame=frame)
        g = bpy.data.objects[f'Drok {label} gaze']
        g.location.x = gaze
        g.keyframe_insert(data_path='location', frame=frame)


for frame, brow, eye, gaze in [
    (1, -.015, 1, 0), (10, -.03, .96, 0), (13, -.03, .08, 0),
    (16, -.015, 1, 0), (47, -.015, 1, 0),
    (97, -.045, 1, 0), (108, -.085, .92, -.015),
    (120, -.075, 1, .016), (142, -.025, 1, 0),
    (145, -.018, 1, 0), (160, .02, .92, 0),
    (178, -.015, 1, .012), (191, -.015, 1, 0),
    (193, -.015, 1, 0), (207, .09, .83, 0),
    (228, .07, .9, 0), (239, -.015, 1, 0),
    (241, -.015, 1, 0), (255, -.08, .72, .014),
    (273, -.06, .82, -.012), (287, -.015, 1, 0),
]:
    face_key(frame, brow, eye, gaze)

SCENE.frame_set(1)
previous_scene = bpy.context.window.scene
previous_selected = list(bpy.context.selected_objects)
previous_active = bpy.context.view_layer.objects.active
previous_save_versions = bpy.context.preferences.filepaths.save_version
try:
    bpy.context.window.scene = SCENE
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=PROJECT + '/Assets/CharacterPrototype/Drok_Web_Avatar.blend', copy=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in (ROOT, *ROOT.children_recursive):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = ROOT
    options = dict(export_format='GLB', use_selection=True, use_active_scene=True,
                   export_animations=True, export_animation_mode='SCENE',
                   export_anim_scene_split_object=False, export_frame_range=True,
                   export_force_sampling=True)
    for path in (PROJECT + '/Builds/models/Drok_Web_Avatar.glb',
                 PROJECT + '/Assets/WebGLTemplates/AIGuideTemplate/models/Drok_Web_Avatar.glb'):
        bpy.ops.export_scene.gltf(filepath=path, **options)
        print('Exported', path)
finally:
    bpy.context.preferences.filepaths.save_version = previous_save_versions
    bpy.ops.object.select_all(action='DESELECT')
    for obj in previous_selected:
        if obj.name in bpy.data.objects:
            obj.select_set(True)
    if previous_active and previous_active.name in bpy.data.objects:
        bpy.context.view_layer.objects.active = previous_active
    SCENE.frame_set(1)
    bpy.context.window.scene = previous_scene
