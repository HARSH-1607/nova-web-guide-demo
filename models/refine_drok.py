"""Refine Drok's face and motion in the open Blender scene, then export it.

Run after build_drok_animations.py from Blender's Python console:
    exec(compile(open('K:/Projects/Unity/Test/Builds/models/refine_drok.py', encoding='utf-8').read(), 'refine_drok.py', 'exec'))
"""

import bpy

PROJECT = "K:/Projects/Unity/Test"
SCENE = bpy.data.scenes["Drok | web avatar"]
ROOT = bpy.data.objects["DROK_ROOT | animation rig"]


def material(name, color, metallic=0.0, roughness=0.3, glow=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if glow:
        shader.inputs["Emission Color"].default_value = (*glow[0], 1)
        shader.inputs["Emission Strength"].default_value = glow[1]
    return mat


iris_mat = material("Drok refined | teal iris", (.018, .18, .21), .27, .23,
                    ((.015, .24, .28), .22))
glint_mat = material("Drok refined | eye glint", (.88, .98, 1), .0, .1)
cheek_mat = material("Drok refined | cheek", (.04, .09, .12), .12, .43)
nose_mat = material("Drok refined | nose", (.035, .065, .09), .24, .34)
lid_mat = bpy.data.materials["Drok PBR | blue graphite"]

# Give the metal a luminous edge while keeping the dark face readable.
rim = bpy.data.materials["Drok PBR | dark titanium"]
rim_shader = next(node for node in rim.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
rim_shader.inputs["Metallic"].default_value = .62
rim_shader.inputs["Roughness"].default_value = .19
rim_shader.inputs["Emission Color"].default_value = (.045, .39, .46, 1)
rim_shader.inputs["Emission Strength"].default_value = .28
face = bpy.data.materials["Drok PBR | deep face"]
face_shader = next(node for node in face.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
face_shader.inputs["Roughness"].default_value = .37
face_shader.inputs["Coat Weight"].default_value = .22
face_shader.inputs["Coat Roughness"].default_value = .2


def ellipsoid(name, parent, position, scale, mat, segments=20, rings=12):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = position
    obj.scale = scale
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def lid_curve(name, parent):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 20
    curve.bevel_depth = .006
    curve.bevel_resolution = 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(4)
    for point, x, z in zip(spline.bezier_points,
                           [-.135, -.078, 0, .078, .135],
                           [.07, .145, .165, .145, .07]):
        point.co = (x, -.084, z)
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    SCENE.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(lid_mat)
    return obj


for side, label in [(-1, "L"), (1, "R")]:
    gaze = bpy.data.objects[f"Drok {label} gaze"]
    blink = bpy.data.objects[f"Drok {label} eye blink"]
    pupil = bpy.data.objects[f"Drok {label} pupil"]
    iris = ellipsoid(f"Drok refined {label} iris", gaze,
                     (pupil.location.x, .006, -.012), (.078, .015, .099), iris_mat)
    # Two small reflections move with the pupils, adding depth to the gaze.
    ellipsoid(f"Drok refined {label} glint", gaze,
              (pupil.location.x - .023, -.033, .025), (.018, .006, .019), glint_mat, 12, 8)
    ellipsoid(f"Drok refined {label} glint small", gaze,
              (pupil.location.x + .025, -.031, -.045), (.009, .004, .009), glint_mat, 10, 6)
    lid_curve(f"Drok refined {label} upper lid", blink)
    ellipsoid(f"Drok refined {label} cheek", ROOT,
              (side * .365, -.397, 1.585), (.047, .008, .019), cheek_mat, 16, 10)
    ellipsoid(f"Drok refined {label} dimple", ROOT,
              (side * .246, -.429, 1.448), (.009, .004, .008), nose_mat, 12, 8)

ellipsoid("Drok refined nose", ROOT, (0, -.422, 1.635),
          (.023, .015, .018), nose_mat, 16, 10)


def key_face(frame, blink=1.0, look=0.0, brow=0.0, smile=None, smirk=None):
    SCENE.frame_set(frame)
    for side, label in [(-1, "L"), (1, "R")]:
        eye = bpy.data.objects[f"Drok {label} eye blink"]
        eye.scale.z = blink
        eye.keyframe_insert(data_path="scale", frame=frame)
        gaze = bpy.data.objects[f"Drok {label} gaze"]
        gaze.location.x = look
        gaze.keyframe_insert(data_path="location", frame=frame)
        eyebrow = bpy.data.objects[f"Drok {label} eyebrow pose"]
        eyebrow.rotation_euler.y = side * brow
        eyebrow.keyframe_insert(data_path="rotation_euler", frame=frame)
    if smile is not None:
        control = bpy.data.objects["Drok smile control"]
        control.scale = (smile,) * 3
        control.keyframe_insert(data_path="scale", frame=frame)
    if smirk is not None:
        control = bpy.data.objects["Drok smirk control"]
        control.scale = (smirk,) * 3
        control.keyframe_insert(data_path="scale", frame=frame)


# Fast, asynchronous blinks and eye darts make the idle pose less mechanical.
for frame, blink, look, brow in [
    (1, 1, 0, 0), (11, 1, 0, .015), (12, .12, 0, .015),
    (14, 1, 0, .015), (26, 1, .015, 0), (36, 1, -.01, 0),
    (43, 1, 0, 0), (48, 1, 0, 0),
]:
    key_face(frame, blink, look, brow)

# Each authored move now has a little facial anticipation, a blink and recovery.
for start, mood in [
    (289, "wave"), (337, "point"), (385, "dance"), (433, "joy"),
    (481, "nod"), (529, "shake"), (577, "fistBump"), (625, "jump"),
]:
    key_face(start, 1, 0, 0, 1, 0)
    key_face(start + 7, 1, .008 if mood in ("point", "wave") else 0,
             .045 if mood in ("joy", "wave", "jump") else -.025)
    key_face(start + 17, .2 if mood in ("joy", "jump", "fistBump") else 1,
             .016 if mood == "point" else 0,
             .055 if mood in ("joy", "dance", "wave") else -.035,
             .55 if mood in ("shake", "fistBump") else 1,
             .45 if mood in ("shake", "fistBump") else 0)
    key_face(start + 20, 1, .016 if mood == "point" else 0,
             .04 if mood in ("joy", "dance", "wave") else 0)
    key_face(start + 31, 1, -.012 if mood == "dance" else 0, 0)
    key_face(start + 42, 1, 0, 0, 1, 0)
    key_face(start + 47, 1, 0, 0, 1, 0)

# Small eye movements during thought and speech keep their faces alive.
for frame, blink, look, brow in [
    (97, 1, 0, 0), (112, 1, -.016, -.03), (117, .18, -.016, -.03),
    (119, 1, -.016, -.03), (136, 1, .014, .025), (144, 1, 0, 0),
    (153, 1, 0, .025), (161, .18, 0, .025), (163, 1, 0, .025),
    (184, 1, .012, 0), (192, 1, 0, 0),
]:
    key_face(frame, blink, look, brow)

SCENE.frame_set(1)
bpy.ops.wm.save_as_mainfile(
    filepath=PROJECT + "/Assets/CharacterPrototype/Drok_Web_Avatar.blend", copy=True)

previous_selected = list(bpy.context.selected_objects)
previous_active = bpy.context.view_layer.objects.active
try:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (ROOT, *ROOT.children_recursive):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = ROOT
    export_options = dict(
        export_format="GLB", use_selection=True, use_active_scene=True,
        export_animations=True, export_animation_mode="SCENE",
        export_anim_scene_split_object=False, export_frame_range=True,
        export_force_sampling=True,
    )
    for path in (
        PROJECT + "/Builds/models/Drok_Web_Avatar.glb",
        PROJECT + "/Assets/WebGLTemplates/AIGuideTemplate/models/Drok_Web_Avatar.glb",
    ):
        bpy.ops.export_scene.gltf(filepath=path, **export_options)
        print("Exported", path)
finally:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in previous_selected:
        if obj.name in bpy.data.objects:
            obj.select_set(True)
    if previous_active and previous_active.name in bpy.data.objects:
        bpy.context.view_layer.objects.active = previous_active
    SCENE.frame_set(1)
