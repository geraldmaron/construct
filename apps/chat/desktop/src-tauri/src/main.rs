#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn resolve_chat_url() -> String {
    let args: Vec<String> = std::env::args().collect();
    for (index, arg) in args.iter().enumerate() {
        if arg == "--url" {
            if let Some(url) = args.get(index + 1) {
                return url.clone();
            }
        }
    }
    std::env::var("CONSTRUCT_CHAT_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:4242/chat/?surface=desktop".to_string())
}

fn main() {
    let chat_url = resolve_chat_url();
    let parsed = chat_url
        .parse()
        .unwrap_or_else(|_| panic!("invalid chat URL: {chat_url}"));

    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .title("Construct Chat")
                .inner_size(1280.0, 840.0)
                .min_inner_size(720.0, 480.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Construct chat desktop failed to start");
}
