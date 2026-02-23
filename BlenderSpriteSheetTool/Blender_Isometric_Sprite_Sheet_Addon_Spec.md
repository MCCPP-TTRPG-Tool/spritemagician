# Blender Add-on Specification: Isometric Sprite Sheet Generator

## Goal

One-click export of 8/16-direction sprite sheets from a rigged character
or prop with multiple animations.

Outputs: - PNG sprite sheets (transparent background) - Optional
per-frame PNG sequences (debugging) - JSON manifest for Sprite Magician
ingestion

Primary use: 2D dimetric/isometric game sprites (no 3D runtime).

------------------------------------------------------------------------

# 1. User Workflow (Minimal Blender Interaction)

Required steps per character:

1.  Import model (GLB/FBX)
2.  Ensure model has:
    -   Armature (rig)
    -   Animation Actions
3.  Select export root object (SPRITE_ROOT)
4.  Click "Render All"

Everything else is automated.

------------------------------------------------------------------------

# 2. Add-on UI Layout

Location: 3D Viewport → Sidebar (N) → Tab: SpriteGen

## A. Target + Output

-   Unit Name (string)
-   Output Folder (directory picker)
-   Create Subfolders (checkbox)
-   Write Debug PNG Sequences (checkbox)

## B. Rendering Controls

-   Directions: 8 / 16
-   Direction Step: auto (45° or 22.5°)
-   Direction Order Preset:
    -   Diablo-style
    -   Cardinal start
    -   Custom start angle + CW/CCW
-   Start Angle (degrees)
-   Clockwise toggle
-   Rotate Mode:
    -   Rotate SPRITE_ROOT (recommended)
    -   Rotate Armature
-   FPS (default 12)
-   Frame Step (default 1)

## C. Camera + Lighting

-   Setup Template Scene (button)
-   Orthographic Camera (forced)
-   Ortho Scale
-   Camera Pitch
-   Camera Yaw
-   Lighting Preset:
    -   Blizzard Soft Key
    -   Flat Emissive
    -   Custom
-   Transparent Background (forced ON)
-   Render Resolution (default 512x512)

## D. Animation Selection

-   Auto-detect Actions (button)
-   Action list with checkboxes
-   Use Action Frame Range (default ON)
-   Optional manual Start/End override

## E. Packing Options

-   Output Type:
    -   Sprite Sheets + JSON
    -   Frames Only
-   Sheet Layout:
    -   Rows = Directions, Cols = Frames (recommended)
    -   Rows = Frames, Cols = Directions
    -   One sheet per direction
-   Padding (default 2px)
-   Fixed Frame Size (default ON)
-   Auto-crop to Max Bounds (optional)
-   Pivot Mode:
    -   Bottom Center (recommended)
    -   Center
    -   Custom XY

## F. Execution

-   Render Selected
-   Render All
-   Progress indicator + cancel

------------------------------------------------------------------------

# 3. Output Structure

## Folder Layout

/Exports/{UnitName}/ manifest.json idle.png walk.png attack.png cast.png
death.png /debug_frames/

## JSON Manifest Example

{ "unit": "UnitName", "directions": 16, "dir_step_degrees": 22.5,
"layout": { "type": "rows=dir_cols=frames", "padding": 2 }, "frame": {
"w": 512, "h": 512, "pivot": \[0.5, 1.0\] }, "actions": { "idle": {
"fps": 12, "frames": 8, "sheet": "idle.png" }, "walk": { "fps": 12,
"frames": 12, "sheet": "walk.png" }, "attack":{ "fps": 12, "frames": 10,
"sheet": "attack.png" } } }

------------------------------------------------------------------------

# 4. Rendering Rules

-   Rotate SPRITE_ROOT (not camera)
-   Orthographic camera only
-   Fixed camera position
-   Consistent lighting rig
-   PNG RGBA output
-   Eevee engine default

------------------------------------------------------------------------

# 5. Auto-crop Logic (Optional)

If enabled: - Compute max bounds across all frames per action - Crop
consistently using max bounds + padding - Maintain pivot stability

Default: Fixed Canvas

------------------------------------------------------------------------

# 6. Template Setup Behavior

Add-on must: - Create SPRITE_CAM if missing - Create KEY_LIGHT +
FILL_LIGHT - Set orthographic camera - Set transparent background - Set
PNG RGBA output - Configure Eevee engine

------------------------------------------------------------------------

# 7. Recommended Defaults

-   Directions: 16
-   Layout: Rows = directions, columns = frames
-   Resolution: 512x512
-   Pivot: Bottom Center
-   Engine: Eevee
-   Lighting: Blizzard Soft Key
-   Output: Sheets + JSON

------------------------------------------------------------------------

# 8. Design Goals

-   Deterministic naming
-   Minimal Blender knowledge required
-   Stable indexing for webapp ingestion
-   Supports humanoids and non-humanoids
-   Scalable to large asset libraries
