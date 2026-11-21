"""
Model Stüdyo - self-hosted image→3D server (free, open source, no paid API).

Uses Tencent Hunyuan3D-2mv, an open model that takes front / back / left / right
photos and produces a detailed 3D mesh. Returns a print-ready binary STL (millimetres, Z-up).

It also serves the Model Stüdyo web app itself, so phones on the same Wi-Fi can open
http://<this-computer-ip>:8000 and use it directly.

Run:
    python app.py                 # real AI (needs an NVIDIA GPU, see README.md)
    python app.py --mock          # no GPU: returns a test shape (to try the app/server wiring)
"""
import argparse
import io
import os
import threading

import numpy as np
import trimesh
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../model-studio

args = None
pipeline = None
rembg = None
gpu_lock = threading.Lock()

app = FastAPI(title="Model Stüdyo AI")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def load_model():
    global pipeline, rembg
    if args.mock:
        print("MOCK mode: no AI model is loaded.")
        return
    import torch  # noqa: F401
    from hy3dgen.rembg import BackgroundRemover
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    print(f"Loading {args.model} / {args.subfolder} (first run downloads several GB)…")
    pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        args.model, subfolder=args.subfolder, variant="fp16"
    )
    rembg = BackgroundRemover()
    print("Model ready.")


def prepare(upload: UploadFile) -> Image.Image:
    img = Image.open(io.BytesIO(upload.file.read()))
    img.load()
    if img.mode != "RGBA" or img.getchannel("A").getextrema()[0] == 255:
        img = img.convert("RGB")
        img = rembg(img) if rembg is not None else img.convert("RGBA")
    return img


def clean_and_scale(mesh: trimesh.Trimesh, height_mm: float) -> trimesh.Trimesh:
    # keep the largest connected part (drops floating specks)
    try:
        parts = mesh.split(only_watertight=False)
        if len(parts) > 1:
            mesh = max(parts, key=lambda m: len(m.faces))
    except Exception as e:  # needs networkx/scipy; skip cleanup if missing
        print("split skipped:", e)
    mesh.remove_unreferenced_vertices()
    # model space is Y-up; STL for 3D printing is Z-up
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    lo, hi = mesh.bounds
    mesh.apply_scale(height_mm / max(hi[2] - lo[2], 1e-9))
    lo, hi = mesh.bounds
    mesh.apply_translation([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
    try:
        trimesh.repair.fix_normals(mesh)
    except Exception as e:
        print("fix_normals skipped:", e)
    return mesh


@app.get("/health")
def health():
    return {"ok": True, "mock": bool(args.mock), "model": None if args.mock else f"{args.model}/{args.subfolder}"}


@app.post("/generate")
def generate(
    front: UploadFile = File(...),
    back: UploadFile | None = File(None),
    left: UploadFile | None = File(None),
    right: UploadFile | None = File(None),
    octree_resolution: int = Form(380),
    steps: int = Form(30),
    height_mm: float = Form(100.0),
    seed: int = Form(1234),
):
    views = {"front": front, "back": back, "left": left, "right": right}
    if args.swap_lr:
        views["left"], views["right"] = views["right"], views["left"]
    octree_resolution = int(min(max(octree_resolution, 128), 512))
    steps = int(min(max(steps, 5), 100))
    try:
        images = {k: prepare(v) for k, v in views.items() if v is not None}
    except Exception as e:  # unreadable image
        raise HTTPException(400, f"Görsel okunamadı: {e}")

    with gpu_lock:  # one generation at a time on the GPU
        if args.mock:
            mesh = trimesh.creation.capsule(height=1.2, radius=0.4, count=[48, 48])
            mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))  # Y-up like the AI output
        else:
            import torch

            mesh = pipeline(
                image=images,
                num_inference_steps=steps,
                octree_resolution=octree_resolution,
                num_chunks=20000,
                generator=torch.manual_seed(seed),
                output_type="trimesh",
            )[0]
            torch.cuda.empty_cache()

    mesh = clean_and_scale(mesh, height_mm)
    data = mesh.export(file_type="stl")
    return Response(content=data, media_type="model/stl",
                    headers={"Content-Disposition": 'attachment; filename="model.stl"',
                             "X-Triangles": str(len(mesh.faces))})


@app.exception_handler(Exception)
def on_error(_, exc):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


def main():
    global args
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--mock", action="store_true", help="no GPU / no model; return a test shape")
    p.add_argument("--model", default="tencent/Hunyuan3D-2mv")
    p.add_argument("--subfolder", default="hunyuan3d-dit-v2-mv",
                   help="hunyuan3d-dit-v2-mv (quality) or hunyuan3d-dit-v2-mv-turbo (faster)")
    p.add_argument("--swap-lr", action="store_true", help="swap left/right if sides come out mirrored")
    args = p.parse_args()
    load_model()
    # serve the web app itself at / (when this file sits inside the model-studio folder)
    if os.path.exists(os.path.join(APP_DIR, "index.html")):
        app.mount("/", StaticFiles(directory=APP_DIR, html=True), name="app")
        print(f"Web app: http://localhost:{args.port}/  (phones on the same Wi-Fi: http://<this-pc-ip>:{args.port}/)")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
