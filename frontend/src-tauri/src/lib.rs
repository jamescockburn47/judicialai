pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // In production builds, launch the backend sidecar.
            // Pass the resource directory so the backend can find bundled documents.
            #[cfg(not(debug_assertions))]
            {
                use tauri::Manager;
                use tauri_plugin_shell::ShellExt;

                let resource_dir = app
                    .path()
                    .resource_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                // The backend reads DOCUMENTS_PATH from env to find case documents.
                // When bundled, documents live in the app's resource directory.
                let docs_path = format!("{}/documents", resource_dir);

                let shell = app.shell();
                match shell.sidecar("bs-detector") {
                    Ok(sidecar) => {
                        let sidecar_with_env = sidecar
                            .env("DOCUMENTS_PATH", &docs_path);
                        if let Err(e) = sidecar_with_env.spawn() {
                            eprintln!("Warning: failed to spawn bs-detector sidecar: {}", e);
                        }
                    }
                    Err(e) => {
                        eprintln!("Warning: bs-detector sidecar not found: {}", e);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Judicial Review");
}
