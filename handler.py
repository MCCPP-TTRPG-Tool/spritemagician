"""
RunPod Serverless Handler for Local Video Generation
Uses Stable Video Diffusion (SVD) - NO REPLICATE CALLS
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
import tempfile

print("[SVD Handler] Starting imports...")

# Import diffusers with error handling
try:
    from diffusers import StableVideoDiffusionPipeline
    from diffusers.utils import export_to_video
    print("[SVD Handler] Diffusers imported successfully")
except ImportError as e:
    print(f"[ERROR] Failed to import diffusers: {e}")
    sys.exit(1)

# Global model cache
_pipe = None
MODEL_ID = "stabilityai/stable-video-diffusion-img2vid-xt"

def load_model():
    """Load SVD model once and cache it"""
    global _pipe
    if _pipe is None:
        try:
            print("[SVD Handler] Loading Stable Video Diffusion model...")
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[SVD Handler] Using device: {device}")
            
            if device == "cuda":
                torch.backends.cudnn.benchmark = True
                torch.backends.cuda.matmul.allow_tf32 = True
                print(f"[SVD Handler] GPU: {torch.cuda.get_device_name(0)}")
                print(f"[SVD Handler] VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
            
            print(f"[SVD Handler] Loading model: {MODEL_ID}")
            
            _pipe = StableVideoDiffusionPipeline.from_pretrained(
                MODEL_ID,
                torch_dtype=torch.float16 if device == "cuda" else torch.float32,
                variant="fp16" if device == "cuda" else None
            )
            print("[SVD Handler] Model loaded, moving to device...")
            _pipe = _pipe.to(device)
            
            # Memory optimizations
            if device == "cuda":
                _pipe.enable_attention_slicing(slice_size="auto")
                _pipe.enable_vae_slicing()
                print("[SVD Handler] Memory optimizations enabled")
            
            print("[SVD Handler] Model ready!")
        except Exception as e:
            print(f"[SVD Handler] ERROR loading model: {e}")
            import traceback
            print(traceback.format_exc())
            raise
    return _pipe

def video_to_base64(video_path):
    """Convert video file to base64 data URL"""
    with open(video_path, "rb") as video_file:
        video_data = base64.b64encode(video_file.read()).decode()
        return f"data:video/mp4;base64,{video_data}"

def handler(event):
    """
    Handler function for RunPod serverless
    
    Expected input:
    {
        "input": {
            "image": "data:image/png;base64,..." or "https://...",
            "prompt": "animation description",
            "num_frames": 25
        }
    }
    """
    start_time = time.time()
    print(f"[SVD Handler] Request received")
    
    try:
        # Get input data
        input_data = event.get("input", {})
        if not input_data and "image" in event:
            input_data = event
        
        image_input = input_data.get("image")
        prompt = input_data.get("prompt", "subtle motion")
        num_frames = min(input_data.get("num_frames", 25), 25)  # SVD max is 25
        
        print(f"[SVD Handler] num_frames: {num_frames}, prompt: {prompt[:50]}...")
        
        if not image_input:
            return {"error": "Image is required", "status": "FAILED"}
        
        # Load model
        pipe = load_model()
        
        # Process input image
        print("[SVD Handler] Processing input image...")
        if image_input.startswith("data:image/"):
            base64_data = image_input.split(",")[1]
            image_bytes = base64.b64decode(base64_data)
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
        elif image_input.startswith("http"):
            response = requests.get(image_input, timeout=30)
            image = Image.open(BytesIO(response.content)).convert("RGB")
        else:
            return {"error": "Invalid image format", "status": "FAILED"}
        
        # Resize to SVD requirements (1024x576)
        image = image.resize((1024, 576))
        print(f"[SVD Handler] Image resized to 1024x576")
        
        # Generate video
        print(f"[SVD Handler] Generating {num_frames} frames...")
        gen_start = time.time()
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        generator = torch.Generator(device=device).manual_seed(42)
        
        output = pipe(
            image,
            decode_chunk_size=8,  # Lower for less VRAM usage
            num_frames=num_frames,
            motion_bucket_id=127,
            fps=8,
            generator=generator
        )
        
        frames = output.frames[0]
        gen_time = time.time() - gen_start
        print(f"[SVD Handler] Generation took {gen_time:.1f}s")
        
        # Export to video
        print("[SVD Handler] Exporting video...")
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            video_path = tmp.name
        
        export_to_video(frames, video_path, fps=8)
        
        # Return as base64
        video_base64 = video_to_base64(video_path)
        os.unlink(video_path)
        
        total_time = time.time() - start_time
        print(f"[SVD Handler] Completed in {total_time:.1f}s")
        
        return {
            "video": video_base64,
            "videoUrl": video_base64,
            "output": video_base64,
            "status": "COMPLETED",
            "generation_time": gen_time,
            "total_time": total_time
        }
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"[SVD Handler] ERROR: {error_msg}")
        print(traceback.format_exc())
        
        return {
            "error": error_msg,
            "traceback": traceback.format_exc(),
            "status": "FAILED"
        }

# Start handler
print("[SVD Handler] Starting serverless handler...")
runpod.serverless.start({"handler": handler})
