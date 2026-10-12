"""Ray-marched $QUIVER token image: three gooey arrows fanned from one base.

Usage: python3 render_goo.py out.png [size]
"""
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "quiver-400.png"
FINAL = int(sys.argv[2]) if len(sys.argv) > 2 else 400
SS = 2
N = FINAL * SS


def norm(v):
    return v / np.linalg.norm(v)


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


# scene is built upright, then turned a little so it reads as 3D
R = rot_y(np.radians(-18)) @ rot_x(np.radians(10))

BASE = np.array([0.0, -1.1, 0.0])
TIPS = [np.array([0.0, 1.15, 0.0]),
        np.array([-1.05, 0.50, 0.25]),
        np.array([1.05, 0.50, -0.25])]
BASE = R @ BASE
TIPS = [R @ t for t in TIPS]
HEAD_LEN = 0.55


def sd_capsule(p, a, b, r):
    pa = p - a
    ba = b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
    return np.linalg.norm(pa - h[:, None] * ba, axis=1) - r


def sd_round_cone(p, a, b, r1, r2):
    # iq's round cone
    ba = b - a
    l2 = ba @ ba
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = p - a
    y = pa @ ba
    z = y - l2
    xv = pa * l2 - y[:, None] * ba
    x2 = np.sum(xv * xv, axis=1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    out = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
    m1 = np.sign(z) * a2 * z2 > k
    m2 = np.sign(y) * a2 * y2 < k
    out = np.where(m1, np.sqrt(x2 + z2) * il2 - r2, out)
    out = np.where(m2 & ~m1, np.sqrt(x2 + y2) * il2 - r1, out)
    return out


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def scene(p):
    d = np.linalg.norm(p - BASE, axis=1) - 0.30
    for t in TIPS:
        dirv = norm(t - BASE)
        neck = t - dirv * HEAD_LEN
        shaft = sd_capsule(p, BASE, neck, 0.085)
        # flatten the head into a blade facing the camera
        z = np.array([0, 0, 1.0])
        fa = norm(z - (z @ dirv) * dirv)
        q = p - neck
        q = q + (q @ fa)[:, None] * fa * 1.6
        head = sd_round_cone(q + neck, neck, t, 0.20, 0.010) / 2.6
        d = smin(d, smin(shaft, head, 0.06), 0.16)
    return d


def normal(p):
    e = 1e-3
    ex = np.array([e, 0, 0]); ey = np.array([0, e, 0]); ez = np.array([0, 0, e])
    n = np.stack([scene(p + ex) - scene(p - ex),
                  scene(p + ey) - scene(p - ey),
                  scene(p + ez) - scene(p - ez)], axis=1)
    return n / np.linalg.norm(n, axis=1, keepdims=True)


# camera
cam = np.array([0.0, 0.0, 5.2])
xs = (np.arange(N) + 0.5) / N * 2 - 1
u, v = np.meshgrid(xs, -xs)
fov = 0.33
rd = np.stack([u.ravel() * fov, v.ravel() * fov, -np.ones(N * N)], axis=1)
rd /= np.linalg.norm(rd, axis=1, keepdims=True)
ro = np.broadcast_to(cam, rd.shape).copy()

t = np.zeros(N * N)
hit = np.zeros(N * N, bool)
alive = np.ones(N * N, bool)
for _ in range(140):
    idx = np.nonzero(alive)[0]
    if idx.size == 0:
        break
    p = ro[idx] + rd[idx] * t[idx, None]
    d = scene(p)
    t[idx] += d
    h = d < 1e-3
    hit[idx[h]] = True
    alive[idx[h | (t[idx] > 9)]] = False

img = np.zeros((N * N, 3))
idx = np.nonzero(hit)[0]
p = ro[idx] + rd[idx] * t[idx, None]
n = normal(p)
vdir = -rd[idx]

# ambient occlusion
ao = np.ones(idx.size)
for i in range(1, 6):
    hh = 0.06 * i
    ao -= (hh - scene(p + n * hh)) * (0.9 / i)
ao = np.clip(ao, 0, 1)

key = norm(np.array([-0.6, 0.8, 0.6]))
fill = norm(np.array([0.7, -0.2, 0.5]))
diff = np.clip(n @ key, 0, 1)
fil = np.clip(n @ fill, 0, 1)
half = norm(key + np.array([0, 0, 1.0]))
spec = np.clip(n @ half, 0, 1) ** 40
fres = (1 - np.clip(np.sum(n * vdir, axis=1), 0, 1)) ** 3

grey = np.array([0.50, 0.50, 0.52])
col = grey[None, :] * (0.10 + 0.85 * diff[:, None] + 0.18 * fil[:, None]) * ao[:, None]
col += 0.25 * spec[:, None]
col *= (1 - 0.55 * fres[:, None])  # darken silhouettes like the GOO render

# glowing cores: in each arrowhead and in the base, plus a faint vein along shafts
glow_col = np.array([0.82, 1.0, 0.08])
glow = np.zeros(idx.size)
cores = [BASE + R @ np.array([0, 0, 0.22])] + [tp - norm(tp - BASE) * (HEAD_LEN * 0.62) + R @ np.array([0, 0, 0.05]) for tp in TIPS]
for c in cores:
    dd = np.linalg.norm(p - c, axis=1)
    glow += 2.2 * np.exp(-(dd / 0.085) ** 2) + 0.18 * np.exp(-(dd / 0.22) ** 2)
for tp in TIPS:
    dd = sd_capsule(p, BASE, tp - norm(tp - BASE) * HEAD_LEN, 0.0)
    glow += 0.6 * np.exp(-(dd / 0.045) ** 2)
# glow is strongest where it faces the camera (reads as light under the skin)
facing = np.clip(np.sum(n * vdir, axis=1), 0, 1) ** 1.5
glow *= 0.35 + 0.65 * facing
col = col * (1 - np.clip(glow, 0, 1)[:, None] * 0.6) + glow_col[None, :] * glow[:, None]

img[idx] = col
img = np.clip(img, 0, 1) ** (1 / 1.9)
img = (img.reshape(N, N, 3) * 255).astype(np.uint8)
Image.fromarray(img).resize((FINAL, FINAL), Image.LANCZOS).save(OUT)
print("saved", OUT)
