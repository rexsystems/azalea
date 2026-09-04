use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};

use crate::models::WakeOnLanInput;

/// Parse MAC addresses like `AA:BB:CC:DD:EE:FF`, `AA-BB-...`, or `AABBCCDDEEFF`.
fn parse_mac(raw: &str) -> anyhow::Result<[u8; 6]> {
    let hex: String = raw
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_lowercase();

    if hex.len() != 12 {
        anyhow::bail!("MAC address must be 6 bytes (e.g. AA:BB:CC:DD:EE:FF)");
    }

    let mut mac = [0u8; 6];
    for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
        mac[i] = u8::from_str_radix(std::str::from_utf8(chunk)?, 16)?;
    }
    Ok(mac)
}

fn magic_packet(mac: &[u8; 6]) -> [u8; 102] {
    let mut packet = [0u8; 102];
    packet[..6].fill(0xff);
    for i in 0..16 {
        let start = 6 + i * 6;
        packet[start..start + 6].copy_from_slice(mac);
    }
    packet
}

fn resolve_broadcast(raw: Option<&str>) -> Ipv4Addr {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => s.parse::<Ipv4Addr>().unwrap_or(Ipv4Addr::BROADCAST),
        None => Ipv4Addr::BROADCAST,
    }
}

/// Sends a Wake-on-LAN magic packet over UDP broadcast (port 9).
pub fn send_wake_on_lan(mac_address: &str, broadcast: Option<&str>) -> anyhow::Result<()> {
    let mac = parse_mac(mac_address)?;
    let packet = magic_packet(&mac);
    let dest_ip = resolve_broadcast(broadcast);
    let dest = SocketAddrV4::new(dest_ip, 9);

    let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0))?;
    socket.set_broadcast(true)?;
    socket.send_to(&packet, dest)?;

    // Also hit the classic alternate port used by some NICs.
    let _ = socket.send_to(&packet, SocketAddrV4::new(dest_ip, 7));

    // If a directed IP was given, also flood the subnet broadcast for good measure.
    if dest_ip != Ipv4Addr::BROADCAST {
        let _ = socket.send_to(&packet, SocketAddrV4::new(Ipv4Addr::BROADCAST, 9));
    }

    Ok(())
}

#[tauri::command]
pub fn wake_on_lan(input: WakeOnLanInput) -> Result<(), String> {
    send_wake_on_lan(
        &input.mac_address,
        input.broadcast.as_deref(),
    )
    .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_mac_formats() {
        assert_eq!(
            parse_mac("AA:BB:CC:DD:EE:FF").unwrap(),
            [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]
        );
        assert_eq!(
            parse_mac("aa-bb-cc-dd-ee-ff").unwrap(),
            [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]
        );
        assert_eq!(
            parse_mac("AABBCCDDEEFF").unwrap(),
            [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]
        );
    }

    #[test]
    fn builds_magic_packet() {
        let mac = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
        let packet = magic_packet(&mac);
        assert_eq!(&packet[..6], &[0xff; 6]);
        assert_eq!(&packet[6..12], &mac);
        assert_eq!(&packet[96..102], &mac);
    }
}
