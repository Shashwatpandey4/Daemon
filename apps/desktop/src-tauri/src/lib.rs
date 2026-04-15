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

/// Deletes a folder and all its contents from disk.
#[tauri::command]
fn delete_folder(folder_path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&folder_path);
    if path.exists() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Writes UTF-8 text content to a file on disk.
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// Reads a file from disk and returns raw bytes over the binary IPC channel.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read '{}': {}", path, e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Fetches an ICS calendar URL and parses out VEVENT entries.
/// Returns [{uid, title, date}] where date is YYYY-MM-DD.
#[tauri::command]
async fn fetch_and_parse_ics(url: String) -> Result<Vec<serde_json::Value>, String> {
    // webcal:// → https://
    let url = if url.starts_with("webcal://") {
        url.replacen("webcal://", "https://", 1)
    } else {
        url
    };

    let text = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to fetch calendar: {}", e))?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    // Unfold ICS lines (continuation lines start with SPACE or TAB)
    let unfolded = text
        .replace("\r\n ", "").replace("\r\n\t", "")
        .replace("\n ", "").replace("\n\t", "");

    let mut events: Vec<serde_json::Value> = Vec::new();
    let mut in_event = false;
    let mut uid = String::new();
    let mut title = String::new();
    let mut date = String::new();
    let mut rrule = String::new();
    let mut exdates: Vec<String> = Vec::new();
    // Skip VEVENT overrides for specific recurrence instances (RECURRENCE-ID present)
    let mut is_override = false;

    for line in unfolded.lines() {
        let line = line.trim_end_matches('\r');
        if line == "BEGIN:VEVENT" {
            in_event = true;
            uid.clear(); title.clear(); date.clear(); rrule.clear(); exdates.clear();
            is_override = false;
        } else if line == "END:VEVENT" {
            if in_event && !date.is_empty() && !title.is_empty() && !is_override {
                events.push(serde_json::json!({
                    "uid": uid,
                    "title": title,
                    "date": date,
                    "rrule": rrule,
                    "exdates": exdates,
                }));
            }
            in_event = false;
        } else if in_event {
            if let Some(colon) = line.find(':') {
                let prop = &line[..colon];
                let val = &line[colon + 1..];
                let prop_name = prop.split(';').next().unwrap_or(prop).to_uppercase();
                match prop_name.as_str() {
                    "UID" => uid = val.trim().to_string(),
                    "SUMMARY" => {
                        title = val
                            .replace("\\n", " ").replace("\\N", " ")
                            .replace("\\,", ",").replace("\\;", ";")
                            .replace("\\\\", "\\");
                    }
                    "DTSTART" => {
                        let v = val.trim();
                        if v.len() >= 8 {
                            let d = &v[..8];
                            if d.chars().all(|c| c.is_ascii_digit()) {
                                date = format!("{}-{}-{}", &d[..4], &d[4..6], &d[6..8]);
                            }
                        }
                    }
                    "RRULE" => rrule = val.trim().to_string(),
                    "RECURRENCE-ID" => is_override = true,
                    "EXDATE" => {
                        // May be comma-separated list of datetimes
                        for part in val.split(',') {
                            let p = part.trim();
                            if p.len() >= 8 {
                                let d = &p[..8];
                                if d.chars().all(|c| c.is_ascii_digit()) {
                                    exdates.push(format!("{}-{}-{}", &d[..4], &d[4..6], &d[6..8]));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(events)
}

/// Downloads a URL to a local file path (used for arXiv PDF import).
#[tauri::command]
async fn download_file(url: String, dest_path: String) -> Result<(), String> {
    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::write(&dest_path, &bytes).map_err(|e| e.to_string())
}

/// Fetches arXiv metadata (title, authors, abstract) for a given arXiv ID.
#[tauri::command]
async fn fetch_arxiv_metadata(arxiv_id: String) -> Result<serde_json::Value, String> {
    let url = format!("https://export.arxiv.org/api/query?id_list={}", arxiv_id);
    let xml = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    fn extract_tag(s: &str, tag: &str) -> Option<String> {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        let start = s.find(&open)? + open.len();
        let end = s[start..].find(&close)? + start;
        Some(s[start..end].trim().to_string())
    }

    let title = extract_tag(&xml, "title")
        .unwrap_or_default()
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let abstract_text = extract_tag(&xml, "summary")
        .unwrap_or_default()
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    // Collect all <name> tags inside <author> blocks
    let mut authors: Vec<String> = Vec::new();
    let mut rest = xml.as_str();
    while let Some(start) = rest.find("<name>") {
        let start = start + "<name>".len();
        if let Some(end) = rest[start..].find("</name>") {
            authors.push(rest[start..start + end].trim().to_string());
            rest = &rest[start + end + "</name>".len()..];
        } else {
            break;
        }
    }

    // If no entry found (bad ID), title will be "Error" or empty
    if title.is_empty() || title.to_lowercase().contains("error") {
        return Err(format!("arXiv ID '{}' not found", arxiv_id));
    }

    Ok(serde_json::json!({
        "title": title,
        "authors": authors,
        "abstract": abstract_text,
        "pdf_url": format!("https://arxiv.org/pdf/{}", arxiv_id),
    }))
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
        .invoke_handler(tauri::generate_handler![local_ip, import_file, open_file, setup_space_folder, scan_space_folder, list_daemon_folders, read_file_bytes, write_text_file, delete_folder, download_file, fetch_arxiv_metadata, fetch_and_parse_ics])
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
