use std::io::{Read, Write};
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

fn main() -> anyhow::Result<()> {
    let pty = native_pty_system().openpty(PtySize {
        rows: 30,
        cols: 120,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.cwd(std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into()));

    let mut child = pty.slave.spawn_command(cmd)?;
    drop(pty.slave);

    let mut reader = pty.master.try_clone_reader()?;
    let mut writer = pty.master.take_writer()?;

    let reader_handle = std::thread::spawn(move || {
        let mut total = 0usize;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    total += n;
                    print!("{}", String::from_utf8_lossy(&buf[..n]));
                }
            }
        }
        println!("\n--- reader done, {total} bytes total ---");
    });

    std::thread::sleep(Duration::from_secs(3));
    writer.write_all(b"echo AZALEA_TEST_OK\r")?;
    writer.flush()?;
    std::thread::sleep(Duration::from_secs(3));
    writer.write_all(b"exit\r")?;
    writer.flush()?;

    let status = child.wait()?;
    println!("--- child exited: {status:?} ---");
    drop(pty.master);
    let _ = reader_handle.join();
    Ok(())
}
