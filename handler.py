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
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import load_image, export_to_video
import numpy as np
import os
import time

# Global model cache
_model = None
_pipe = None

def load_model():
    """Load SVD model once and cache it"""
    global _model, _pipe
    if _pipe is None:
        print("Loading Stable Video Diffusion model...")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        # Speed optimizations
        if device == "cuda":
            torch.backends.cudnn.benchmark = True  # Faster convolutions
            torch.backends.cuda.matmul.allow_tf32 = True  # Faster matrix ops
        
        # Use Stable Video Diffusion from Hugging Face
        model_id = "stabilityai/stable-video-diffusion-img2vid-xt"
        
        _pipe = StableVideoDiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
            variant="fp16" if device == "cuda" else None
        )
        _pipe = _pipe.to(device)
        
        # Speed optimizations
        if device == "cuda":
            try:
                # Try to use xformers for faster attention (if available)
                _pipe.enable_xformers_memory_efficient_attention()
                print("Using xformers for faster attention")
            except:
                # Fallback to attention slicing if xformers not available
                _pipe.enable_attention_slicing(slice_size="max")
                print("Using attention slicing (install xformers for faster inference)")
            
            # Enable VAE slicing for faster decoding
            _pipe.enable_vae_slicing()
        
        # Keep model on GPU for speed (disable CPU offload)
        # CPU offload saves VRAM but is slower - only enable if you run out of VRAM
        # _pipe.enable_model_cpu_offload()  # Disabled for speed
        
        print("Model loaded successfully with speed optimizations")
    return _pipe

def image_to_base64(image):
    """Convert PIL Image to base64 data URL"""
    from io import BytesIO
    buffered = BytesIO()
    image.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return f"data:image/png;base64,{img_str}"

def video_to_base64(video_path):
    """Convert video file to base64 data URL"""
    with open(video_path, "rb") as video_file:
        video_data = base64.b64encode(video_file.read()).decode()
        return f"data:video/mp4;base64,{video_data}"

def handler(event):
    """
    Handler function for RunPod serverless - LOCAL INFERENCE, NO REPLICATE
    
    Expected input:
    {
        "input": {
            "image": "data:image/png;base64,..." or "https://...",  # Base64 data URL or Image URL
            "prompt": "animation description",
            "num_frames": 65
        }
    }
    """
    start_time = time.time()
    print(f"[SVD Handler] Starting at {start_time}")
    
    try:
        # RunPod passes data in event["input"]
        input_data = event.get("input", {})
        
        # Handle both formats
        if not input_data and "image" in event:
            input_data = event
        
        image_input = input_data.get("image")
        prompt = input_data.get("prompt", "subtle motion, idle animation")
        num_frames = input_data.get("num_frames", 65)
        
        if not image_input:
            return {"error": "Image is required (base64 data URL or image URL)", "received": list(input_data.keys())}
        
        # Load or get cached model
        pipe = load_model()
        
        # Process input image
        if image_input.startswith("data:image/"):
            # Extract base64
            base64_data = image_input.split(",")[1]
            image_bytes = base64.b64decode(base64_data)
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
        elif image_input.startswith("http"):
            # Download from URL
            response = requests.get(image_input)
            image = Image.open(BytesIO(response.content)).convert("RGB")
        else:
            return {"error": "Image must be a base64 data URL (data:image/...) or HTTP(S) URL"}
        
        # Resize image to model requirements (1024x576 for SVD)
        image = image.resize((1024, 576))
        
        print(f"[SVD Handler] Generating {actual_frames} frames with SVD, prompt: {prompt}")
        generation_start = time.time()
        
        # Generate video frames with SVD
        # SVD doesn't use prompts, it's purely image-to-video
        # Speed optimizations:
        # - Larger decode_chunk_size = faster but more VRAM (14 is good balance)
        # - Lower num_frames = faster generation
        actual_frames = min(num_frames, 25)  # SVD max is 25 frames
        
        output = pipe(
            image,
            decode_chunk_size=14,  # Increased from 8 for speed (uses more VRAM but faster)
            num_frames=actual_frames,
            motion_bucket_id=127,  # Motion intensity (1-255)
            fps=8,
            generator=torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu").manual_seed(42)  # Deterministic for caching
        )
        
        frames = output.frames[0]
        generation_time = time.time() - generation_start
        print(f"[SVD Handler] Generation took {generation_time:.2f}s")
        
        # Convert frames to video
        video_start = time.time()
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
            video_path = tmp_file.name
        
        # Export frames to video
        export_to_video(frames, video_path, fps=8)
        video_time = time.time() - video_start
        print(f"[SVD Handler] Video export took {video_time:.2f}s")
        
        # Upload video to Firebase Storage (if available) or return as base64
        upload_start = time.time()
        # Check for Firebase credentials
        firebase_project_id = os.environ.get("FIREBASE_PROJECT_ID")
        
        if firebase_project_id:
            try:
                from firebase_admin import storage, initialize_app, cert
                from firebase_admin import get_app, get_apps
                
                # Initialize Firebase if not already
                if not get_apps():
                    initialize_app(credential=cert({
                        "project_id": firebase_project_id,
                        "client_email": os.environ.get("FIREBASE_CLIENT_EMAIL"),
                        "private_key": os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
                    }))
                
                bucket = storage.bucket()
                video_filename = f"videos/svd-{int(time.time())}.mp4"
                blob = bucket.blob(video_filename)
                
                # Upload video
                blob.upload_from_filename(video_path)
                blob.make_public()
                
                video_url = blob.public_url
                os.unlink(video_path)
                total_time = time.time() - start_time
                print(f"[SVD Handler] Completed in {total_time:.2f}s, video: {video_url}")
                
                return {
                    "video": video_url,
                    "videoUrl": video_url,
                    "output": video_url,
                    "status": "COMPLETED"
                }
            except Exception as firebase_error:
                print(f"Firebase upload failed: {firebase_error}, using base64 fallback")
        
        # Fallback: return as base64 (large but works)
        video_base64 = video_to_base64(video_path)
        os.unlink(video_path)
        total_time = time.time() - start_time
        print(f"[SVD Handler] Completed in {total_time:.2f}s (base64 fallback)")
        
        return {
            "video": video_base64,
            "videoUrl": video_base64,
            "output": video_base64,
            "status": "COMPLETED"
        }
        
    except Exception as e:
        import traceback
        error_time = time.time() - start_time
        error_msg = f"[SVD Handler] Error after {error_time:.2f}s: {str(e)}"
        print(error_msg)
        print(traceback.format_exc())
        
        return {
            "error": str(e), 
            "type": type(e).__name__,
            "traceback": traceback.format_exc(),
            "status": "FAILED"
        }

# Start the serverless handler
runpod.serverless.start({"handler": handler})

