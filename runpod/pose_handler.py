"""
RunPod Serverless Handler: ControlNet + IP-Adapter Pose Generation

Two modes:
  A) pose_reference provided → DWPose extracts skeleton → ControlNet + IP-Adapter
  B) No reference → IP-Adapter only (text prompt controls pose)

Models:
  - Base: runwayml/stable-diffusion-v1-5
  - ControlNet: lllyasviel/control_v11p_sd15_openpose
  - IP-Adapter: h94/IP-Adapter (ip-adapter-plus_sd15.bin)
  - Pose detection: controlnet_aux DWPose

Input:
  {
    "character_image":   "URL — styled master character (IP-Adapter identity)",
    "pose_reference":    "URL or null — image to extract pose from (DWPose)",
    "prompt":            "text prompt",
    "negative_prompt":   "text negative prompt",
    "controlnet_scale":  0.8,
    "ip_adapter_scale":  0.7,
    "num_steps":         30,
    "guidance_scale":    7.5,
    "width":             512,
    "height":            512,
    "seed":              -1
  }

Output:
  { "image": "data:image/png;base64,...", "status": "COMPLETED", ... }
"""

import runpod
import requests
from io import BytesIO
import base64
from PIL import Image
import torch
import os
import time
import sys
import numpy as np

print("[Pose Handler] Starting imports...")

try:
    from diffusers import StableDiffusionControlNetPipeline, ControlNetModel
    from diffusers.utils import load_image
    print("[Pose Handler] diffusers OK")
except ImportError as e:
    print(f"[ERROR] diffusers import failed: {e}")
    sys.exit(1)

try:
    from controlnet_aux import DWposeDetector
    HAS_DWPOSE = True
    print("[Pose Handler] DWPose OK")
except ImportError:
    HAS_DWPOSE = False
    print("[Pose Handler] DWPose not available — reference pose extraction disabled")

# ── Model IDs ─────────────────────────────────────────
SD15_MODEL = "runwayml/stable-diffusion-v1-5"
CONTROLNET_MODEL = "lllyasviel/control_v11p_sd15_openpose"
IP_ADAPTER_REPO = "h94/IP-Adapter"
IP_ADAPTER_WEIGHT = "ip-adapter-plus_sd15.bin"
IP_ADAPTER_SUBFOLDER = "models"

# ── Global cache ──────────────────────────────────────
_pipe = None
_dwpose = None


def load_pipeline():
    """Load SD1.5 + ControlNet + IP-Adapter. Cached after first call."""
    global _pipe
    if _pipe is not None:
        return _pipe

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    print(f"[Pose Handler] Device: {device}")
    if device == "cuda":
        print(f"[Pose Handler] GPU: {torch.cuda.get_device_name(0)}")
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        print(f"[Pose Handler] VRAM: {vram:.2f} GB")

    print(f"[Pose Handler] Loading ControlNet: {CONTROLNET_MODEL}")
    controlnet = ControlNetModel.from_pretrained(
        CONTROLNET_MODEL, torch_dtype=dtype,
    )

    print(f"[Pose Handler] Loading SD 1.5: {SD15_MODEL}")
    _pipe = StableDiffusionControlNetPipeline.from_pretrained(
        SD15_MODEL, controlnet=controlnet, torch_dtype=dtype,
        safety_checker=None, requires_safety_checker=False,
    )

    print(f"[Pose Handler] Loading IP-Adapter: {IP_ADAPTER_WEIGHT}")
    _pipe.load_ip_adapter(
        IP_ADAPTER_REPO, subfolder=IP_ADAPTER_SUBFOLDER,
        weight_name=IP_ADAPTER_WEIGHT,
    )

    _pipe = _pipe.to(device)

    if device == "cuda":
        try:
            _pipe.enable_xformers_memory_efficient_attention()
            print("[Pose Handler] Xformers enabled")
        except Exception:
            _pipe.enable_attention_slicing("auto")
            print("[Pose Handler] Attention slicing enabled (xformers unavailable)")

    print("[Pose Handler] ✓ Pipeline ready")
    return _pipe


def load_dwpose():
    """Load DWPose detector. Cached after first call."""
    global _dwpose
    if _dwpose is not None:
        return _dwpose
    if not HAS_DWPOSE:
        return None
    print("[Pose Handler] Loading DWPose detector...")
    _dwpose = DWposeDetector.from_pretrained("yzd-v/DWPose")
    print("[Pose Handler] ✓ DWPose ready")
    return _dwpose


def decode_image(image_input):
    """Decode a base64 data URL or HTTP URL into a PIL Image."""
    if not image_input:
        return None
    if image_input.startswith("data:image/"):
        b64 = image_input.split(",", 1)[1]
        return Image.open(BytesIO(base64.b64decode(b64))).convert("RGB")
    elif image_input.startswith("http"):
        resp = requests.get(image_input, timeout=60)
        resp.raise_for_status()
        return Image.open(BytesIO(resp.content)).convert("RGB")
    else:
        return Image.open(BytesIO(base64.b64decode(image_input))).convert("RGB")


