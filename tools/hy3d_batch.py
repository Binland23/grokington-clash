"""Batch image-to-3D with Hunyuan3D-2 (run with the WinPortable pack's Python).

Phase 1 turns every Grok reference sheet in "CLASH - assets/raw3d" into a mesh.
Phase 2 frees the GPU, then paints a texture onto each mesh with the Paint model
(CPU offload keeps it inside 16 GB of VRAM). Results: "CLASH - assets/models_raw/<name>.glb".

Usage (from the pack folder):
  python_standalone\\python.exe -s <this file> [name ...] [--shape-only] [--steps 50] [--octree 320]
"""
import gc
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', '..', 'CLASH - assets'))
SRC = os.path.join(ASSETS, 'raw3d')
OUT = os.path.join(ASSETS, 'models_raw')
PACK = r'C:\AI\HY3D2\Hunyuan3D2_WinPortable'
os.environ.setdefault('HF_HUB_CACHE', os.path.join(PACK, 'HuggingFaceHub'))
os.environ.setdefault('HY3DGEN_MODELS', os.path.join(PACK, 'HuggingFaceHub'))
sys.path.insert(0, os.path.join(PACK, 'Hunyuan3D-2'))
os.makedirs(OUT, exist_ok=True)

import torch  # noqa: E402
from PIL import Image  # noqa: E402

args = sys.argv[1:]


def opt(name, default):
    if name in args:
        i = args.index(name)
        v = args[i + 1]
        del args[i:i + 2]
        return type(default)(v)
    return default


steps = opt('--steps', 50)
octree = opt('--octree', 320)
max_faces = opt('--faces', 40000)
shape_only = '--shape-only' in args
force = '--force' in args
names = [a for a in args if not a.startswith('--')]

files = sorted(f for f in os.listdir(SRC) if f.endswith('.png'))
if names:
    files = [f for f in files if f[:-4] in names or f[:-4].replace('m3d_', '') in names]
print(f'[hy3d] {len(files)} image(s); steps={steps} octree={octree}', flush=True)

from hy3dgen.rembg import BackgroundRemover  # noqa: E402

rembg = BackgroundRemover()


def prep(path):
    img = Image.open(path).convert('RGB')
    return rembg(img)


# ---------------------------------------------------------------- phase 1: shapes
todo_shape = [f for f in files if force or not os.path.exists(os.path.join(OUT, f[:-4] + '_shape.glb'))]
if todo_shape:
    from hy3dgen.shapegen import DegenerateFaceRemover, FaceReducer, FloaterRemover, Hunyuan3DDiTFlowMatchingPipeline

    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        'tencent/Hunyuan3D-2', subfolder='hunyuan3d-dit-v2-0', use_safetensors=True, device='cuda'
    )
    floater = FloaterRemover()
    degen = DegenerateFaceRemover()
    reducer = FaceReducer()
    for f in todo_shape:
        t0 = time.time()
        name = f[:-4]
        image = prep(os.path.join(SRC, f))
        image.save(os.path.join(OUT, name + '_input.png'))
        gen = torch.Generator().manual_seed(1234)
        mesh = pipe(image=image, num_inference_steps=steps, guidance_scale=6.0, generator=gen,
                    octree_resolution=octree, num_chunks=200000, output_type='trimesh')[0]
        mesh = floater(mesh)
        mesh = degen(mesh)
        mesh = reducer(mesh, max_facenum=max_faces)
        mesh.export(os.path.join(OUT, name + '_shape.glb'))
        print(f'[hy3d] shape {name}: {len(mesh.faces)} faces in {time.time() - t0:.0f}s', flush=True)
    del pipe
    gc.collect()
    torch.cuda.empty_cache()

if shape_only:
    print('[hy3d] shape-only done', flush=True)
    sys.exit(0)

# ---------------------------------------------------------------- phase 2: textures
import trimesh  # noqa: E402

todo_tex = [f for f in files if force or not os.path.exists(os.path.join(OUT, f[:-4] + '.glb'))]
if todo_tex:
    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    paint = Hunyuan3DPaintPipeline.from_pretrained('tencent/Hunyuan3D-2')
    paint.enable_model_cpu_offload()
    for f in todo_tex:
        t0 = time.time()
        name = f[:-4]
        mesh = trimesh.load(os.path.join(OUT, name + '_shape.glb'), force='mesh')
        image = Image.open(os.path.join(OUT, name + '_input.png'))
        try:
            textured = paint(mesh, image=image)
            textured.export(os.path.join(OUT, name + '.glb'))
            print(f'[hy3d] texture {name} in {time.time() - t0:.0f}s', flush=True)
        except Exception as e:  # keep going with the rest
            print(f'[hy3d] texture FAILED {name}: {e}', flush=True)
        torch.cuda.empty_cache()
print('[hy3d] all done', flush=True)
