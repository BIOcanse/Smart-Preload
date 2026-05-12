use anyhow::{Context, Result};
use std::io::{self, Write};

pub(super) fn write_native_message(value: &serde_json::Value) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    let length = u32::try_from(payload.len()).context("native messaging response is too large")?;
    let mut stdout = io::stdout();
    stdout.write_all(&length.to_le_bytes())?;
    stdout.write_all(&payload)?;
    stdout.flush()?;
    Ok(())
}
