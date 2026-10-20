"""Rig + animate every Hunyuan3D mesh with Blender and install them into the game.

python tools/build_models.py [key ...] [--preview]
Reads  "CLASH - assets/models_raw/m3d_<name>.glb"
Writes "public/assets/models/<key>.glb" and public/assets/models/manifest.json
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.normpath(os.path.join(HERE, '..'))
RAW = os.path.normpath(os.path.join(GAME, '..', 'CLASH - assets', 'models_raw'))
OUT = os.path.join(GAME, 'public', 'assets', 'models')
PREVIEW = os.path.normpath(os.path.join(GAME, '..', 'CLASH - assets', 'previews'))
BLENDER = r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
SCRIPT = os.path.join(HERE, 'blender_rig.py')

# key -> (source mesh, kind, opts)
MODELS = {
    'knight': ('m3d_knight', 'biped', {'attack': 'melee'}),
    'archer': ('m3d_archer', 'biped', {'attack': 'bow'}),
    'imp': ('m3d_imp', 'biped', {'attack': 'stab', 'faces': 6000}),
    'brute': ('m3d_brute', 'biped', {'attack': 'heavy', 'faces': 10000}),
    'ironclad': ('m3d_ironclad', 'biped', {'attack': 'heavy'}),
    'gunner': ('m3d_gunner', 'biped', {'attack': 'gun'}),
    'pyromancer': ('m3d_pyromancer', 'biped', {'attack': 'cast'}),
    'berserker': ('m3d_berserker', 'biped', {'attack': 'spin'}),
    'skeleton': ('m3d_skeleton', 'biped', {'attack': 'melee', 'faces': 5000, 'tex': 512}),
    'wyrmling': ('m3d_wyrmling', 'flyer', {}),
    'gargoyle': ('m3d_gargoyle', 'flyer', {'faces': 6000}),
    'boarrider': ('m3d_boar', 'quadruped', {'rider': 'm3d_rider', 'rider_h': 0.8}),
    'lancer': ('m3d_horse', 'quadruped', {'rider': 'm3d_lancer', 'rider_h': 0.85}),
    'blimp': ('m3d_blimp', 'static', {'faces': 8000}),
    'turret': ('m3d_turret', 'static', {'faces': 9000}),
    'imphut': ('m3d_imphut', 'static', {'faces': 9000}),
    'keep': ('m3d_keep', 'static', {'faces': 14000, 'tex': 2048}),
    'watch': ('m3d_watch', 'static', {'faces': 12000, 'tex': 2048}),
}

# Per-model fixes discovered by looking at previews (yaw to face -Y, etc).
OVERRIDES_FILE = os.path.join(HERE, 'model_overrides.json')


def main():
    args = sys.argv[1:]
    preview = '--preview' in args
    use_shape = '--shape' in args  # rig the untextured shape when the textured mesh isn't ready
    keys = [a for a in args if not a.startswith('--')] or list(MODELS)
    overrides = json.load(open(OVERRIDES_FILE)) if os.path.exists(OVERRIDES_FILE) else {}
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    man_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    for key in keys:
        src, kind, opts = MODELS[key]
        opts = {**opts, **overrides.get(key, {})}
        path = os.path.join(RAW, src + '.glb')
        if not os.path.exists(path) and use_shape:
            path = os.path.join(RAW, src + '_shape.glb')
        if not os.path.exists(path):
            print(f'[build] skip {key}: {path} missing', flush=True)
            continue
        if 'rider' in opts:
            rp = os.path.join(RAW, opts['rider'] + '.glb')
            if not os.path.exists(rp) and use_shape:
                rp = os.path.join(RAW, opts['rider'] + '_shape.glb')
            opts['rider'] = rp
            if not os.path.exists(opts['rider']):
                print(f'[build] skip {key}: rider mesh missing', flush=True)
                continue
        if preview:
            opts['preview'] = os.path.join(PREVIEW, key + '.png')
        dst = os.path.join(OUT, key + '.glb')
        cmd = [BLENDER, '-b', '--factory-startup', '-P', SCRIPT, '--', path, dst, kind, json.dumps(opts)]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        lines = [ln for ln in r.stdout.splitlines() if ln.startswith('[rig]') or 'Error' in ln or 'Traceback' in ln]
        print(f'[build] {key} ({kind}) exit={r.returncode}', flush=True)
        for ln in lines[-8:]:
            print('   ', ln[:300], flush=True)
        if r.returncode != 0 or not os.path.exists(dst):
            print(r.stderr[-1500:], flush=True)
            continue
        entry = {'file': key + '.glb'}
        if 'game_yaw' in opts:
            entry['yaw'] = opts['game_yaw']
        manifest[key] = entry
        with open(man_path, 'w') as f:
            json.dump(manifest, f, indent=1, sort_keys=True)
    print('[build] done', flush=True)


if __name__ == '__main__':
    main()
