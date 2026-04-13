mod sync;

use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Opens a file with the system default application.
#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns all immediate subdirectory paths inside ~/Daemon/.
#[tauri::command]
fn list_daemon_folders() -> Result<Vec<String>, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let daemon_dir = std::path::PathBuf::from(home).join("Daemon");
    if !daemon_dir.exists() {
        std::fs::create_dir_all(&daemon_dir).map_err(|e| e.to_string())?;
        return Ok(vec![]);
    }
    let entries = std::fs::read_dir(&daemon_dir).map_err(|e| e.to_string())?;
    let folders = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.path().to_string_lossy().to_string())
        .collect();
    Ok(folders)
}

/// Creates ~/Daemon/<sanitized-name>/ and returns the absolute path.
#[tauri::command]
fn setup_space_folder(name: String) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let sanitized: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect();
    let sanitized = sanitized.trim().to_string();
    let folder = std::path::PathBuf::from(home).join("Daemon").join(&sanitized);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder.to_string_lossy().to_string())
}

/// Lists all files (non-recursive) in a folder. Returns their absolute paths.
#[tauri::command]
fn scan_space_folder(folder_path: String) -> Result<Vec<String>, String> {
    let path = std::path::PathBuf::from(&folder_path);
    if !path.exists() {
        return Ok(vec![]);
    }
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let files = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .map(|e| e.path().to_string_lossy().to_string())
        .collect();
    Ok(files)
}

/// Reads a file from disk and returns raw bytes over the binary IPC channel.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read '{}': {}", path, e))?;
    Ok(tauri::ipc::Response::new(bytes))
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
        .invoke_handler(tauri::generate_handler![local_ip, import_file, open_file, setup_space_folder, scan_space_folder, list_daemon_folders, read_file_bytes])
        .setup(|app| {
            let db_path = app
                .path()
                .app_local_data_dir()
                .expect("no local data dir")
                .join("daemon.db");

            sync::advertise_and_serve(db_path);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
