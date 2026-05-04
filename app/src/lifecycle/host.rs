use super::*;

pub(crate) fn acquire_host_guard() -> Result<Option<SingleInstance>> {
    acquire_single_instance(HOST_INSTANCE_NAME)
}

fn acquire_single_instance(name: &str) -> Result<Option<SingleInstance>> {
    let guard = SingleInstance::new(name).context("failed to create single-instance guard")?;

    if guard.is_single() {
        Ok(Some(guard))
    } else {
        Ok(None)
    }
}
