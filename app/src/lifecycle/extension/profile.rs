use std::fs;
use std::path::PathBuf;

use super::super::browser_user_data_roots;

pub(super) fn chrome_profile_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();

    for user_data_root in browser_user_data_roots() {
        push_chrome_profile_directory_if_present(&mut directories, user_data_root.join("Default"));
        push_chrome_profile_directory_if_present(&mut directories, user_data_root.join("Profile"));

        let Ok(entries) = fs::read_dir(&user_data_root) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|file_name| file_name.to_str()) else {
                continue;
            };

            if !path.is_dir() {
                continue;
            }

            if name.starts_with("Profile ")
                || path.join("Preferences").is_file()
                || path.join("Secure Preferences").is_file()
            {
                push_chrome_profile_directory_if_present(&mut directories, path);
            }
        }
    }

    directories
}

fn push_chrome_profile_directory_if_present(directories: &mut Vec<PathBuf>, path: PathBuf) {
    if !path.is_dir() || directories.iter().any(|directory| directory == &path) {
        return;
    }

    directories.push(path);
}
