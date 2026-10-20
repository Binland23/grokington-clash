"""Turn raw Grok renders into game-ready sprites.

For every raw image in "CLASH - assets/raw":
  * sprites (units, buildings, towers, icons, chests): remove the flat background
    (auto-detected from the border, white or chroma green), soften and de-fringe the
    edge, trim, resize, and save as WebP with alpha.
  * team-coloured sprites also get a "<name>_red.webp" variant (blue hues -> red).
  * portraits and backgrounds are just resized.

Usage: python tools/cutout.py [name ...]
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.normpath(os.path.join(HERE, '..', '..', 'CLASH - assets', 'raw'))
OUT = os.path.normpath(os.path.join(HERE, '..', 'public', 'assets', 'sprites'))
os.makedirs(OUT, exist_ok=True)

# name prefix -> (max output dimension, make red variant)
RULES = {
    'unit_': (320, True),
    'bld_': (360, True),
    'tower_': (420, True),
    'spell_': (256, False),
    'ui_': (192, False),
    'chest_': (300, False),
}
PORTRAIT_SIZE = 320
BG_SIZE = (720, 1280)
WORK = 640  # processing resolution (longest side)


def border_color(a: np.ndarray) -> np.ndarray:
    b = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    return np.median(b, axis=0)


def flood_from_border(cand: np.ndarray) -> np.ndarray:
    """Pixels of `cand` connected to the image border (4-neighbour), via iterative dilation."""
    reach = np.zeros_like(cand)
    reach[0, :] = cand[0, :]
    reach[-1, :] = cand[-1, :]
    reach[:, 0] = cand[:, 0]
    reach[:, -1] = cand[:, -1]
    while True:
        grow = reach.copy()
        grow[1:, :] |= reach[:-1, :]
        grow[:-1, :] |= reach[1:, :]
        grow[:, 1:] |= reach[:, :-1]
        grow[:, :-1] |= reach[:, 1:]
        grow &= cand
        if (grow == reach).all():
            return reach
        reach = grow


def interior_holes(cand: np.ndarray, min_area: int) -> np.ndarray:
    """Enclosed background-coloured blobs big enough to be gaps (between arm and body etc)."""
    h, w = cand.shape
    seen = np.zeros_like(cand)
    out = np.zeros_like(cand)
    ys, xs = np.nonzero(cand)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        comp = []
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if len(comp) >= min_area:
            for y, x in comp:
                out[y, x] = True
    return out


def blur3(m: np.ndarray) -> np.ndarray:
    p = np.pad(m, 1, mode='edge')
    acc = np.zeros_like(m, dtype=np.float32)
    for dy in range(3):
        for dx in range(3):
            acc += p[dy:dy + m.shape[0], dx:dx + m.shape[1]]
    return acc / 9.0


def cutout(img: Image.Image) -> Image.Image:
    img = img.convert('RGB')
    scale = WORK / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32)
    bg = border_color(a)
    green = bg[1] > 120 and bg[0] < 100 and bg[2] < 100
    d = np.sqrt(((a - bg) ** 2).sum(axis=2))
    hard = 60.0 if green else 26.0
    soft = 110.0 if green else 60.0
    bgmask = flood_from_border(d < hard)
    holes = interior_holes((d < hard * 0.55) & ~bgmask, min_area=max(60, int(a.shape[0] * a.shape[1] * 0.0006)))
    bgmask |= holes
    # Alpha: 0 inside background, ramp by colour distance near the edge.
    alpha = np.clip((d - hard * 0.5) / (soft - hard * 0.5), 0, 1)
    alpha[bgmask] = 0
    near = blur3(bgmask.astype(np.float32)) > 0
    alpha = np.where(near & ~bgmask, np.minimum(alpha, 1.0), np.where(bgmask, 0, 1.0))
    alpha = np.minimum(alpha, 1.0)
    # Light feather on the silhouette.
    alpha = np.minimum(alpha, np.clip(blur3(alpha) * 1.25, 0, 1))
    # De-fringe: un-mix the background colour from semi-transparent pixels.
    a3 = alpha[..., None]
    rgb = np.where(a3 > 0.02, (a - (1 - a3) * bg) / np.maximum(a3, 0.02), a)
    if green:
        # Kill green spill: green may not exceed the brighter of red/blue by much.
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        cap = np.maximum(r, b) * 1.05 + 8
        rgb[..., 1] = np.minimum(g, cap)
    rgb = np.clip(rgb, 0, 255)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    bbox = im.getchannel('A').point(lambda v: 255 if v > 12 else 0).getbbox()
    if bbox:
        pad = 4
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad))
        im = im.crop(bbox)
    return im


def recolor_red(im: Image.Image) -> Image.Image:
    """Swap the royal-blue team colour to crimson, leaving other hues alone."""
    rgba = np.asarray(im).astype(np.float32) / 255.0
    rgb = rgba[..., :3]
    hsv = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8), 'RGB').convert('HSV')).astype(np.float32)
    h = hsv[..., 0] * (360.0 / 255.0)
    s = hsv[..., 1] / 255.0
    v = hsv[..., 2] / 255.0
    center, width = 222.0, 34.0
    dist = np.abs(h - center)
    w = np.clip(1 - (dist - width) / 14.0, 0, 1) * np.clip((s - 0.18) / 0.15, 0, 1)
    target = 2.0
    delta = ((target - h + 540.0) % 360.0) - 180.0
    nh = (h + delta * w) % 360.0
    nv = np.clip(v * (1 - 0.06 * w), 0, 1)
    ns = np.clip(s * (1 + 0.06 * w), 0, 1)
    hsv2 = np.dstack([nh * 255.0 / 360.0, ns * 255.0, nv * 255.0]).astype(np.uint8)
    rgb2 = np.asarray(Image.fromarray(hsv2, 'HSV').convert('RGB'))
    out = np.dstack([rgb2, (rgba[..., 3] * 255).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')


def fit(im: Image.Image, max_dim: int) -> Image.Image:
    s = max_dim / max(im.size)
    if s < 1:
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    return im


def main(names):
    manifest_path = os.path.join(OUT, 'manifest.json')
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    files = sorted(f for f in os.listdir(RAW) if f.endswith('.png') and not f.startswith('test_'))
    for f in files:
        name = f[:-4]
        if names and name not in names:
            continue
        src = Image.open(os.path.join(RAW, f))
        if name.startswith('portrait_'):
            im = src.convert('RGB').resize((PORTRAIT_SIZE, PORTRAIT_SIZE), Image.LANCZOS)
            im.save(os.path.join(OUT, name + '.webp'), quality=88)
            manifest[name] = {'w': im.width, 'h': im.height}
        elif name.startswith('bg_'):
            im = src.convert('RGB').resize(BG_SIZE, Image.LANCZOS)
            im.save(os.path.join(OUT, name + '.webp'), quality=86)
            manifest[name] = {'w': im.width, 'h': im.height}
        else:
            rule = next((r for p, r in RULES.items() if name.startswith(p)), (256, False))
            im = fit(cutout(src), rule[0])
            im.save(os.path.join(OUT, name + '.webp'), quality=90, method=6)
            entry = {'w': im.width, 'h': im.height}
            if rule[1]:
                recolor_red(im).save(os.path.join(OUT, name + '_red.webp'), quality=90, method=6)
                entry['red'] = True
            manifest[name] = entry
        print('ok', name, manifest[name])
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=1, sort_keys=True)


if __name__ == '__main__':
    main(set(sys.argv[1:]))
