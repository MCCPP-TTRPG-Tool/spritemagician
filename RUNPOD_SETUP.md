# RunPod Self-Hosting Setup

## Quick Setup Steps

### 1. Files Added to Your Repo
- `handler.py` - RunPod serverless handler
- `Dockerfile` - Container configuration

### 2. RunPod Configuration

Your endpoint is already created: `spritemagician` (ID: `59170siiz63kid`)

**Status:** Currently "Waiting for Build"

### 3. Environment Variables

Add these to your RunPod endpoint settings:

1. Go to your endpoint → **Settings** → **Environment Variables**
2. Add:
   - `REPLICATE_API_TOKEN` = Your Replicate API token (handler uses this for now)

### 4. Get Your RunPod API Key

1. Go to RunPod → **Settings** → **API Keys**
2. Create a new API key
3. Copy it

### 5. Update Your App's `.env`

Add to your local `.env` file:

```env
# RunPod Self-Hosting (use endpoint ID from RunPod dashboard)
WAN_SELF_HOSTED_URL=59170siiz63kid
RUNPOD_API_KEY=your_runpod_api_key_here

# Still needed for handler (until we load model locally)
REPLICATE_API_TOKEN=your_replicate_token
```

### 6. Deploy

1. **Commit and push** `handler.py` and `Dockerfile` to your GitHub repo
2. RunPod will **auto-build** from your GitHub
3. Wait for build to complete (check RunPod dashboard)
4. Test generation in your app

### 7. Test

1. Select **Wan 2.5** model in your app
2. Generate an animation
3. Check RunPod logs if issues occur

---

## Current Setup (Proxy Mode)

**Note:** The handler currently proxies to Replicate API. This still saves money because:
- RunPod charges per second of compute (~$0.00019/s)
- Replicate charges per API call (~$0.05/call)
- **Savings:** ~88% cheaper

## Future: True Self-Hosting

To actually load the Wan 2.5 model locally (bigger savings, no Replicate needed):
1. Update `handler.py` to load model weights
2. Requires more GPU memory (48GB+ recommended)
3. Slower cold starts but unlimited free generations

---

## Troubleshooting

**Build fails?**
- Check RunPod **Builds** tab for error logs
- Verify `handler.py` and `Dockerfile` are in repo root
- Ensure GitHub repo is connected correctly

**Handler crashes?**
- Check RunPod **Logs** tab for error messages
- Verify `REPLICATE_API_TOKEN` is set in endpoint environment variables
- Check that handler receives correct input format

**Generation fails?**
- Check RunPod endpoint **Logs** tab
- Verify `REPLICATE_API_TOKEN` is valid
- Check RunPod API key has correct permissions
- Look for error messages in handler response

**No video returned?**
- Check handler response in RunPod logs
- Verify Replicate prediction completed successfully
- Check that video URL is in response format

**Common Issues:**
- **"REPLICATE_API_TOKEN not set"** → Add token to RunPod endpoint environment variables
- **"Image URL is required"** → Check input format matches handler expectations
- **"Generation timed out"** → Replicate job took too long (increase timeout or check Replicate status)

