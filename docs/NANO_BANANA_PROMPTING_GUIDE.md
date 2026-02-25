# Nano Banana Prompting Guide (Verified Notes)

Sources used:
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/prompting-strategies
- https://ai.google.dev/gemini-api/docs/models

## What the official docs explicitly say

1) Multi-turn is recommended for image iteration
- The image generation doc states: "Chat or multi-turn conversation is the recommended way to iterate on images."

2) Image editing is text-and-image to image
- You can "add, remove, or modify elements, change the style, or adjust the color grading."

3) Gemini 3 Pro Image positioning
- `gemini-3-pro-image-preview` is described as optimized for professional asset production and complex multi-turn creation/editing.

4) Reference image capacity and consistency
- The doc lists "Up to 14 reference images."
- It also calls out:
  - "Up to 6 images of objects with high-fidelity..."
  - "Up to 5 images of humans to maintain character consistency"

5) Inpainting / semantic masking pattern
- The guide provides a "change only [element]... keep everything else exactly the same" template for targeted edits.

6) Character consistency workflow
- For 360-like angle sets, the doc says to include previously generated images in later turns to maintain consistency.
- For difficult poses, include a pose reference image.

7) Core prompt strategy rules from Gemini prompting guide
- Use clear and specific instructions.
- Explicitly define constraints (what to do and what to avoid).
- Specify output format.
- Place critical instructions early (system instruction or beginning of user prompt).
- Use few-shot examples where possible, with consistent example formatting.
- Use prefixes (input/output/example labels) when structure matters.

## Practical prompt structure for SpriteMagician

Use this order to reduce ignored controls:

1. Control rules (authoritative)
- Context type, style, quick direction, uncropped/background/removal toggles.

2. Edit scope constraint
- "Change only X, keep Y unchanged" style line when user intent is local edits.

3. Positive target description
- Subject, composition, camera/framing, lighting, materials, style details.

4. Avoid list
- Explicit artifacts to avoid (blur, extra limbs, unreadable text, watermark, etc.).

5. Output contract
- Aspect ratio, resolution target, transparent/flat background needs, sprite-sheet readiness.

6. Optional references
- Attach source/reference images; for consistency runs, include prior output frames.

## Reusable prompt templates

### A) Fresh-shot transform (strong control precedence)
```
CONTROL RULES (highest priority):
- Context Type: {context_type}
- Style: {style}
- Quick Direction: {quick_direction}
- Keep Uncropped: {true_or_false}
- Background Color: {bg_color_or_none}
- Remove Background: {true_or_false}

TASK:
Transform the provided source image into a new output following the control rules above.
Treat this as a fresh shot. Do not preserve unintended style momentum from prior edits.

SUBJECT + COMPOSITION:
{user_prompt}

AVOID:
{negative_prompt}

OUTPUT REQUIREMENTS:
- {size_or_aspect}
- {transparent_or_flat_bg_requirements}
- Clean sprite silhouette, no cut-off body parts.
```

### B) Local inpaint-style edit
```
Using the provided image, change only: {target_region_or_object}.
Replace it with: {new_description}.
Keep everything else exactly the same, including composition, lighting, and unaffected details.
Style requirement: {style}
Avoid: {negative_prompt}
```

### C) Consistency run across angles/frames
```
Generate the next view/frame of this same character.
Maintain identity consistency with the attached prior outputs.
Requested angle/pose: {pose_or_angle}
If pose is complex, follow the attached pose reference closely.
Style: {style}
Avoid: {negative_prompt}
```

## Notes on "negative prompts" and "seeds"

- The image-generation page does not present a dedicated seed control in the sections verified here.
- "Negative prompt" is best treated as explicit "avoid" constraints in the main prompt body.
- Reproducibility should be treated as best-effort unless model docs explicitly guarantee deterministic replay for your exact endpoint/settings.
