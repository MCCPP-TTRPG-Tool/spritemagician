# Sprite Magician - Project Documentation

## Overview

**Sprite Magician** is a web application for generating high-quality, consistent 2D sprite animations from a single reference image using AI. The tool is designed for game developers who need animated sprites (idle, attack, cast spell, death, etc.) for 2D games similar to Heroes of Might and Magic 3.

### Core Workflow
1. **Upload** a sprite image (character, creature, etc.)
2. **Select** an animation type (Idle, Attack, Cast, Death, Walking, etc.)
3. **Generate** a video using AI image-to-video models
4. **Extract** frames from the video
5. **Optionally remove** backgrounds for transparency
6. **Export** as individual frames or a spritesheet

---

## Tech Stack

### Frontend
- **SvelteKit** - Full-stack web framework (Svelte 5 with runes)
- **Tailwind CSS** - Utility-first styling
- **Vite** - Build tool and dev server

### Backend / APIs
- **SvelteKit API Routes** - Server-side endpoints
- **Firebase Storage** - Image/project storage
- **Firebase Admin SDK** - Server-side Firebase operations

### AI Models
- **Stable Video Diffusion (SVD)** - Self-hosted on RunPod (primary)
- **Replicate API** - Fallback models (Wan 2.5, Hailuo 2.3, Live2D)
- **Google Gemini (Nano Banana)** - Pose generation with character consistency

### Self-Hosting
- **RunPod Serverless** - GPU compute for SVD inference
- **Docker** - Containerized deployment
- **PyTorch 2.2 + CUDA 12.1** - ML framework

---

## Project Structure

```
spritemagician/
├── src/
│   ├── routes/
│   │   ├── +page.svelte              # Main application page
│   │   └── api/
│   │       ├── generate-animation/   # Video generation endpoint
│   │       ├── generate-pose/        # Single pose generation (Gemini)
│   │       ├── generation-progress/  # Polling endpoint for job status
│   │       ├── remove-background/    # Background removal (rembg)
│   │       ├── save-project/         # Save project to Firebase
│   │       ├── load-project/         # Load project from Firebase
│   │       └── proxy-image/          # CORS proxy for images
│   ├── lib/
│   │   ├── components/
│   │   │   ├── GenerationPanel.svelte   # Animation generation controls
│   │   │   ├── PoseGenerator.svelte     # Pose generation controls
│   │   │   ├── CenterPanel.svelte       # Frames/Poses/Animations tabs
│   │   │   ├── AnimationPreview.svelte  # Live animation preview
│   │   │   ├── ExportPanel.svelte       # Export options
│   │   │   ├── ProjectManager.svelte    # Save/Load/New project
│   │   │   └── FrameUpload.svelte       # Image upload component
│   │   ├── stores/
│   │   │   ├── project.js               # Current project state
│   │   │   ├── poses.js                 # Saved poses library
│   │   │   └── animations.js            # Saved animations library
│   │   └── utils/
│   │       ├── videoFrameExtractor.js   # Extract frames from video
│   │       ├── spriteSheet.js           # Generate spritesheets
│   │       └── firebaseStorage.js       # Firebase upload helpers
├── handler.py                # RunPod serverless handler (SVD)
├── Dockerfile                # Docker config for RunPod
├── requirements.txt          # Python dependencies for handler
└── .env                      # Environment variables (not committed)
```

---

## Key Features

### 1. Animation Generation
- **Multiple AI Models**: SVD (self-hosted), Wan 2.5, Hailuo 2.3, Live2D
- **Animation Presets**: Idle, Attack, Cast Spell, Walking, Take Damage, Death, Custom
- **Configurable Settings**:
  - Duration (1-3 seconds)
  - Motion intensity (subtle to strong)
  - Loop toggle (creates ping-pong animation)
  - Background removal toggle

### 2. Pose Generation
- **Nano Banana (Google Gemini)** for character-consistent pose generation
- **Presets**: Standing, Running, Jumping, Crouching, Attacking, Casting, Hurt, Dead
- **Custom pose descriptions** supported
- **Character consistency emphasis** in prompts

### 3. Libraries
- **Pose Library**: Save generated poses for reuse
- **Animation Library**: Save animations with all frames, FPS, and metadata
- **Quick switching** between saved assets

### 4. Export Options
- **Individual frames** as PNG files
- **Spritesheet** with configurable columns and frame size
- **Preview** before download
- **Transparent backgrounds** when BG removal is enabled

### 5. Project Management
- **Save/Load** projects to Firebase Storage
- **Export/Import** as JSON files
- **Project metadata**: name, FPS, prompts, settings

---

## API Endpoints

### POST `/api/generate-animation`
Generates an animated video from a reference image.

**Request:**
```json
{
  "referenceImage": "data:image/png;base64,...",
  "prompt": "2D fantasy game sprite, idle stance...",
  "model": "svd",
  "duration": 2,
  "motionAmount": 50,
  "fps": 12,
  "loop": true
}
```

**Response:**
```json
{
  "jobId": "job-123456",
  "status": "processing"
}
```

### GET `/api/generation-progress?jobId=xxx`
Polls for generation status.

**Response (in progress):**
```json
{
  "status": "processing",
  "message": "Self-hosted: IN_PROGRESS... (45s)",
  "currentFrame": 7,
  "totalFrames": 24
}
```

**Response (complete):**
```json
{
  "status": "completed",
  "videoUrl": "data:video/mp4;base64,..."
}
```

