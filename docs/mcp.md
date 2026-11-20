# AI tools (MCP)

Azalea can run a small local server that speaks the [Model Context Protocol](https://modelcontextprotocol.io), so an AI tool such as Claude Code, Codex or Cursor can work with your hosts and keys. It is off by default and desktop only.

## Turn it on

Settings → AI → AI tools (MCP) → **Let AI tools use Azalea**. Azalea listens on `http://127.0.0.1:47821/mcp` (the port can be changed). Press **Connect to Claude Code** and Azalea registers itself with the `claude` CLI for your user (start a new Claude Code session afterwards). For other clients, copy the ready-made command or JSON config from the same screen, for example:

```sh
claude mcp add --transport http azalea http://127.0.0.1:47821/mcp \
  --header "Authorization: Bearer <access token>"
```

## What a client can do

Reading is always allowed once the server is on:

| Tool | Result |
| --- | --- |
| `list_hosts`, `list_groups`, `list_snippets` | What is saved in Azalea. Passwords are never included. |
| `list_keys` | Name, public key and fingerprint. Private keys are never included. |

Each group below has its own switch and is off until you enable it:

| Switch | Tools |
| --- | --- |
| SSH keys | `generate_key`, `install_public_key`, `delete_key` |
| Hosts | `add_host`, `update_host`, `delete_host` |
| Run commands | `run_command` |
| Files | `list_directory`, `read_file`, `write_file` |

Tools whose switch is off are not listed to the client and are refused if called.

## Safety

- The server binds to 127.0.0.1 only. Requests need the bearer token, a loopback `Host` header, and no `Origin` header, so a web page cannot talk to it.
- The token lives in the OS keychain. **New token** in settings invalidates the old one.
- **Ask me before changes** (on by default) shows a native dialog for every command, file write and key install, with the full command. Deleting a key or host always asks.
- `run_command`, `list_directory`, `read_file` and `write_file` open their own connection and only work for hosts whose server key you already trusted by connecting once in Azalea. An AI tool cannot accept a new or changed server key.
- `add_host` does not take passwords, so secrets stay out of the AI conversation. Use `generate_key` then `install_public_key`.
- Command output is capped at 256 KiB per stream, files read at 1 MiB, files written at 2 MiB.
- Settings shows the most recent tool calls and how they ended.
