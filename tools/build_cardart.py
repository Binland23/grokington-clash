"""Install the Grok card illustrations (tools/card-art-manifest.json) as card art sprites.

python tools/build_cardart.py [card_id ...]
Reads "CLASH - assets/cardart/<id>.png", crops to the card's 5:6 window (biased toward the
top, where faces are), and writes public/assets/sprites/cardart_<id>.webp + manifest entries.
"""
import json
import os
import sys

from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.normpath(os.path.join(HERE, '..'))
SRC = os.path.normpath(os.path.join(GAME, '..', 'CLASH - assets', 'cardart'))
SPRITES = os.path.join(GAME, 'public', 'assets', 'sprites')
OUT_W, OUT_H = 400, 480  # 5:6, ~2x the largest on-screen card
TOP_BIAS = 0.3  # 0 = keep the top edge, 0.5 = centre crop


def install(key, smanifest):
    path = os.path.join(SRC, key + '.png')
    if not os.path.exists(path):
        print('[cardart] missing', key, flush=True)
        return
    im = Image.open(path).convert('RGB')
    w, h = im.size
    target = OUT_W / OUT_H
    if w / h > target:  # too wide: trim the sides evenly
        nw = round(h * target)
        x = (w - nw) // 2
        im = im.crop((x, 0, x + nw, h))
    else:  # too tall: trim mostly from the bottom
        nh = round(w / target)
        y = round((h - nh) * TOP_BIAS)
        im = im.crop((0, y, w, y + nh))
    im = im.resize((OUT_W, OUT_H), Image.LANCZOS)
    im = ImageEnhance.Color(im).enhance(1.06)
    name = f'cardart_{key}'
    im.save(os.path.join(SPRITES, name + '.webp'), quality=86, method=6)
    smanifest[name] = {'w': OUT_W, 'h': OUT_H}
    print('[cardart] ok', key, flush=True)


def main():
    manifest = json.load(open(os.path.join(HERE, 'card-art-manifest.json')))
    keys = sys.argv[1:] or [it['name'] for it in manifest['items']]
    smanifest_path = os.path.join(SPRITES, 'manifest.json')
    smanifest = json.load(open(smanifest_path))
    for key in keys:
        install(key, smanifest)
    with open(smanifest_path, 'w') as f:
        json.dump(smanifest, f, indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
