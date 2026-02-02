# Self-Hosting Wan 2.5 Video Model

## Option 1: RunPod Serverless (Recommended)

### Step 1: Create RunPod Account
1. Go to https://runpod.io
2. Sign up and add credits ($10-20 to start)

### Step 2: Deploy Serverless Endpoint
1. Go to **Serverless** → **Deploy Serverless Endpoint**
2. Select **"Import from Docker Registry"**
3. Use this Docker image: `runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel`
4. GPU: Select **24 GB** (non-PRO) - $0.00019/s
5. Model: Leave blank (we'll install via code)

### Step 3: Create Handler Script
Create a `handler.py` file:

```python
import runpod
from diffusers import DiffusionPipeline
import torch

# Load Wan 2.5 model
pipe = DiffusionPipeline.from_pretrained(
    "wan-research/wan2.5-i2v",
    torch_dtype=torch.float16
)
pipe = pipe.to("cuda")

def handler(event):
    input_data = event["input"]
    
    image_url = input_data.get("image")
    prompt = input_data.get("prompt", "")
    num_frames = input_data.get("num_frames", 65)
    
    # Generate video
    video = pipe(
        image=image_url,
        prompt=prompt,
        num_frames=num_frames
    ).frames[0]
    
    return {"video": video}

runpod.serverless.start({"handler": handler})
```

### Step 4: Deploy
1. Upload `handler.py` to RunPod
2. Set environment variables if needed
3. Deploy endpoint
4. Get API endpoint URL

### Step 5: Update Your App
Add to `.env`:
```
WAN_SELF_HOSTED_URL=https://your-endpoint.runpod.ai
```

---

## Option 2: RunPod Pod (Simpler, More Control)

### Step 1: Create Pod
1. Go to **Pods** → **Deploy**
2. Template: **PyTorch**
3. GPU: **RTX A4000** (24GB) - $0.38/hr
4. Deploy

### Step 2: Install Dependencies
SSH into pod and run:
```bash
pip install diffusers transformers accelerate torch
```

### Step 3: Create API Server
Create `server.py`:
```python
from flask import Flask, request, jsonify
from diffusers import DiffusionPipeline
import torch

app = Flask(__name__)

pipe = DiffusionPipeline.from_pretrained(
    "wan-research/wan2.5-i2v",
    torch_dtype=torch.float16
)
pipe = pipe.to("cuda")

@app.route('/generate', methods=['POST'])
def generate():
    data = request.json
    video = pipe(
        image=data['image'],
        prompt=data.get('prompt', ''),
        num_frames=data.get('num_frames', 65)
    ).frames[0]
    
    return jsonify({"video": video})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
```

### Step 4: Run Server
```bash
python server.py
```

### Step 5: Update App
Point to: `http://your-pod-ip:8000/generate`

---

## Cost Comparison

| Method | Cost | Best For |
|--------|------|----------|
| **Serverless** | ~$0.00019/s | Pay per use, auto-scales |
| **Pod** | $0.38/hr | Heavy usage, always-on |
| **Replicate** | ~$0.05/gen | Development/testing |

**Recommendation:** Start with **Serverless** for cost efficiency.

