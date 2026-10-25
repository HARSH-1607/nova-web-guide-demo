"""Extend the open Drok Blender scene with web-guide gesture loops and export it.

Run in Blender's Python console after opening Drok_Web_Avatar.blend:
    exec(compile(open('K:/Projects/Unity/Test/Builds/models/build_drok_animations.py', encoding='utf-8').read(), 'build_drok_animations.py', 'exec'))
"""

import bpy

PROJECT = r"K:\Projects\Unity\Test"
SCENE = bpy.data.scenes["Drok | web avatar"]
ROOT = bpy.data.objects["DROK_ROOT | animation rig"]
LEFT = bpy.data.objects["Drok L arm control"]
RIGHT = bpy.data.objects["Drok R arm control"]
LEFT_BROW = bpy.data.objects["Drok L eyebrow pose"]
RIGHT_BROW = bpy.data.objects["Drok R eyebrow pose"]
LEFT_EYE = bpy.data.objects["Drok L eye blink"]
RIGHT_EYE = bpy.data.objects["Drok R eye blink"]
SMILE = bpy.data.objects["Drok smile control"]
SMIRK = bpy.data.objects["Drok smirk control"]
TALK = bpy.data.objects["Drok talk mouth control"]

# Each 48-frame (2-second) segment begins and ends at a neutral pose, making
# crossfades clean. The intermediate keys use Blender's Bezier interpolation.
STATES = {
    "wave": [
        (0, {}), (7, {"right": -1.1, "yaw": .08, "z": .02}),
        (13, {"right": -1.48, "yaw": .12, "z": .05}),
        (19, {"right": -.82, "yaw": -.02, "z": .02}),
        (26, {"right": -1.52, "yaw": .1, "z": .05}),
        (33, {"right": -.78, "yaw": -.025, "z": .02}),
        (40, {"right": -1.18, "yaw": .06, "z": .03}), (47, {}),
    ],
    "point": [
        (0, {}), (8, {"right": -.32, "left": .1, "yaw": .06}),
        (16, {"right": -.52, "left": .18, "yaw": .13, "pitch": -.03}),
        (24, {"right": -.46, "left": .18, "yaw": .13, "pitch": -.03}),
        (32, {"right": -.48, "left": .14, "yaw": .12}),
        (40, {"right": -.27, "yaw": .05}), (47, {}),
    ],
    "dance": [
        (0, {}), (8, {"left": .85, "right": -.42, "yaw": .24, "z": .12}),
        (16, {"left": .28, "right": -.92, "yaw": -.26, "z": .025}),
        (24, {"left": .95, "right": -.3, "yaw": .27, "z": .14}),
        (32, {"left": .3, "right": -.95, "yaw": -.27, "z": .025}),
        (40, {"left": .68, "right": -.58, "yaw": .14, "z": .1}), (47, {}),
    ],
    "joy": [
        (0, {}), (8, {"left": .5, "right": -.5, "z": .14}),
        (16, {"left": .85, "right": -.85, "z": .31}),
        (24, {"left": .78, "right": -.78, "z": .24}),
        (32, {"left": .4, "right": -.4, "z": .06}),
        (40, {"left": .48, "right": -.48, "z": .09}), (47, {}),
    ],
    "nod": [
        (0, {}), (8, {"pitch": -.1}), (16, {"pitch": .12}),
        (24, {"pitch": -.1}), (32, {"pitch": .12}),
        (40, {"pitch": -.06}), (47, {}),
    ],
    "shake": [
        (0, {}), (8, {"yaw": -.18, "smirk": .45}),
        (16, {"yaw": .18, "smirk": .45}),
        (24, {"yaw": -.18, "smirk": .45}),
        (32, {"yaw": .17, "smirk": .45}),
        (40, {"yaw": -.1, "smirk": .3}), (47, {}),
    ],
    "fistBump": [
        (0, {}), (8, {"right": -.58, "forward": -.03, "smirk": .4}),
        (16, {"right": -1.2, "forward": -.08, "pitch": .05, "smirk": .8}),
        (24, {"right": -1.4, "forward": -.12, "pitch": .07, "smirk": 1}),
        (32, {"right": -.7, "forward": -.05, "smirk": .6}),
        (40, {"right": -.25, "smirk": .3}), (47, {}),
    ],
    "jump": [
        (0, {}), (8, {"left": .38, "right": -.38, "z": .12}),
        (16, {"left": .75, "right": -.75, "z": .32}),
        (24, {"left": .72, "right": -.72, "z": .38}),
        (32, {"left": .45, "right": -.45, "z": .2}),
        (40, {"left": .25, "right": -.25, "z": .06}), (47, {}),
    ],
}


def key_pose(frame, values):
    SCENE.frame_set(frame)
    ROOT.location = (0, values.get("forward", 0), values.get("z", 0))
    ROOT.rotation_euler = (values.get("pitch", 0), 0, values.get("yaw", 0))
    LEFT.rotation_euler = (0, values.get("left", 0), 0)
    RIGHT.rotation_euler = (0, values.get("right", 0), 0)
    LEFT_BROW.rotation_euler = (0, values.get("brow_left", 0), 0)
    RIGHT_BROW.rotation_euler = (0, values.get("brow_right", 0), 0)
    LEFT_EYE.scale = (1, 1, values.get("blink_left", 1))
    RIGHT_EYE.scale = (1, 1, values.get("blink_right", 1))
    smirk = values.get("smirk", 0)
    SMILE.scale = (1 - smirk,) * 3
    SMIRK.scale = (smirk,) * 3
    TALK.scale = (0, 0, 0)
    for obj, prop in (
        (ROOT, "location"), (ROOT, "rotation_euler"),
        (LEFT, "rotation_euler"), (RIGHT, "rotation_euler"),
        (LEFT_BROW, "rotation_euler"), (RIGHT_BROW, "rotation_euler"),
        (LEFT_EYE, "scale"), (RIGHT_EYE, "scale"),
        (SMILE, "scale"), (SMIRK, "scale"), (TALK, "scale"),
    ):
        obj.keyframe_insert(data_path=prop, frame=frame)


previous_scene = bpy.context.window.scene
previous_frame = SCENE.frame_current
previous_selected = list(bpy.context.selected_objects)
previous_active = bpy.context.view_layer.objects.active
try:
    bpy.context.window.scene = SCENE
    for state_index, (name, poses) in enumerate(STATES.items()):
        start = 289 + state_index * 48
        for offset, values in poses:
            key_pose(start + offset, values)
        print(f"Drok {name}: frames {start}-{start + 47}")
    SCENE.frame_end = 288 + len(STATES) * 48
    SCENE.frame_set(1)
    bpy.ops.wm.save_as_mainfile(
        filepath=PROJECT + r"\Assets\CharacterPrototype\Drok_Web_Avatar.blend",
        copy=True,
    )
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [ROOT, *ROOT.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = ROOT
    export_options = dict(
        export_format="GLB", use_selection=True, use_active_scene=True,
        export_animations=True, export_animation_mode="SCENE",
        export_anim_scene_split_object=False, export_frame_range=True,
        export_force_sampling=True,
    )
    for path in (
        PROJECT + r"\Builds\models\Drok_Web_Avatar.glb",
        PROJECT + r"\Assets\WebGLTemplates\AIGuideTemplate\models\Drok_Web_Avatar.glb",
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
    SCENE.frame_set(previous_frame)
    bpy.context.window.scene = previous_scene
