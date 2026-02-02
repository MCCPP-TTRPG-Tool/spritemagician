# RunPod Serverless Handler for SVD
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
# Note: torch is already in base image, don't reinstall
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download the SVD model during build (avoids cold start timeout)
# This makes the image larger but ensures fast first request
RUN python -c "from diffusers import StableVideoDiffusionPipeline; \
    print('Downloading SVD model...'); \
    StableVideoDiffusionPipeline.from_pretrained( \
        'stabilityai/stable-video-diffusion-img2vid-xt', \
        variant='fp16' \
    ); \
    print('Model downloaded!')"

# Copy handler
COPY handler.py .

# Run handler
CMD ["python", "-u", "handler.py"]
