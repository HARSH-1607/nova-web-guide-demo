# Drok Web Avatar

Original character and animation source: the user's Drok character from their Codex chat “Create an animated 3D logo character.” The editable Blender copy is at `Assets/CharacterPrototype/Drok_Web_Avatar.blend` in the Unity project. `Drok_Web_Avatar.glb` was exported from that Blender scene for the Three.js website.

The GLB contains one 24 fps timeline. `drok-avatar.js` splits it into six looping states: idle, listening, thinking, talking, happy, and mischievous. It maps the site's existing gestures to those states and adds light procedural motion for wave, nod, shake, dance, jump, pointing, and cursor-following. Its open-mouth control follows approximate vowel cues; this is not audio-driven phoneme recognition.
