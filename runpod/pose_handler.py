"""
RunPod Serverless Handler for ControlNet + IP-Adapter Pose Generation

The "Digital Marionette" approach:
  - ControlNet DWPose  → "bones" (structural constraint — forces correct pose)
  - IP-Adapter Plus    → "skin & clothes" (visual identity — locks character appearance)

Models:
  - Base: runwayml/stable-diffusion-v1-5
  - ControlNet: lllyasviel/control_v11p_sd15_openpose
  - IP-Adapter: h94/IP-Adapter (ip-adapter-plus_sd15.bin)

Input:
  {
    "character_image": "base64 or URL — the styled master character (identity source)",
    "skeleton_image":  "base64 or URL — the target pose skeleton",
    "prompt":          "text prompt (reinforces style)",
    "negative_prompt": "text negative prompt",
    "controlnet_scale": 0.8,   # how strongly pose is enforced (0-1)
    "ip_adapter_scale": 0.7,   # how strongly identity is locked (0-1)
    "num_steps":        30,    # inference steps
    "guidance_scale":   7.5,   # CFG scale
    "seed":             -1     # -1 for random
  }

Output:
  {
    "image": "data:image/png;base64,...",
    "status": "COMPLETED",
    "generation_time": 12.3
  }
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

print("[Pose Handler] Starting imports...")

try:
    from diffusers import StableDiffusionControlNetPipeline, ControlNetModel
    from diffusers.utils import load_image
    print("[Pose Handler] diffusers imports OK")
except ImportError as e:
    print(f"[ERROR] Failed to import diffusers: {e}")
    import traceback
    print(traceback.format_exc())
    sys.exit(1)

# ── Model paths ───────────────────────────────────────
SD15_MODEL = "runwayml/stable-diffusion-v1-5"
CONTROLNET_MODEL = "lllyasviel/control_v11p_sd15_openpose"
IP_ADAPTER_REPO = "h94/IP-Adapter"
IP_ADAPTER_WEIGHT = "ip-adapter-plus_sd15.bin"
IP_ADAPTER_SUBFOLDER = "models"

# ── Global pipeline cache ─────────────────────────────
_pipe = None


def load_pipeline():
    """Load SD1.5 + ControlNet OpenPose + IP-Adapter Plus. Cached after first call."""
    global _pipe
    if _pipe is not None:
        return _pipe

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    print(f"[Pose Handler] Device: {device}")
    if device == "cuda":
        print(f"[Pose Handler] GPU: {torch.cuda.get_device_name(0)}")
        vram = torch.cuda.get_device_properties(0).total_mem / 1e9
        print(f"[Pose Handler] VRAM: {vram:.2f} GB")

    # 1. Load ControlNet OpenPose
    print(f"[Pose Handler] Loading ControlNet: {CONTROLNET_MODEL}")
    controlnet = ControlNetModel.from_pretrained(
        CONTROLNET_MODEL,
        torch_dtype=dtype,
    )

    # 2. Load SD 1.5 base + ControlNet
    print(f"[Pose Handler] Loading SD 1.5: {SD15_MODEL}")
    _pipe = StableDiffusionControlNetPipeline.from_pretrained(
        SD15_MODEL,
        controlnet=controlnet,
        torch_dtype=dtype,
        safety_checker=None,        # Disable NSFW filter for game sprites
        requires_safety_checker=False,
    )

    # 3. Load IP-Adapter Plus (injects identity into cross-attention layers)
    print(f"[Pose Handler] Loading IP-Adapter: {IP_ADAPTER_REPO}/{IP_ADAPTER_WEIGHT}")
    _pipe.load_ip_adapter(
        IP_ADAPTER_REPO,
        subfolder=IP_ADAPTER_SUBFOLDER,
        weight_name=IP_ADAPTER_WEIGHT,
    )

    # Move to device
    _pipe = _pipe.to(device)

    # Memory optimizations
    if device == "cuda":
        try:
            _pipe.enable_attention_slicing("auto")
            print("[Pose Handler] Attention slicing enabled")
        except Exception as e:
            print(f"[Pose Handler] Attention slicing not available: {e}")

        try:
            _pipe.enable_xformers_memory_efficient_attention()
            print("[Pose Handler] Xformers enabled")
        except Exception as e:
            print(f"[Pose Handler] Xformers not available: {e}")

    print("[Pose Handler] ✓ Pipeline ready (SD1.5 + ControlNet OpenPose + IP-Adapter Plus)")
    return _pipe


def decode_image(image_input):
    """Decode a base64 data URL or HTTP URL into a PIL Image."""
    if image_input.startswith("data:image/"):
        b64 = image_input.split(",", 1)[1]
        return Image.open(BytesIO(base64.b64decode(b64))).convert("RGB")
    elif image_input.startswith("http"):
        resp = requests.get(image_input, timeout=60)
        resp.raise_for_status()
        return Image.open(BytesIO(resp.content)).convert("RGB")
    else:
        # Try raw base64
        return Image.open(BytesIO(base64.b64decode(image_input))).convert("RGB")


def image_to_base64(image):
    """Convert PIL Image to base64 data URL."""
    buf = BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def handler(event):
    """
    RunPod serverless handler for pose generation.

    Combines ControlNet (pose structure) + IP-Adapter (character identity)
    to generate a character in a new pose while maintaining visual consistency.
    """
    start_time = time.time()
    print("[Pose Handler] Request received")

    try:
        inp = event.get("input", {})
        if not inp and "character_image" in event:
            inp = event  # Flat input

        character_image_raw = inp.get("character_image")
        skeleton_image_raw = inp.get("skeleton_image")
        prompt = inp.get("prompt", "fantasy game character sprite, HoMM3 style, pre-rendered 3D, detailed")
        negative_prompt = inp.get("negative_prompt",
            "blurry, low quality, watermark, text, anime, cartoon, cel-shaded, "
            "flat colors, photo, multiple characters, cropped, deformed, extra limbs")
        controlnet_scale = float(inp.get("controlnet_scale", 0.8))
        ip_adapter_scale = float(inp.get("ip_adapter_scale", 0.7))
        num_steps = int(inp.get("num_steps", 30))
        guidance_scale = float(inp.get("guidance_scale", 7.5))
        seed = int(inp.get("seed", -1))
        width = int(inp.get("width", 512))
        height = int(inp.get("height", 512))

        if not character_image_raw:
            return {"error": "character_image is required (the styled master character)", "status": "FAILED"}
        if not skeleton_image_raw:
            return {"error": "skeleton_image is required (the target pose skeleton)", "status": "FAILED"}

        # ── Load pipeline ─────────────────────────────
        pipe = load_pipeline()

        # ── Decode images ─────────────────────────────
        print("[Pose Handler] Decoding character image (IP-Adapter identity source)...")
        character_image = decode_image(character_image_raw)

        print("[Pose Handler] Decoding skeleton image (ControlNet pose target)...")
        skeleton_image = decode_image(skeleton_image_raw)

        # Resize skeleton to match output dimensions
        skeleton_image = skeleton_image.resize((width, height))

        # Resize character image for IP-Adapter (recommended: 256x256 or 512x512)
        character_image = character_image.resize((256, 256))

        print(f"[Pose Handler] Skeleton: {skeleton_image.size}, Character ref: {character_image.size}")
        print(f"[Pose Handler] ControlNet scale: {controlnet_scale}, IP-Adapter scale: {ip_adapter_scale}")
        print(f"[Pose Handler] Steps: {num_steps}, CFG: {guidance_scale}, Output: {width}x{height}")

        # ── Set IP-Adapter strength ───────────────────
        pipe.set_ip_adapter_scale(ip_adapter_scale)

        # ── Generate ──────────────────────────────────
        device = "cuda" if torch.cuda.is_available() else "cpu"
        generator = None
        if seed >= 0:
            generator = torch.Generator(device=device).manual_seed(seed)
            print(f"[Pose Handler] Using seed: {seed}")
        else:
            seed_val = torch.randint(0, 2**32, (1,)).item()
            generator = torch.Generator(device=device).manual_seed(seed_val)
            print(f"[Pose Handler] Random seed: {seed_val}")

        gen_start = time.time()

        with torch.inference_mode():
            result = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt,
                image=skeleton_image,                        # ControlNet: pose skeleton
                ip_adapter_image=character_image,            # IP-Adapter: identity lock
                controlnet_conditioning_scale=controlnet_scale,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
                generator=generator,
                width=width,
                height=height,
            )

        gen_time = time.time() - gen_start
        print(f"[Pose Handler] Generation took {gen_time:.1f}s")

        output_image = result.images[0]
        output_b64 = image_to_base64(output_image)

        total_time = time.time() - start_time
        print(f"[Pose Handler] ✓ Completed in {total_time:.1f}s")

        return {
            "image": output_b64,
            "status": "COMPLETED",
            "generation_time": round(gen_time, 2),
            "total_time": round(total_time, 2),
            "seed": seed_val if seed < 0 else seed,
        }

    except torch.cuda.OutOfMemoryError as e:
        print(f"[Pose Handler] GPU OOM: {e}")
        torch.cuda.empty_cache()
        return {"error": "GPU out of memory. Try smaller dimensions.", "status": "FAILED"}
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[Pose Handler] ERROR: {e}")
        print(tb)
        return {"error": str(e), "traceback": tb, "status": "FAILED"}


# ── Start ─────────────────────────────────────────────
print("[Pose Handler] Starting serverless handler...")
print(f"[Pose Handler] Python: {sys.version}")
print(f"[Pose Handler] PyTorch: {torch.__version__}")
print(f"[Pose Handler] CUDA: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"[Pose Handler] CUDA version: {torch.version.cuda}")

runpod.serverless.start({"handler": handler})
