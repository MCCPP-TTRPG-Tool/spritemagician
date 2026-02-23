# Sprite Magician Godot Plugin (Godot 4)

## Install

1. Copy folder:
   - `godot_plugin/spritemagician_importer`
   to:
   - `res://addons/spritemagician_importer`
2. In Godot: `Project > Project Settings > Plugins`
3. Enable `SpriteMagician Importer`

## Use

1. In Godot top menu: `Project > Tools` (tool menu)
2. Click `Sprite Magician: Import Manifest`
3. Pick your `manifest.json` (inside `res://`)
4. Pick output folder for generated `.spriteframes.tres`

### Batch Use

1. In Godot top menu: `Project > Tools`
2. Click `Sprite Magician: Import Manifest Folder`
3. Select a folder; plugin recursively finds all `manifest.json` files
4. Pick output folder for generated `.spriteframes.tres`

The plugin creates `unit_action.spriteframes.tres` resources with 16 direction animations:
- `action_n`, `action_nne`, `action_ne`, ... `action_nnw`

