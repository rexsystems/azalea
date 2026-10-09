#[derive(Debug, PartialEq, Eq)]
pub enum Intent {
    Arm,
    Show,
    Status,
    Help,
    Wake(String),
    /// Spoken question for the configured AI provider. Prefix-gated only.
    AskAi(String),
    Unknown,
}

pub fn normalize(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|character| match character {
            'ă' | 'â' => 'a',
            'î' => 'i',
            'ș' | 'ş' => 's',
            'ț' | 'ţ' => 't',
            value if value.is_alphanumeric() => value,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse(text: &str, armed: bool) -> Option<Intent> {
    let normalized = normalize(text);
    let mut command = normalized.as_str();
    let mut activated = false;
    for phrase in [
        "hey azalea",
        "hei azalea",
        "hey azalia",
        "hei azalia",
        "hey azaleea",
        "hei azaleea",
    ] {
        if command == phrase {
            return Some(Intent::Arm);
        }
        if let Some(next) = command.strip_prefix(&format!("{phrase} ")) {
            command = next;
            activated = true;
            break;
        }
    }
    if !activated && !armed {
        return None;
    }
    if [
        "open",
        "open azalea",
        "show azalea",
        "show window",
        "deschide azalea",
        "deschide aplicatia",
    ]
    .contains(&command)
    {
        return Some(Intent::Show);
    }
    if ["status", "are you there", "esti acolo"].contains(&command) {
        return Some(Intent::Status);
    }
    if ["help", "ajutor", "what can you do", "ce poti face"].contains(&command) {
        return Some(Intent::Help);
    }
    for prefix in [
        "ask ai",
        "ask",
        "question",
        "intreaba ai",
        "intreaba",
        "intrebare",
    ] {
        if command == prefix {
            return Some(Intent::AskAi(String::new()));
        }
        if let Some(question) = command.strip_prefix(&format!("{prefix} ")) {
            let question = question.trim();
            if !question.is_empty() {
                return Some(Intent::AskAi(question.to_owned()));
            }
            return Some(Intent::AskAi(String::new()));
        }
    }
    for prefix in [
        "wake up server",
        "wake server",
        "start server",
        "porneste serverul",
        "trezeste serverul",
        "wake up",
        "wake",
    ] {
        if command == prefix {
            return Some(Intent::Wake(String::new()));
        }
        if let Some(host) = command.strip_prefix(&format!("{prefix} ")) {
            return Some(Intent::Wake(host.to_owned()));
        }
    }
    Some(Intent::Unknown)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_require_activation_and_never_interpret_shell_instructions() {
        assert_eq!(parse("wake up server alpha", false), None);
        assert_eq!(
            parse("Hey Azalea, wake up server Alpha!", false),
            Some(Intent::Wake("alpha".into()))
        );
        assert_eq!(
            parse("Hei Azalea, pornește serverul Acasă", false),
            Some(Intent::Wake("acasa".into()))
        );
        assert_eq!(
            parse("Hey Azalea don't wake server alpha", false),
            Some(Intent::Unknown)
        );
        assert_eq!(parse("hey azalea run rm -rf", false), Some(Intent::Unknown));
        assert_eq!(
            parse("Hey Azalea ask ai what is uptime", false),
            Some(Intent::AskAi("what is uptime".into()))
        );
        assert_eq!(
            parse("Hei Azalea intreaba cat e ora", false),
            Some(Intent::AskAi("cat e ora".into()))
        );
        assert_eq!(
            parse("wake server alpha", true),
            Some(Intent::Wake("alpha".into()))
        );
        assert_eq!(parse("Hey Azalea", false), Some(Intent::Arm));
    }
}
