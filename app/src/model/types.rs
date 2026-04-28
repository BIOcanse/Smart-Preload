use super::*;

#[derive(Debug, Deserialize)]
pub(super) struct OllamaVersionResponse {
    pub(super) version: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct OllamaGenerateResponse {
    pub(super) response: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct OllamaTagsResponse {
    pub(super) models: Vec<OllamaTagModel>,
}

#[derive(Debug, Deserialize)]
pub(super) struct OllamaTagModel {
    pub(super) name: String,
    #[serde(default)]
    pub(super) model: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ManagedAiRuntimeStatus {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub api_available: bool,
    pub version: Option<String>,
    pub executable_path: Option<String>,
    pub runtime_directory: String,
    pub models_directory: String,
}

#[derive(Debug, Serialize)]
pub struct ManagedAiModelStatus {
    pub id: String,
    pub label: String,
    pub backend_model_name: String,
    pub runtime_id: String,
    pub downloaded: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InvokeManagedModelRequest {
    pub model_id: String,
    pub prompt: String,
    #[serde(default)]
    pub response_format: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvokeManagedModelResponse {
    pub model_id: String,
    pub runtime_id: String,
    pub backend_model_name: String,
    pub output_text: String,
}

#[derive(Debug, Serialize)]
pub struct AiModelManagerStatus {
    pub supported: bool,
    pub provider: String,
    pub portable_root: String,
    pub runtimes: Vec<ManagedAiRuntimeStatus>,
    pub models: Vec<ManagedAiModelStatus>,
}

#[derive(Debug, Deserialize)]
pub struct ManageModelRequest {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiProgress {
    pub model_id: String,
    pub action: String,
    pub stage: String,
    pub message: String,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub started_at_ms: u64,
    pub updated_at_ms: u64,
    pub finished: bool,
    pub error: Option<String>,
}