def image_to_base64(image):
    """Convert PIL Image to base64 data URL."""
    buf = BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def make_blank_skeleton(width, height):
    """Create a blank black image (no pose constraint)."""
    return Image.fromarray(np.zeros((height, width, 3), dtype=np.uint8))


def handler(event):
    """RunPod handler for pose generation."""
    start_time = time.time()
    print("[Pose Handler] Request received")

    try:
        inp = event.get("input", {})
        if not inp and "character_image" in event:
            inp = event

        character_image_raw = inp.get("character_image")
        pose_reference_raw = inp.get("pose_reference")  # Optional
        prompt = inp.get("prompt", "fantasy game character sprite, HoMM3 style")
        negative_prompt = inp.get("negative_prompt",
            "blurry, low quality, watermark, text, anime, cartoon, "
            "flat colors, photo, multiple characters, deformed, extra limbs")
        controlnet_scale = float(inp.get("controlnet_scale", 0.8))
        ip_adapter_scale = float(inp.get("ip_adapter_scale", 0.7))
        num_steps = int(inp.get("num_steps", 30))
        guidance_scale = float(inp.get("guidance_scale", 7.5))
        seed = int(inp.get("seed", -1))
        width = int(inp.get("width", 512))
        height = int(inp.get("height", 512))

        if not character_image_raw:
            return {"error": "character_image is required", "status": "FAILED"}

        # ── Load pipeline ─────────────────────────
        pipe = load_pipeline()

        # ── Decode character image (IP-Adapter identity) ──
        print("[Pose Handler] Decoding character image...")
        character_image = decode_image(character_image_raw)
        character_image = character_image.resize((256, 256))

        # ── Handle pose reference ─────────────────
        use_controlnet = False
        skeleton_image = None

        if pose_reference_raw:
            print("[Pose Handler] Decoding pose reference...")
            pose_ref = decode_image(pose_reference_raw)

            # Extract skeleton with DWPose
            dwpose = load_dwpose()
            if dwpose is not None:
                print("[Pose Handler] Extracting skeleton with DWPose...")
                skeleton_image = dwpose(pose_ref, output_type="pil",
                                        image_resolution=max(width, height))
                use_controlnet = True
                print(f"[Pose Handler] Skeleton extracted: {skeleton_image.size}")
            else:
                print("[Pose Handler] DWPose unavailable, using reference as-is")
                skeleton_image = pose_ref.resize((width, height))
                use_controlnet = True

        if not use_controlnet:
            # No reference → blank skeleton, near-zero ControlNet influence
            print("[Pose Handler] No pose reference — using IP-Adapter + text prompt only")
            skeleton_image = make_blank_skeleton(width, height)
            controlnet_scale = 0.0  # Effectively disable ControlNet

        skeleton_image = skeleton_image.resize((width, height))

        print(f"[Pose Handler] ControlNet: {'ON' if use_controlnet else 'OFF'} (scale={controlnet_scale})")
        print(f"[Pose Handler] IP-Adapter scale: {ip_adapter_scale}")
        print(f"[Pose Handler] Steps: {num_steps}, CFG: {guidance_scale}, Size: {width}x{height}")

        # ── Configure IP-Adapter ──────────────────
        pipe.set_ip_adapter_scale(ip_adapter_scale)

        # ── Generate ──────────────────────────────
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if seed >= 0:
            generator = torch.Generator(device=device).manual_seed(seed)
        else:
            seed_val = torch.randint(0, 2**32, (1,)).item()
            generator = torch.Generator(device=device).manual_seed(seed_val)
            seed = seed_val
        print(f"[Pose Handler] Seed: {seed}")

        gen_start = time.time()

        with torch.inference_mode():
            result = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt,
                image=skeleton_image,
                ip_adapter_image=character_image,
                controlnet_conditioning_scale=controlnet_scale,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
                generator=generator,
                width=width,
                height=height,
            )

        gen_time = time.time() - gen_start
        print(f"[Pose Handler] Generation: {gen_time:.1f}s")

        output_image = result.images[0]
        output_b64 = image_to_base64(output_image)

        total_time = time.time() - start_time
        print(f"[Pose Handler] ✓ Done in {total_time:.1f}s")

        return {
            "image": output_b64,
            "status": "COMPLETED",
            "generation_time": round(gen_time, 2),
            "total_time": round(total_time, 2),
            "seed": seed,
            "used_controlnet": use_controlnet,
        }

    except torch.cuda.OutOfMemoryError as e:
        print(f"[Pose Handler] OOM: {e}")
        torch.cuda.empty_cache()
        return {"error": "GPU out of memory. Try smaller dimensions.", "status": "FAILED"}
    except Exception as e:
        import traceback
        print(f"[Pose Handler] ERROR: {e}")
        print(traceback.format_exc())
        return {"error": str(e), "traceback": traceback.format_exc(), "status": "FAILED"}


print("[Pose Handler] Starting...")
print(f"[Pose Handler] Python: {sys.version}")
print(f"[Pose Handler] PyTorch: {torch.__version__}")
print(f"[Pose Handler] CUDA: {torch.cuda.is_available()}")

runpod.serverless.start({"handler": handler})
