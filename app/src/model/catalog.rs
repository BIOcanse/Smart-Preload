use super::*;

#[derive(Debug, Clone, Copy)]
pub(super) struct ManagedModelSpec {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) backend_model_name: &'static str,
}

pub(super) const OLLAMA_API_BASE_URL: &str = "http://127.0.0.1:11434/api";
pub(super) const OLLAMA_RUNTIME_ID: &str = "ollama-runtime";
pub(super) const OLLAMA_RUNTIME_LABEL: &str = "Ollama runtime";
pub(super) const OLLAMA_HOST: &str = "127.0.0.1:11434";
pub(super) const OLLAMA_PORTABLE_ROOT_DIR: &str = "portable";
pub(super) const OLLAMA_RUNTIME_DIR: &str = "runtime\\ollama";
pub(super) const OLLAMA_MODELS_DIR: &str = "models\\ollama";
pub(super) const OLLAMA_WINDOWS_AMD64_ZIP: &str =
    "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip";
pub(super) const OLLAMA_WINDOWS_ARM64_ZIP: &str =
    "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-arm64.zip";
pub(super) const OLLAMA_API_WAIT_TIMEOUT: Duration = Duration::from_secs(45);
pub(super) const OLLAMA_API_POLL_INTERVAL: Duration = Duration::from_millis(500);

pub(super) static OLLAMA_CHILD_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

pub(super) const MANAGED_MODEL_SPECS: &[ManagedModelSpec] = &[
    ManagedModelSpec {
        id: "qwen3-0.6b",
        label: "Qwen3 0.6B",
        backend_model_name: "qwen3:0.6b",
    },
    ManagedModelSpec {
        id: "qwen3-1.7b",
        label: "Qwen3 1.7B",
        backend_model_name: "qwen3:1.7b",
    },
    ManagedModelSpec {
        id: "qwen3-4b",
        label: "Qwen3 4B",
        backend_model_name: "qwen3:4b",
    },
    ManagedModelSpec {
        id: "gemma4-e2b",
        label: "Gemma 4 E2B",
        backend_model_name: "gemma4:e2b",
    },
    ManagedModelSpec {
        id: "gemma4-e4b",
        label: "Gemma 4 E4B",
        backend_model_name: "gemma4:e4b",
    },
];

pub(super) fn get_model_spec(model_id: &str) -> Result<&'static ManagedModelSpec> {
    MANAGED_MODEL_SPECS
        .iter()
        .find(|spec| spec.id == model_id)
        .ok_or_else(|| anyhow!("unsupported managed model id: {model_id}"))
}

pub(super) fn model_name_matches(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

pub(super) fn ollama_child_slot() -> &'static Mutex<Option<Child>> {
    OLLAMA_CHILD_PROCESS.get_or_init(|| Mutex::new(None))
}
