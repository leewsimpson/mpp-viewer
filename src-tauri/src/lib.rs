use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;
use tauri::{AppHandle, Manager, State};

/// Longest a single file may take to convert before we give up on it.
const CONVERT_TIMEOUT: Duration = Duration::from_secs(120);

/// A file the OS asked us to open (double-click / "Open With") before the
/// window was ready to receive it. The UI collects it on startup.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

/// Held while the converter runs, so only one JVM runs at a time and two runs
/// never write the class-data-sharing archive at once.
#[derive(Default)]
struct ConverterLock(Mutex<()>);

/// Locations of the bundled Java runtime and converter jar.
struct Converter {
    java: PathBuf,
    jar: PathBuf,
    /// Per-user class-data-sharing archive. The JVM writes it on the first run
    /// and reuses it after that, which makes opening a file about 40% faster.
    cds_archive: Option<PathBuf>,
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
            // Named by version: the archive only matches the jars it was made from.
            let version = app.package_info().version.to_string();
            let cds_archive = app
                .path()
                .app_cache_dir()
                .ok()
                .filter(|dir| std::fs::create_dir_all(dir).is_ok())
                .map(|dir| dir.join(format!("converter-{version}.jsa")));
            return Ok(Converter {
                java,
                jar,
                cds_archive,
            });
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

/// Why a converter run failed.
struct Failure {
    message: String,
    /// The JVM itself failed rather than the converter rejecting the file, so a
    /// run without the class-data-sharing archive may succeed.
    jvm_problem: bool,
}

impl Failure {
    fn new(message: impl Into<String>) -> Self {
        Failure {
            message: message.into(),
            jvm_problem: false,
        }
    }
}

/// Runs the converter once. JVM options (stack size, compiler, headless and
/// logging) are baked into the bundled runtime by scripts/build-converter.sh.
fn run_converter(conv: &Converter, path: &str, use_cds: bool) -> Result<String, Failure> {
    let mut cmd = Command::new(&conv.java);
    if let (true, Some(archive)) = (use_cds, &conv.cds_archive) {
        cmd.arg("-XX:+AutoCreateSharedArchive")
            .arg(format!("-XX:SharedArchiveFile={}", archive.display()));
    }
    let mut child = cmd
        .arg("-jar")
        .arg(&conv.jar)
        .arg(path)
        .env_remove("JAVA_TOOL_OPTIONS")
        .env_remove("JDK_JAVA_OPTIONS")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Failure::new(format!("Could not start the file reader: {e}")))?;

    // Drain both pipes on their own threads so a large plan can't fill a pipe
    // buffer and stall the converter while we wait for it.
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let out = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let err = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > CONVERT_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Failure::new(
                    "Reading the file took too long, so it was stopped.",
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(Failure::new(format!("The file reader failed: {e}"))),
        }
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();

    if status.success() {
        String::from_utf8(stdout).map_err(|e| Failure::new(format!("Unexpected output: {e}")))
    } else {
        // Keep the converter's own message; drop any JVM log lines such as
        // "[0.5s][error][cds] ..." or "OpenJDK 64-Bit Server VM warning: ...".
        let err = String::from_utf8_lossy(&stderr)
            .lines()
            .filter(|l| !l.starts_with('[') && !l.contains("VM warning:"))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
        Err(Failure {
            message: if err.is_empty() {
                "The file could not be read.".to_string()
            } else {
                err
            },
            // Exit code 2 is the converter reporting a file it can't read.
            jvm_problem: status.code() != Some(2),
        })
    }
}

/// Reads a project file with the bundled MPXJ converter and returns its JSON.
/// Runs entirely on this machine; nothing is sent anywhere.
#[tauri::command]
async fn open_project(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let conv = find_converter(&app)?;
    let json = tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<ConverterLock>();
        let _guard = lock.0.lock().unwrap_or_else(|e| e.into_inner());
        ensure_executable(&conv.java);
        match run_converter(&conv, &path, true) {
            // The JVM fails the run if it can't write or map the archive (full
            // disk, permissions), so discard it and try once more without it.
            Err(f) if f.jvm_problem && conv.cds_archive.is_some() => {
                if let Some(archive) = &conv.cds_archive {
                    let _ = std::fs::remove_file(archive);
                }
                run_converter(&conv, &path, false)
            }
            result => result,
        }
        .map_err(|f| f.message)
    })
    .await
    .map_err(|e| e.to_string())??;
    // The converter's output is already JSON, so hand it to the UI as-is
    // rather than wrapping it in a JSON string.
    Ok(tauri::ipc::Response::new(json))
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
        .manage(ConverterLock::default())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The converter built by scripts/build-converter.sh, if it has been built.
    fn built_converter(cds_archive: Option<PathBuf>) -> Option<Converter> {
        let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../converter/dist");
        let conv = Converter {
            java: dist.join("runtime/bin/java"),
            jar: dist.join("mpp-converter.jar"),
            cds_archive,
        };
        if conv.java.is_file() && conv.jar.is_file() {
            Some(conv)
        } else {
            eprintln!("skipping: run scripts/build-converter.sh first");
            None
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mpp-viewer-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample() -> String {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../samples/office-fitout.xml")
            .display()
            .to_string()
    }

    #[test]
    fn converts_and_writes_class_archive() {
        let dir = temp_dir("cds");
        let archive = dir.join("converter.jsa");
        let Some(conv) = built_converter(Some(archive.clone())) else {
            return;
        };
        for _ in 0..2 {
            let json = run_converter(&conv, &sample(), true)
                .ok()
                .expect("conversion failed");
            let value: serde_json::Value =
                serde_json::from_str(&json).expect("stdout is pure JSON");
            assert!(value["tasks"].as_array().is_some_and(|t| !t.is_empty()));
        }
        assert!(
            archive.is_file(),
            "class-data-sharing archive was not written"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unreadable_file_is_reported_without_retry() {
        let dir = temp_dir("bad");
        let bad = dir.join("bad.mpp");
        std::fs::write(&bad, "not a project").unwrap();
        let Some(conv) = built_converter(None) else {
            return;
        };
        let failure =
            run_converter(&conv, &bad.display().to_string(), true).expect_err("should fail");
        assert!(!failure.jvm_problem);
        assert_eq!(failure.message.lines().count(), 1, "{}", failure.message);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn version_comes_from_package_json() {
        let ctx: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let pkg: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        assert_eq!(
            ctx.package_info().version.to_string(),
            pkg["version"].as_str().unwrap()
        );
    }

    #[test]
    fn unwritable_class_archive_is_a_jvm_problem() {
        // open_project retries without the archive in this case.
        let archive = PathBuf::from("/nonexistent-dir/converter.jsa");
        let Some(conv) = built_converter(Some(archive)) else {
            return;
        };
        let failure = run_converter(&conv, &sample(), true).expect_err("should fail");
        assert!(failure.jvm_problem);
        assert!(run_converter(&conv, &sample(), false).is_ok());
    }
}
