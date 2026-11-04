# Fake camera feed for the automated AR test: the test marker lying on a
# table, seen from the front at about 45 degrees, drifting left and right.
#   python scripts/make-fake-camera.py public/test/marker.png .cache/fakecam.y4m
import math, subprocess, sys
import numpy as np
from PIL import Image
import imageio_ffmpeg
marker = Image.open(sys.argv[1]).convert("RGBA")
W, H, FPS, SECS = 640, 480, 30, 8

def coeffs(src, dst):
    # solve for PIL perspective coefficients mapping dst -> src
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
        b += [u, v]
    return np.linalg.solve(np.array(A, float), np.array(b, float)).tolist()

p = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-pix_fmt", "yuv420p", sys.argv[2]], stdin=subprocess.PIPE)
S = marker.width
for i in range(SECS * FPS):
    t = i / FPS
    dx = 25 * math.sin(t * 0.8)
    # trapezoid: far (top) edge narrower than near (bottom) edge
    dst = [(220 + dx, 210), (420 + dx, 210), (500 + dx, 400), (140 + dx, 400)]
    src = [(0, 0), (S, 0), (S, S), (0, S)]
    warped = marker.transform((W, H), Image.PERSPECTIVE, coeffs(src, dst), Image.BICUBIC)
    f = Image.new("RGB", (W, H), (150, 120, 92))
    f.paste(warped, (0, 0), warped)
    p.stdin.write(np.asarray(f).tobytes())
p.stdin.close(); p.wait()
