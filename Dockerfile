# RunPod Serverless Handler for SVD
# Using CUDA 12.1 for better GPU compatibility (supports newer GPUs like A100, H100, RTX 4090)
FROM runpod/pytorch:2.2.0-py3.10-cuda12.1.1-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy handler
COPY handler.py .

# Run handler
CMD ["python", "-u", "handler.py"]
