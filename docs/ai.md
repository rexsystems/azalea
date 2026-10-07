# Terminal AI

Enable AI in **Settings → AI**, choose a provider, save its API key, and select a model. Ollama needs a running local server and no key.

Models are loaded from the provider's API. OpenAI's list is filtered for text chat; Anthropic catalogs use the Messages API's authentication and pagination. Custom IDs can be added in batches (newlines or commas), are saved per provider, and appear immediately in the chat model selector. Switching providers restores the previous model, endpoint, and region. Empty custom inputs stay empty.

Amazon Bedrock Runtime has no OpenAI-compatible model-list endpoint. Its built-in choices use the documented GPT-OSS Chat Completions IDs; add other supported IDs explicitly. Bedrock Mantle loads its own catalog. Model availability still depends on your account, region, and API compatibility. See the official [OpenAI Models API](https://developers.openai.com/api/reference/resources/models/methods/list), [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list), and [Bedrock Chat Completions documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html).

## Commands and approval

In **Agent → Confirm each command**, shell commands and file writes remain pending until approved. Approve executes the next action; Approve all executes the proposed batch in order. Agent waits for a shell completion marker and exit status before using the output to continue. Silence in the terminal does not mark a command as finished. Output is shown while the command runs; the latest 64,000 characters are retained for each command. The active shell must support POSIX shell syntax (bash, sh, zsh) or PowerShell on Windows. Interactive programs keep waiting until they exit or you stop them.

Stop cancels an AI stream immediately, or sends Ctrl+C to a running terminal command. A program that ignores Ctrl+C may still need to be stopped from the terminal. Closing the panel or switching sessions stops its active AI operation. Ask mode runs code only when you click Run or Write. Full access runs Agent actions without the approval step.

## Verification

```sh
npm run test:ai --workspace @azalea/desktop
npm run build --workspace @azalea/desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked commands::ai::tests --lib
```

Tests cover fragmented completion markers, silent commands, exit status, shell quoting, session filtering, cancellation and cleanup, custom model persistence, Unicode streaming, and Markdown rendering including approval buttons. Live provider connections require your own saved keys.
