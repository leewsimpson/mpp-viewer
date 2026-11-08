use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;

/// A file the OS asked us to open (double-click / "Open With") before the
/// window was ready to receive it. The UI collects it on startup.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

/// Locations of the bundled Java runtime and converter jar.
struct Converter {
    java: PathBuf,
    jar: PathBuf,
}

fn find_converter(app: &AppHandle) -> Result<Converter, String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        roots.push(res.join("converter"));
    }
    // During `tauri dev`, fall back to the freshly built copy in the repo.
    #[cfg(debug_assertions)]
    roots.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../converter/dist"));

    for root in &roots {
        let jar = root.join("mpp-converter.jar");
        let java = root.join("runtime/bin/java");
        if jar.is_file() && java.is_file() {
            return Ok(Converter { java, jar });
        }
    }
    Err(format!(
        "The bundled file reader is missing. Run scripts/build-converter.sh and rebuild. Looked in: {}",
        roots
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.mode() & 0o111 == 0 {
            perms.set_mode(perms.mode() | 0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) {}

/// Reads a project file with the bundled MPXJ converter and returns its JSON.
/// Runs entirely on this machine; nothing is sent anywhere.
#[tauri::command]
async fn open_project(app: AppHandle, path: String) -> Result<String, String> {
    let conv = find_converter(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        ensure_executable(&conv.java);
        let output = Command::new(&conv.java)
            .arg("-Xss8m")
            .arg("-Djava.awt.headless=true")
            .arg("-jar")
            .arg(&conv.jar)
            .arg(&path)
            .env_remove("JAVA_TOOL_OPTIONS")
            .output()
            .map_err(|e| format!("Could not start the file reader: {e}"))?;

        if output.status.success() {
            String::from_utf8(output.stdout).map_err(|e| format!("Unexpected output: {e}"))
        } else {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if err.is_empty() {
                "The file could not be read.".to_string()
            } else {
                err
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Returns (and clears) any file the OS asked us to open at launch.
#[tauri::command]
fn take_pending_file(pending: State<PendingFile>) -> Option<String> {
    pending.0.lock().ok().and_then(|mut p| p.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFile::default())
        .invoke_handler(tauri::generate_handler![open_project, take_pending_file])
        .build(tauri::generate_context!())
        .expect("error while building MPP Viewer");

    app.run(|_app, _event| {
        // macOS delivers double-clicked / "Open With" files as an Opened event.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path = path.display().to_string();
                    if let Some(state) = _app.try_state::<PendingFile>() {
                        if let Ok(mut p) = state.0.lock() {
                            *p = Some(path.clone());
                        }
                    }
                    let _ = _app.emit("open-file", path);
                }
            }
        }
    });
}
