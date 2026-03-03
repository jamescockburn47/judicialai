pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_shell::ShellExt;
                let shell = _app.shell();
                match shell.sidecar("bs-detector") {
                    Ok(sidecar) => {
                        if let Err(e) = sidecar.spawn() {
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
