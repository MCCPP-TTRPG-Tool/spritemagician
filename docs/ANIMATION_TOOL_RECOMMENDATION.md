# Animation tool decision — Sprite Magician

## Scope

This recommendation is for small, short (roughly 2–3 second) animations from one character image: upper-body or bust portraits doing idle, blink, look, hit-reaction, and simple spell-cast actions. There is no driving/source video. The important requirements are:

1. The user can enter a raw prompt without the app secretly rewriting it.
2. The character remains centered and recognisable.
3. Iteration is inexpensive.
4. Finished game assets should not randomly drift between runs.

## Decision

Use **Wan 2.2 Fast on Replicate as Sprite Magician's AI draft generator**. Keep it on the direct, raw-prompt path already in the app. It is the best fit for quickly exploring simple motions cheaply.

Use **Live2D Cubism for the final, reusable bust-animation pipeline** if the assets are mostly portrait/bust characters. It gives deterministic blink, breathing, eye/head look, hit, and cast motions once the artwork has been separated into movable pieces. The source art must be prepared in layers.

Use **Spine instead of Live2D** if these assets will expand beyond busts into general game characters, enemies, weapons, and full-body sprite work. It is the more general game-animation system and can export image sequences/spritesheets.

There is no prompt-only image-to-video model that can guarantee an action follows a prompt 100%. A generated video is a sampled interpretation of the image and text. A fixed seed improves repeatability of a given setup; it does not turn a text instruction into a deterministic animation control rig.

## Why Wan 2.2 Fast is the right AI default

| Candidate | What it is good at | Fit here | Decision |
| --- | --- | --- | --- |
| **Wan 2.2 Fast** | Fast image-to-video experimentation at 480p/720p | Direct image + prompt input, optional fixed seed, low fixed per-clip cost | **Use for drafts** |
| Wan 2.7 I2V | Higher-end, longer video work; optional first/last-frame guidance | Has an explicit prompt-expansion feature, longer latency, and the tested account hit its output safety filter | Keep as an occasional opt-in experiment, not default |
| Runway Gen-4.5 | Stronger cinematic prompt/motion quality | Much more expensive, minimum 2 seconds and optimized for video creation rather than 300px game sprite iteration | Not the primary generator |
| LTX-2 Distilled | Very cheap fast video experimentation | Worth a small A/B test, but it is audio-video/cinematic oriented and has no evidence it solves identity/drift better than the current Wan path | Optional challenger only |
| Live2D Cubism | Deterministic portrait/bust movement | Requires layered art preparation; no raw natural-language motion prompting | **Best final bust pipeline** |
| Spine | Deterministic, reusable 2D game animation | Requires rigging/setup; broader than a portrait-only tool | **Best final general-sprite pipeline** |

Wan 2.2 Fast accepts an image, prompt, seed, frame count, and FPS. Its public schema does **not** expose an `enable_prompt_expansion` input. It supports 81–121 frames and states that 81 is its best-results default. At 480p it is listed at $0.05 per base output video and $0.065 for an interpolated output. The service is billed around output video settings, not the original source image's 300×300 dimensions. [Wan 2.2 Fast model and pricing](https://replicate.com/wan-video/wan-2.2-i2v-fast) · [Wan 2.2 Fast API schema](https://replicate.com/wan-video/wan-2.2-i2v-fast/versions/b609b267d986d762a6d8679ac036d29e6d4454218df558db3aa4d0396ba55c59/api)