### POST `/api/generate-pose`
Generates a single pose using Google Gemini.

**Request:**
```json
{
  "referenceImage": "data:image/png;base64,...",
  "poseDescription": "jumping pose, arms raised"
}
```

### POST `/api/remove-background`
Removes background from images using rembg model.

**Request:**
```json
{
  "images": ["data:image/png;base64,..."]
}
```

---

## Self-Hosted SVD (RunPod)

### Architecture
```
[Browser] → [SvelteKit API] → [RunPod Serverless] → [SVD Model on GPU]
                                     ↓
                              [Base64 Video Response]
```

### Handler Flow (`handler.py`)
1. Receive image (base64 or URL) + parameters
2. Load SVD model (cached after first load)
3. Resize image to 1024x576 (SVD requirement)
4. Generate video frames (25 max)
5. Export to MP4
6. Return as base64 data URL

### GPU Requirements
- **Minimum**: 24GB VRAM (RTX 3090, A10)
- **Recommended**: 48GB+ VRAM (A100, A40)
- **Base Image**: PyTorch 2.2.0 + CUDA 12.1

### Cost Structure
- RunPod Serverless charges per-second of GPU usage
- No idle costs (workers spin down when unused)
- First request has "cold start" (model loading ~60-90s)
- Warm requests: ~30-60s depending on frame count

---

## Data Flow

### Animation Generation Flow
```
1. User uploads sprite image
2. User selects animation type + settings
3. Frontend sends request to /api/generate-animation
4. Backend checks for self-hosted URL (SVD) or uses Replicate
5. If SVD: Sends to RunPod endpoint
6. Backend stores job info, returns jobId
7. Frontend polls /api/generation-progress
8. RunPod generates video, returns base64
9. Backend forwards completion status
10. Frontend extracts frames from video
11. If loop enabled: Creates ping-pong sequence
12. If BG removal: Sends frames to rembg in parallel batches
13. Frames stored in project store
14. Animation preview plays automatically
```

### Pose Generation Flow
```
1. User uploads reference character
2. User selects/writes pose description
3. Frontend sends to /api/generate-pose
4. Backend calls Gemini API with:
   - Reference image (inline_data)
   - Detailed prompt for character consistency
5. Gemini generates new pose maintaining character
6. Base64 image returned
7. User can Save or Discard
8. Saved poses go to pose library (poseStore)
```

---

## Environment Variables

```env
# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com

# AI APIs
GEMINI_API_KEY=AIza...
REPLICATE_API_TOKEN=r8_...

# Self-Hosted (RunPod)
WAN_SELF_HOSTED_URL=https://api.runpod.ai/v2/your-endpoint-id/run
RUNPOD_API_KEY=rpa_...
```

---

## Stores (State Management)

### projectStore
```javascript
{
  frames: [],           // Array of base64 image URLs
  fps: 12,              // Frames per second
  firstFrame: null,     // Reference image for animation
  projectName: "...",   // Project name
  projectId: null,      // Firebase ID if saved
  prompt: "...",        // Last used prompt
}
```

### poseStore
```javascript
{
  referenceImage: null, // Character reference for pose generation
  poses: [              // Saved poses
    {
      id: "pose-123",
      name: "Jumping",
      imageData: "data:image/png;base64,...",
      prompt: "jumping pose...",
      createdAt: 1234567890
    }
  ]
}
```

### animationStore
```javascript
{
  animations: [         // Saved animations
    {
      id: "anim-123",
      name: "Idle Loop",
      frames: ["data:..."],
      fps: 12,
      prompt: "idle stance...",
      frameCount: 24,
      createdAt: 1234567890
    }
  ]
}
```

---

## Current Limitations

1. **SVD Frame Limit**: Max 25 frames per generation
2. **Character Consistency**: Video models don't guarantee perfect consistency
3. **Complex Actions**: Walking, running work better than complex combat
4. **Background Removal**: Adds processing time, uses Replicate (costs)
5. **Cold Starts**: First SVD generation after idle is slow

---

## Potential Improvements

1. **Better Walking Animations**: Current video models struggle with walking cycles
2. **Keyframe Interpolation**: Generate start/end poses, interpolate between
3. **Frame Editing**: Manual adjustment of individual frames
4. **Batch Generation**: Generate multiple animation types at once
5. **Local Model Option**: Run entirely locally for zero API costs
6. **ControlNet Integration**: Better pose control using skeleton guides

---

## Usage Tips

### For Best Results:
- Use **clean, centered sprites** with simple backgrounds
- Start with **Idle** animations (most reliable)
- Use **lower motion** settings for subtle animations
- **Remove background** works best on solid color backgrounds
- Save good generations to the **Animation Library**

### Animation Type Recommendations:
- **Idle**: Works great, use subtle motion
- **Cast Spell**: Medium motion, effects stay contained
- **Death**: Works well, character falls convincingly
- **Walking**: More challenging, may need multiple attempts
- **Attack**: Single strike works better than combos

---

## Summary

Sprite Magician bridges the gap between AI video generation and practical game asset creation. By self-hosting SVD on RunPod, it minimizes per-generation costs while providing a streamlined workflow for creating animated sprites. The pose generation feature using Gemini adds character consistency for creating multiple poses of the same character.

The application is built with SvelteKit for a responsive, modern UI and uses Firebase for persistence. The modular architecture allows easy addition of new AI models as they become available.
