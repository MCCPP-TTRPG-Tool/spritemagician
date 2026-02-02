"""
Test Stable Video Diffusion locally before deploying to RunPod
"""
import torch
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video
from PIL import Image
import base64
from io import BytesIO
import sys

def test_svd(image_path_or_base64, output_path="test_output.mp4", num_frames=14):
    """Test SVD with an image"""
    
    print("Loading Stable Video Diffusion model...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")
    
    # Load model
    model_id = "stabilityai/stable-video-diffusion-img2vid-xt"
    
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        model_id,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        variant="fp16" if device == "cuda" else None
    )
    pipe = pipe.to(device)
    pipe.enable_model_cpu_offload()  # Save VRAM
    
    print("Model loaded successfully!")
    
    # Load input image
    print("Loading input image...")
    if image_path_or_base64.startswith("data:image/"):
        # Base64 data URL
        base64_data = image_path_or_base64.split(",")[1]
        image_bytes = base64.b64decode(base64_data)
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
    elif image_path_or_base64.startswith("http"):
        # URL
        import requests
        response = requests.get(image_path_or_base64)
        image = Image.open(BytesIO(response.content)).convert("RGB")
    else:
        # File path
        image = Image.open(image_path_or_base64).convert("RGB")
    
    # Resize to SVD requirements (1024x576)
    image = image.resize((1024, 576))
    print(f"Image loaded: {image.size}")
    
    # Generate video
    print(f"Generating {num_frames} frames...")
    output = pipe(
        image,
        decode_chunk_size=8,
        num_frames=min(num_frames, 25),  # SVD max is 25 frames
        motion_bucket_id=127,  # Motion intensity (1-255)
        fps=8
    )
    
    frames = output.frames[0]
    print(f"Generated {len(frames)} frames")
    
    # Export to video
    print(f"Exporting to {output_path}...")
    export_to_video(frames, output_path, fps=8)
    
    print(f"✅ Video saved to {output_path}")
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_svd_local.py <image_path_or_base64> [output_path] [num_frames]")
        print("\nExample:")
        print("  python test_svd_local.py test_image.png")
        print("  python test_svd_local.py test_image.png output.mp4 14")
        sys.exit(1)
    
    image_input = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "test_output.mp4"
    num_frames = int(sys.argv[3]) if len(sys.argv) > 3 else 14
    
    try:
        test_svd(image_input, output_path, num_frames)
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
