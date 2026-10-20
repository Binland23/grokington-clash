"""Render card portraits from the game's 3D models and install them as sprites.

python tools/build_portraits.py [key ...]
Writes public/assets/sprites/card_<key>.webp and updates the sprite manifest.
"""
import json
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.normpath(os.path.join(HERE, '..'))
MODELS = os.path.join(GAME, 'public', 'assets', 'models')
SPRITES = os.path.join(GAME, 'public', 'assets', 'sprites')
TMP = os.path.normpath(os.path.join(GAME, '..', 'CLASH - assets', 'portraits'))
BLENDER = r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
SKIP = {'keep', 'watch'}


def main():
    os.makedirs(TMP, exist_ok=True)
    manifest = json.load(open(os.path.join(MODELS, 'manifest.json')))
    keys = sys.argv[1:] or [k for k in manifest if k not in SKIP]
    smanifest_path = os.path.join(SPRITES, 'manifest.json')
    smanifest = json.load(open(smanifest_path))
    for key in keys:
        src = os.path.join(MODELS, manifest[key]['file'])
        png = os.path.join(TMP, key + '.png')
        r = subprocess.run([BLENDER, '-b', '--factory-startup', '-P', os.path.join(HERE, 'blender_portrait.py'), '--', src, png, '640'],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        if not os.path.exists(png):
            print('[portrait] FAILED', key, r.stdout[-500:], r.stderr[-500:], flush=True)
            continue
        im = Image.open(png).convert('RGBA')
        bbox = im.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox()
        if bbox:
            pad = 6
            im = im.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad)))
        im.thumbnail((320, 320), Image.LANCZOS)
        name = f'card_{key}'
        im.save(os.path.join(SPRITES, name + '.webp'), quality=90, method=6)
        smanifest[name] = {'w': im.width, 'h': im.height}
        print('[portrait] ok', key, im.size, flush=True)
    with open(smanifest_path, 'w') as f:
        json.dump(smanifest, f, indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
