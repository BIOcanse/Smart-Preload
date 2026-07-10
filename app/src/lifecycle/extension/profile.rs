use std::fs;
use std::path::PathBuf;

use super::super::browser_user_data_roots;

pub(super) struct ChromeProfileDiscovery {
    pub(super) directories: Vec<PathBuf>,
    pub(super) partial_failure: bool,
}

pub(super) fn chrome_profile_directories() -> Vec<PathBuf> {
    discover_chrome_profile_directories().directories
}

pub(super) fn discover_chrome_profile_directories() -> ChromeProfileDiscovery {
    let mut directories = Vec::new();
    let mut partial_failure = false;

    for user_data_root in browser_user_data_roots() {
        push_chrome_profile_directory_if_present(&mut directories, user_data_root.join("Default"));
        push_chrome_profile_directory_if_present(&mut directories, user_data_root.join("Profile"));

        let entries = match fs::read_dir(&user_data_root) {
            Ok(entries) => entries,
            Err(_) => {
                partial_failure = true;
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    partial_failure = true;
                    continue;
                }
            };
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

    ChromeProfileDiscovery {
        directories,
        partial_failure,
    }
}

fn push_chrome_profile_directory_if_present(directories: &mut Vec<PathBuf>, path: PathBuf) {
    if !path.is_dir() || directories.iter().any(|directory| directory == &path) {
        return;
    }

    directories.push(path);
}
