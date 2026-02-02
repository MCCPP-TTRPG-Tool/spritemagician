"""
RunPod Serverless Handler for Wan 2.5 Video Generation
Supports base64 image uploads directly
"""
import runpod
import requests
from io import BytesIO
import base64
from PIL import Image

# Note: You'll need to install dependencies in your Dockerfile
# pip install diffusers transformers accelerate torch runpod

def download_image(url):
    """Download image from URL and return PIL Image"""
    response = requests.get(url)
    return Image.open(BytesIO(response.content))

def handler(event):
    """
    Handler function for RunPod serverless
    
    Expected input:
    {
        "input": {
            "image": "data:image/png;base64,..." or "https://...",  # Base64 data URL or Image URL
            "prompt": "animation description",
            "num_frames": 65
        }
    }
    """
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
        
        # Handle base64 data URL - Replicate accepts these directly
        image_url = image_input
        if image_input.startswith("data:image/"):
            # Replicate accepts base64 data URLs directly, so we can pass it through
            image_url = image_input
        elif not image_input.startswith("http"):
            return {"error": "Image must be a base64 data URL (data:image/...) or HTTP(S) URL"}
        
        # For now, we'll use Replicate's Wan 2.5 API
        # TODO: Load model locally once we have proper GPU setup
        import os
        replicate_token = os.environ.get("REPLICATE_API_TOKEN")
        
        if not replicate_token:
            return {"error": "REPLICATE_API_TOKEN not set"}
        
        # Call Replicate's Wan 2.5 model
        response = requests.post(
            "https://api.replicate.com/v1/predictions",
            headers={
                "Authorization": f"Token {replicate_token}",
                "Content-Type": "application/json"
            },
            json={
                "version": "1b29bbbbfdbc25bba2294de3acd2b58b82e5b623f183880cdb37d76133d80f00",
                "input": {
                    "image": image_url,
                    "prompt": prompt,
                    "max_area": "832x480",
                    "fast_mode": "Disabled"
                }
            }
        )
        
        # Replicate returns 201 (Created) for successful prediction creation, 200 for other success
        if response.status_code not in [200, 201]:
            error_text = response.text
            try:
                error_json = response.json()
                error_text = error_json.get("detail", error_text)
            except:
                pass
            return {"error": f"Replicate API error: {response.status_code}", "details": error_text}
        
        prediction = response.json()
        prediction_id = prediction.get("id")
        
        if not prediction_id:
            return {"error": "No prediction ID returned", "response": prediction}
        
        # Poll for completion
        import time
        max_wait = 300  # 5 minutes
        waited = 0
        
        while waited < max_wait:
            try:
                status_response = requests.get(
                    f"https://api.replicate.com/v1/predictions/{prediction_id}",
                    headers={"Authorization": f"Token {replicate_token}"}
                )
                
                if status_response.status_code != 200:
                    return {"error": f"Status check failed: {status_response.status_code}"}
                
                result = status_response.json()
                status = result.get("status")
                
                if status == "succeeded":
                    video_url = result.get("output")
                    if isinstance(video_url, list):
                        video_url = video_url[0]
                    # Return in format our app expects
                    return {"video": video_url, "videoUrl": video_url, "output": video_url}
                
                if status == "failed":
                    error_msg = result.get("error") or result.get("message") or "Generation failed"
                    return {"error": error_msg, "status": status}
                
                time.sleep(2)
                waited += 2
            except Exception as poll_error:
                return {"error": f"Polling error: {str(poll_error)}"}
        
        return {"error": "Generation timed out", "waited_seconds": waited}
        
    except Exception as e:
        import traceback
        return {
            "error": str(e), 
            "type": type(e).__name__,
            "traceback": traceback.format_exc()
        }

# Start the serverless handler
runpod.serverless.start({"handler": handler})

