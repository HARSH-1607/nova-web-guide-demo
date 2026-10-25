# Drok Web Avatar

Original character and animation source: the user's Drok character from their Codex chat “Create an animated 3D logo character.” The editable Blender copy is at `Assets/CharacterPrototype/Drok_Web_Avatar.blend` in the Unity project. `Drok_Web_Avatar.glb` was exported from that Blender scene for the Three.js website.

The GLB contains one 24 fps timeline. `drok-avatar.js` splits it into 14 states: idle, listening, thinking, talking, happy, mischievous, wave, point, dance, joy, nod, shake, fist bump, and jump. The eight new moves have their own Blender keyframes, with light procedural motion retained for cursor-following and walking. Its open-mouth control follows approximate vowel cues; this is not audio-driven phoneme recognition. `build_drok_animations.py` records how those eight moves were authored and exported.

Run `refine_drok.py` after `build_drok_animations.py` to add layered irises, eye reflections, eyelids, subtle facial features, asynchronous blinks, expression keys, and an emissive titanium rim. The website adds a soft transparent halo so Drok remains visible against light and dark host sites. Speech uses smoothed vowel mouth shapes; actual acoustic lip synchronization would require phoneme or viseme timing from the voice provider.
