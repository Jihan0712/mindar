# Step 1: AR test

## What it proves

That an iPhone browser can show a 3D scene, including a playing video and
music, held steady on a printed marker. Its results set the limits the
InStudio editor has to respect (how many videos per scene, file sizes, whether
6 objects is right for older phones).

## How to run it

1. Open the test link on the iPhone, in Safari.
2. **Marker**: print it at 100% scale (about 15 cm across, matte paper), or show it full screen on another device.
3. **Open** the AR test, allow the camera, point at the marker from about 30 cm.
4. **IN3D** shows the same scene without the camera.

## What to report

- Time until the scene appears (also shown under ☰ → Test details).
- Does it stay stuck to the marker, or wobble or drift? Near, far, at an angle?
- Does the video play smoothly (its clock counts up without jumps)?
- Do you hear the music and the video's beeps? Does the sound button work?
- Flat vs upright: marker on a table → scene stands on it; marker on a screen,
  wall or T-shirt → scene stands upright, centred in front of the print
  (decided 2026-10-05, option B). iPhone asks for "motion and orientation"
  access to tell the two apart; allow it.
- After a few minutes: phone hot? battery?
- ☰ → **Copy report**, and paste it to Claude.

## Already checked automatically

`npm run test:ar` runs the AR page in headless Chrome with a fake camera
showing the marker in perspective. It checks that the camera starts, the
marker is recognised, the scene appears on it (screenshot in
`.cache/ar-smoke.png`), tracking is lost and regained, and the video and music
start only once the marker is found, and that the scene switches between
standing on the marker and standing upright in front of it when the phone's
orientation says the marker is flat or vertical. What it cannot check is iPhone Safari
itself, its camera, and how tracking feels in a hand: that is the phone test.
