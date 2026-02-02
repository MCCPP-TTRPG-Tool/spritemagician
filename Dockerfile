# RunPod Serverless Handler for SVD
# Using latest PyTorch with CUDA 12.4 for RTX 5090/newest GPU support
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

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

# Verify imports work BEFORE deploying (fail fast)
RUN python -c "\
from diffusers import StableVideoDiffusionPipeline; \
from diffusers.utils import export_to_video; \
import torch; \
print('✓ diffusers imports OK'); \
print(f'✓ PyTorch {torch.__version__}'); \
print(f'✓ CUDA available: {torch.cuda.is_available()}'); \
"

# Copy handler
COPY handler.py .

# Verify handler imports work
RUN python -c "import sys; sys.path.insert(0, '/app'); exec(open('handler.py').read().split('runpod.serverless.start')[0]); print('✓ handler imports OK')"

# Run handler
CMD ["python", "-u", "handler.py"]
