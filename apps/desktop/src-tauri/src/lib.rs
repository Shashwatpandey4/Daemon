mod sync;

use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Copies a file into the app's data dir under `files/<space_id>/`.
/// Returns the absolute destination path.
#[tauri::command]
fn import_file(
    app: tauri::AppHandle,
    space_id: String,
    src: String,
) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    let file_name = src_path
        .file_name()
        .ok_or("invalid file path")?
        .to_string_lossy()
        .to_string();

    let dest_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("files")
        .join(&space_id);

    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    // Avoid overwriting: append a counter if name already exists
    let mut dest_path = dest_dir.join(&file_name);
    if dest_path.exists() {
        let stem = src_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = src_path
            .extension()
            .map(|s| format!(".{}", s.to_string_lossy()))
            .unwrap_or_default();
        let mut counter = 1u32;
        loop {
            dest_path = dest_dir.join(format!("{stem}_{counter}{ext}"));
            if !dest_path.exists() { break; }
            counter += 1;
        }
    }

    std::fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![local_ip, import_file])
        .setup(|app| {
            let db_path = app
                .path()
                .app_local_data_dir()
                .expect("no local data dir")
                .join("daemon.db");

            sync::advertise_and_serve(db_path);

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
