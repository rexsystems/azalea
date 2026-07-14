use std::collections::HashMap;
use std::path::PathBuf;

const CONFIG_KEYS: &[&str] = &["SUPABASE_URL", "SUPABASE_ANON_KEY", "AZALEA_WEB_URL"];

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let mut values = HashMap::new();

    load_env_file(&manifest_dir.join("supabase.public.env"), &mut values);
    load_env_file(&manifest_dir.join(".env"), &mut values);

    for key in CONFIG_KEYS {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                values.insert(key.to_string(), trimmed.to_string());
            }
        }
    }

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=supabase.public.env");
    println!("cargo:rerun-if-changed=.env");

    for key in CONFIG_KEYS {
        let Some(value) = values.get(*key) else {
            continue;
        };
        println!("cargo:rustc-env={key}={value}");
    }

    tauri_build::build();
}

fn load_env_file(path: &PathBuf, values: &mut HashMap<String, String>) {
    let Ok(iter) = dotenvy::from_path_iter(path) else {
        return;
    };

    for item in iter.flatten() {
        if CONFIG_KEYS.contains(&item.0.as_str()) {
            let trimmed = item.1.trim().to_string();
            if !trimmed.is_empty() {
                values.insert(item.0, trimmed);
            }
        }
    }
}