The open Wan 2.2 project treats prompt extension as an explicit `--use_prompt_extend` option, rather than intrinsic model behavior. That supports the direct-prompt approach: the current hosted Fast schema has no such option to enable, so Sprite Magician should send the raw string untouched and should not add a hidden prompt expander. [Wan 2.2's official generation flags](https://github.com/Wan-Video/Wan2.2/blob/main/generate.py)

Wan 2.7 is not a cure for this requirement. Its own documentation says `enable_prompt_expansion` expands short prompts, defaults to true, and can be disabled. It also recommends first/last-frame mode for exact end-state control, which is incompatible with a strictly one-image-only workflow. Its public examples demonstrate disabling expansion, but real observed runs for this project were much slower and one failed output inspection. [Wan 2.7 I2V documentation](https://replicate.com/wan-video/wan-2.7-i2v/readme) · [Wan 2.7 examples with expansion disabled](https://replicate.com/wan-video/wan-2.7-i2v/examples)

## The unavoidable trade-off

**One image + one prompt gives semantic direction, not mechanical control.** The model has to invent every in-between pose. That is why adding more “do not move” clauses can reduce movement but cannot guarantee only an eyelid or a 5-degree head turn moves. First/last-frame conditioning increases end-pose control, but it needs a second image. Driving-video character animation provides stronger motion control, but is explicitly outside this workflow.

For the simple actions requested, short single-action prompts are better than prose-heavy prompts. Do not describe the character's appearance again; the image already supplies it. Describe only the action and constraints.

### Raw prompt patterns

Use this structure, in this order:

`[framing lock]. [one action with small magnitude]. [return/end state]. [things that must stay fixed].`

Examples:

* **Idle:** `Upper-body bust, fixed centered framing. Only subtle breathing and one blink. No camera movement, no zoom, no body translation, no head turn, no background motion.`
* **Look:** `Upper-body bust, fixed centered framing. The eyes glance slightly left; the head turns about 5 degrees left, pauses, then returns to the original forward pose. No camera movement, zoom, body movement, or background motion.`
* **Hit:** `Upper-body bust, fixed centered framing. One small backward recoil from a hit, then return exactly to the starting pose. No camera movement, zoom, stepping, turning, extra gestures, or background motion.`
* **Cast:** `Upper-body bust, fixed centered framing. Raise one hand slightly and form a small spell glow, then return to the original pose. No camera movement, zoom, body translation, turning, or background motion.`

Avoid words such as *cinematic*, *dynamic*, *dramatic camera*, *sweeping*, *alive*, *energetic*, or multiple sequential actions. They compete with the desired small motion.

## Recommended operating settings for AI drafts

* **Model:** Wan 2.2 Fast.
* **Resolution:** 480p. Downscale/crop the resulting frames to sprite size afterwards; a 300×300 input does not make a hosted video model produce a 300×300 output.
* **Generation length:** 81 frames—the model's documented preferred frame count.
* **Provider FPS:** 16 FPS to make the minimum 81-frame generation about 5 seconds, then trim/select the useful 1–3 seconds in the frame tool. Setting 30 FPS creates a shorter clip but does not reduce the required frame count. The UI's export/playback FPS can remain independent.
* **Seed:** save the seed whenever a motion is close. Re-run only small prompt changes with that seed; use a new seed only when the motion direction itself is wrong.
* **Static Lock / start-to-end:** use only when a truly static endpoint is wanted. In the current app, that routes through a first/last-frame model rather than normal one-image Wan 2.2 Fast, so it is a different and slower operation.
* **Negative prompt:** do not expect this control to affect the current Wan 2.2 Fast request. The active provider schema has no negative-prompt field, and the current route does not submit one to its Wan 2.2 branch. It applies to other retained model branches, not to the selected one.

### Important implementation reality in this app

The existing **Motion** slider is not a Wan 2.2 Fast control. The active Wan 2.2 request only sends the raw prompt, image, 81–121 frame count, provider FPS, and optional seed. In the retained code, `motionAmount` is applied by other model branches (such as SVD/LTX), but not the active Wan 2.2 Fast branch. Likewise, the hosted Wan 2.2 Fast schema exposes neither a motion bucket/scale parameter, a negative prompt, nor ControlNet/open-pose/depth conditioning. Those recommendations apply to a self-hosted ComfyUI workflow with different nodes/models, not to this cloud API. [Wan 2.2 Fast API schema](https://replicate.com/wan-video/wan-2.2-i2v-fast/versions/b609b267d986d762a6d8679ac036d29e6d4454218df558db3aa4d0396ba55c59/api)

### Cost envelope

At the current published 480p base price, 100 Wan 2.2 Fast attempts are about **$5**; 100 first/last-frame interpolation attempts are about **$6.50**. This is why it makes sense to generate 3–6 candidate drafts per desired action, select one, then polish it. At the stated Runway API price of $0.12 per second for Gen-4.5, a 2-second test is about $0.24 before any optional output-format charge; it is a quality benchmark, not an inexpensive sprite batch workflow. [Wan 2.2 pricing](https://replicate.com/wan-video/wan-2.2-i2v-fast) · [Runway Gen-4.5 pricing](https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5)

## The production route: a rig, not a newer video model

Live2D Cubism is unusually well matched to this project because the content is upper-body/bust characters. Its prescribed workflow separates an illustration into movable parts, applies deformers/parameters, animates with keyframes, and exports video, GIF, sequential stills, or application assets. Its deformers can move mesh vertices to create face direction and arm motion. That directly covers idle breathing, blinks, small look-arounds, recoil, and small casting gestures while keeping the character centered exactly. [Cubism production flow](https://docs.live2d.com/en/cubism-editor-manual/workflow/) · [Cubism deformers](https://docs.live2d.com/en/cubism-editor-manual/deformer/)

Spine is the better choice when the target becomes a full game animation library. It rigs images to bones, supports mesh weighting/deformation, animation blending and procedural manipulation, and can export PNG/JPEG image sequences plus atlas-ready game data. Its documentation specifically calls out dynamic look/aim behavior and reusable animations across differently skinned characters. [Spine in depth](https://en.esotericsoftware.com/spine-in-depth/?lang=en) · [Spine demos and runtime behavior](https://us.esotericsoftware.com/spine-demos)

## Concrete rollout

1. **Keep the current Wan 2.2 Fast raw-prompt path.** Do not add an invisible prompt rewriter. If a future “Prompt helper” is added, it must only fill an editable text box; the submitted prompt must remain visible and editable.
2. **A/B test no more than 20 actions** against LTX-2 Distilled and Wan 2.2 Fast: five idles, five looks, five hits, five casts. Score each candidate 0–2 for identity retention, framing stability, action correctness, and clean loop/end state. LTX-2 is inexpensive enough to test at $0.02 per output second, but should earn its place by score, not novelty. [LTX-2 Distilled model and pricing](https://replicate.com/lightricks/ltx-2-distilled)
3. **Adopt a selection workflow:** generate 3–6 AI drafts per action, select the best, trim/crop/pixelate in the existing app, and treat it as a raster clip—not a source that must be regenerated later.
4. **Start a Live2D proof of concept with one hero bust.** Prepare a layered PSD for face, eyes, eyelids, hair/front hair, neck, torso, each arm/hand, and any spell effect. Make idle, blink, look, hit, and cast. If that takes less time than repeatedly repairing AI drift across the next 20 actions, make it the production standard.
5. **Use Spine if the proof expands to full-body/enemy animation.** It will keep more of the game-animation pipeline in one reusable runtime.

## Bottom line

For *AI-only prompt-to-motion*, use **Wan 2.2 Fast**. It is inexpensive, fast enough, accepts a raw prompt in the hosted schema, and avoids Wan 2.7's expansion behavior.

For *the best finished tool for these repeated bust animations*, use **Live2D Cubism**. It is the only option in this comparison that can actually give you predictable, centered, repeatable motions from the same character instead of asking a video model to invent them every time.
