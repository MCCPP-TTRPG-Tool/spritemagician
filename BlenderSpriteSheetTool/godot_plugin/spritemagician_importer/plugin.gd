@tool
extends EditorPlugin

const IMPORTER := preload("res://addons/spritemagician_importer/importer.gd")

var manifest_dialog: EditorFileDialog
var save_dialog: EditorFileDialog
var pending_manifest_path := ""


func _enter_tree() -> void:
	add_tool_menu_item("Sprite Magician: Import Manifest", _on_import_menu_pressed)
	_create_dialogs()


func _exit_tree() -> void:
	remove_tool_menu_item("Sprite Magician: Import Manifest")
	if is_instance_valid(manifest_dialog):
		manifest_dialog.queue_free()
	if is_instance_valid(save_dialog):
		save_dialog.queue_free()


func _create_dialogs() -> void:
	manifest_dialog = EditorFileDialog.new()
	manifest_dialog.file_mode = EditorFileDialog.FILE_MODE_OPEN_FILE
	manifest_dialog.access = EditorFileDialog.ACCESS_RESOURCES
	manifest_dialog.title = "Select Sprite Magician manifest.json"
	manifest_dialog.add_filter("*.json ; JSON Files")
	manifest_dialog.file_selected.connect(_on_manifest_selected)
	get_editor_interface().get_base_control().add_child(manifest_dialog)

	save_dialog = EditorFileDialog.new()
	save_dialog.file_mode = EditorFileDialog.FILE_MODE_OPEN_DIR
	save_dialog.access = EditorFileDialog.ACCESS_RESOURCES
	save_dialog.title = "Select output folder for SpriteFrames resources"
	save_dialog.dir_selected.connect(_on_save_dir_selected)
	get_editor_interface().get_base_control().add_child(save_dialog)


func _on_import_menu_pressed() -> void:
	manifest_dialog.popup_centered_ratio()


func _on_manifest_selected(path: String) -> void:
	pending_manifest_path = path
	save_dialog.current_dir = "res://spriteframes"
	save_dialog.popup_centered_ratio()


func _on_save_dir_selected(save_dir: String) -> void:
	if pending_manifest_path == "":
		push_warning("Sprite Magician Importer: No manifest selected.")
		return

	var result: Dictionary = IMPORTER.import_manifest_to_spriteframes(pending_manifest_path, save_dir)
	if result.is_empty():
		push_warning("Sprite Magician Importer: Import finished with no resources generated.")
	else:
		print("Sprite Magician Import complete:")
		for action_name in result.keys():
			print(" - ", action_name, " -> ", result[action_name])
		get_editor_interface().get_resource_filesystem().scan()

	pending_manifest_path = ""

