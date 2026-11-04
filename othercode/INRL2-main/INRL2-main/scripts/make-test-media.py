"""Generates the step-1 test video and music (no copyrighted material).

The video shows a running clock and the frame number, so on the phone you can
see at a glance whether it is playing smoothly, stuttering or frozen. Its sound
is a short beep each second, distinct from the background music, so you can
tell which audio is playing.

  python scripts/make-test-media.py   (needs: pillow numpy imageio-ffmpeg)
"""
import math, subprocess, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = "public/test"
W, H, FPS, SECS = 540, 960, 30, 12
SR = 44100

def font(size):
    for f in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()

big, mid = font(150), font(56)

def frame(i):
    t = i / FPS
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    # moving teal gradient (#063137 -> #12A2B8)
    for y in range(0, H, 8):
        k = 0.5 + 0.5 * math.sin(y / 180 + t * 2)
        c = tuple(int(a + (b - a) * k) for a, b in zip((6, 49, 55), (18, 162, 184)))
        d.rectangle([0, y, W, y + 8], fill=c)
    # orbiting dots
    for n in range(6):
        a = t * 1.5 + n * math.pi / 3
        x, y = W / 2 + math.cos(a) * 180, H / 2 + math.sin(a) * 180
        col = [(240, 221, 43), (255, 255, 255), (220, 25, 26)][n % 3]
        d.ellipse([x - 26, y - 26, x + 26, y + 26], fill=col)
    d.text((W / 2, H / 2), "InRL", font=big, fill="white", anchor="mm")
    d.text((W / 2, 130), f"{t:05.2f}s", font=mid, fill="white", anchor="mm")
    d.text((W / 2, H - 130), f"frame {i:03d}", font=mid, fill=(240, 221, 43), anchor="mm")
    return img.tobytes()

def write_wav(path, samples):
    s = np.clip(samples, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((s * 32767).astype(np.int16).tobytes())

# Video sound: 0.12 s beep on every second, higher pitch on 0 s.
t = np.arange(SECS * SR) / SR
beeps = np.zeros_like(t)
for s in range(SECS):
    m = (t >= s) & (t < s + 0.12)
    beeps[m] = 0.5 * np.sin(2 * np.pi * (1320 if s == 0 else 880) * t[m]) * np.hanning(m.sum())
write_wav(f"{OUT}/_beeps.wav", beeps)

# Music: gentle 16 s loop of four chords, so it is obviously "the music".
chords = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]]
mt = np.arange(16 * SR) / SR
music = np.zeros_like(mt)
for ci, ch in enumerate(chords):
    m = (mt >= ci * 4) & (mt < ci * 4 + 4)
    lt = mt[m] - ci * 4
    env = np.minimum(1, lt * 4) * np.exp(-lt * 0.35)
    for f in ch:
        music[m] += 0.12 * env * (np.sin(2 * np.pi * f * lt) + 0.3 * np.sin(4 * np.pi * f * lt))
write_wav(f"{OUT}/_music.wav", music)

# H.264 Main + AAC, yuv420p and faststart: the combination iPhones play inline.
p = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                      "-i", f"{OUT}/_beeps.wav", "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-crf", "26",
                      "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", f"{OUT}/video.mp4"], stdin=subprocess.PIPE)
for i in range(SECS * FPS):
    p.stdin.write(frame(i))
p.stdin.close(); p.wait()
subprocess.run([FF, "-y", "-loglevel", "error", "-i", f"{OUT}/_music.wav", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", f"{OUT}/music.m4a"], check=True)

# A "photo from the phone" to test images inside 3D objects.
ph = Image.new("RGB", (800, 1000), (226, 212, 202))
pd = ImageDraw.Draw(ph)
for k in range(14):
    pd.ellipse([60 + k * 30, 120 + (k % 4) * 90, 420 + k * 22, 520 + (k % 5) * 80], outline=(6, 49, 55), width=10)
pd.rectangle([0, 760, 800, 1000], fill=(18, 162, 184))
pd.text((400, 880), "Test photo", font=mid, fill="white", anchor="mm")
ph.save(f"{OUT}/photo.jpg", quality=85)

import os
for f in ["_beeps.wav", "_music.wav"]: os.remove(f"{OUT}/{f}")
print("done")
