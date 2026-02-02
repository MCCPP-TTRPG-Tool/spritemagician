# Sprite Magician

AI-powered sprite animation workflow tool for game development. Generate, edit, and export sprite animations with AI assistance.

## Features

- **AI Frame Generation**: Generate animation frames sequentially using Replicate API
  - Prompt-based: Upload first frame + text prompt
  - Interpolation: Upload first and last frame for smooth transitions
- **Frame Editing**: Drag-and-drop reordering, add/remove frames
- **Animation Preview**: Play/pause controls with adjustable FPS
- **Export Options**: 
  - Individual PNG frames
  - Grid-based sprite sheets (perfect for Godot)
- **Project Management**: Save/load projects in browser or export as JSON

## Setup

1. **Install dependencies**:
```bash
npm install
```

2. **Configure APIs**:
   - **Replicate API**: Get your API token from [Replicate](https://replicate.com/account/api-tokens)
   - **Firebase**: Set up Firebase Storage for image hosting:
     1. Go to [Firebase Console](https://console.firebase.google.com/)
     2. Create a new project or use an existing one
     3. Enable Storage and create a bucket
     4. Go to Project Settings > Service Accounts
     5. Generate a new private key (JSON file)
     6. Extract the following from the JSON:
        - `project_id`
        - `client_email`
        - `private_key`
   
   Create a `.env` file in the root directory:
```
REPLICATE_API_TOKEN=your_replicate_token_here
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email@project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
```

   **Note**: For `FIREBASE_PRIVATE_KEY`, copy the entire private key from the JSON file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines, and replace newlines with `\n`.

3. **Run development server**:
```bash
npm run dev
```

## Usage

1. **Upload Frames**: Upload your first frame (and optionally last frame for interpolation)
2. **Generate**: Choose generation mode (prompt or interpolation), set frame count and FPS
3. **Edit**: Reorder frames by dragging, remove unwanted frames
4. **Preview**: Test your animation with play/pause controls
5. **Export**: Download individual frames or a complete sprite sheet

## Technical Details

- **Framework**: SvelteKit 5
- **Styling**: Tailwind CSS
- **AI Service**: Replicate (Stable Diffusion Image-to-Image)
- **Image Hosting**: Firebase Storage (for temporary image URLs required by Replicate)
- **Frame Size**: 300x300 pixels (configurable)
- **Export Format**: PNG with transparent backgrounds

## Notes

- The Replicate API integration uses sequential frame generation - each frame is generated from the previous one
- For best results, use clear, well-defined sprites as your first frame
- Frame generation may take 1-2 minutes depending on frame count and API load
