# RunPod Self-Hosting Setup (SVD)

## Overview

This setup runs **Stable Video Diffusion (SVD)** locally on RunPod.
- **No Replicate calls** - runs entirely on your GPU
- **No per-generation costs** - pay only for GPU time
- **Model pre-downloaded** - fast first request

## Files

- `handler.py` - RunPod serverless handler (runs SVD locally)
- `Dockerfile` - Container with pre-downloaded model
- `requirements.txt` - Python dependencies

## Setup Steps

### 1. RunPod Endpoint

Your endpoint: `spritemagician` (ID: `59170siiz63kid`)

### 2. Get RunPod API Key

1. Go to RunPod → **Settings** → **API Keys**
2. Create a new API key
3. Copy it

### 3. Update Your `.env`

Add to your local `.env` file:

```env
WAN_SELF_HOSTED_URL=59170siiz63kid
RUNPOD_API_KEY=your_runpod_api_key_here
```

### 4. Deploy

1. Push changes to GitHub
2. RunPod auto-builds from GitHub
3. Wait for build (5-10 minutes - model download included)
4. Test in your app

### 5. Test

1. Select **SVD (Self-Hosted)** in your app
2. Generate an animation
3. Check RunPod logs if issues occur

---

## GPU Requirements

- **Minimum**: 16GB VRAM (RTX 4080, A4000)
- **Recommended**: 24GB VRAM (RTX 4090, A5000, L4)
- **Best**: 48GB+ VRAM (A100, H100)

## Troubleshooting

### Build fails?
- Check RunPod **Builds** tab for error logs
- Verify Dockerfile and handler.py are in repo root

### Stuck on "Initializing"?
- Model may still be loading
- Check if GPU has enough VRAM
- Check RunPod **Logs** tab for errors

### Out of VRAM?
- Reduce `num_frames` (max 25)
- Use a GPU with more VRAM
- Model needs ~12GB VRAM minimum

### Generation timeout?
- SVD takes 60-120s on 24GB GPU
- Increase RunPod timeout setting
- Check logs for specific errors

### No video returned?
- Check handler response in RunPod logs
- Video is returned as base64 data URL
- Large videos may timeout

---

## Performance

| GPU | Generation Time |
|-----|-----------------|
| RTX 4090 (24GB) | ~60-90s |
| A5000 (24GB) | ~60-90s |
| A100 (80GB) | ~30-45s |
| H100 (80GB) | ~20-30s |

---

## Cost Comparison

| Method | Cost per Generation |
|--------|---------------------|
| Replicate SVD | ~$0.05 |
| RunPod (24GB) | ~$0.02 |
| RunPod (80GB) | ~$0.04 |

**Savings**: 50-60% cheaper than Replicate
