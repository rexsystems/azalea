const SERVICE_NAME: &str = "azalea";

pub fn store_host_password(host_id: &str, password: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("host-password-{host_id}"))?;
    entry.set_password(password)?;
    Ok(())
}

pub fn get_host_password(host_id: &str) -> anyhow::Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("host-password-{host_id}"))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

pub fn delete_host_password(host_id: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("host-password-{host_id}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub fn store_private_key(key_id: &str, private_key_pem: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("ssh-key-{key_id}"))?;
    entry.set_password(private_key_pem)?;
    Ok(())
}

pub fn get_private_key(key_id: &str) -> anyhow::Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("ssh-key-{key_id}"))?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

pub fn delete_private_key(key_id: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("ssh-key-{key_id}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}
