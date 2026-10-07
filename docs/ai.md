# Terminal AI

Enable AI in **Settings → AI**, choose a provider, save its API key, and select a model. Ollama needs a running local server and no key.

Models are loaded from the provider's API. OpenAI's list is filtered for text chat; Anthropic catalogs use the Messages API's authentication and pagination. Custom IDs can be added in batches (newlines or commas), are saved per provider, and appear immediately in the chat model selector. Switching providers restores the previous model, endpoint, and region. Empty custom inputs stay empty.

Amazon Bedrock Runtime has no OpenAI-compatible model-list endpoint. Its built-in choices use the documented GPT-OSS Chat Completions IDs; add other supported IDs explicitly. Bedrock Mantle loads its own catalog. Model availability still depends on your account, region, and API compatibility. See the official [OpenAI Models API](https://developers.openai.com/api/reference/resources/models/methods/list), [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list), and [Bedrock Chat Completions documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html).

## Commands and approval

In **Agent → Confirm each command**, shell commands and file writes remain pending until approved. Approve executes the next action; Approve all executes the proposed batch in order. Agent waits for a shell completion marker and exit status before using the output to continue. Silence in the terminal does not mark a command as finished. Output is shown while the command runs; the latest 64,000 characters are retained for each command. The active shell must support POSIX shell syntax (bash, sh, zsh) or PowerShell on Windows. Interactive programs keep waiting until they exit or you stop them.

Stop cancels an AI stream immediately, or sends Ctrl+C to a running terminal command. A program that ignores Ctrl+C may still need to be stopped from the terminal. Closing the panel or switching sessions stops its active AI operation. Ask mode runs code only when you click Run or Write. Full access runs Agent actions without the approval step.

## Web search and work history

Web search defaults to **Mwmbl**, using its public API without an account or API key. Its independent index has less coverage than larger engines. DuckDuckGo is another keyless option; its public HTML search can require browser verification or become rate-limited, which Azalea reports explicitly. See [Mwmbl's search API implementation](https://github.com/mwmbl/mwmbl/blob/main/mwmbl/tinysearchengine/search.py) and [DuckDuckGo's non-JavaScript search](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript).

Optional providers are configured in **Settings → AI → Web search** independently from your model provider. Tavily and Brave use their own search API keys (saved in the keychain); SearXNG uses your instance URL and requires JSON output. Saving a search key enables web search. You can toggle searching for the next request from chat settings. See the official [Tavily API](https://docs.tavily.com/documentation/api-reference/endpoint/search), [Brave authentication](https://api-dashboard.search.brave.com/documentation/guides/authentication), and [SearXNG search API](https://docs.searxng.org/dev/search_api.html).

Ask and Agent can request up to three search rounds per response, with up to three queries per round and at most nine uncached requests per task. Searches run independently of shell commands; the AI waits for actual excerpts before continuing. Results include source URLs, and the AI is instructed to cite those links and treat snippets as untrusted data. Search failures are returned explicitly. A search result does not mean that Azalea fetched the entire source page.

Each request has one assistant response group. While working, its history is expanded and contains intermediate assistant messages, searches, source links, proposed commands with approval controls, live output, file writes, and errors. Completion automatically collapses that history into **Worked for…** and shows one final answer outside it. You can reopen the history afterwards. The timer counts active AI/tool time and excludes waiting for approval. Summaries and the full underlying conversation persist in chat history and JSON exports. They record user-facing messages, actions, and results, not private model reasoning or inferred to-do completion. Stop cancels web requests too. Interrupted work recovered after restarting is marked stopped instead of resuming automatically.

## Verification

```sh
npm run test:ai --workspace @azalea/desktop
npm run build --workspace @azalea/desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked commands::ai::tests --lib
```

Tests cover fragmented completion markers, silent commands, exit status, shell quoting, session filtering, cancellation and cleanup, custom model persistence, Unicode streaming, and Markdown rendering including approval buttons. Live provider connections require your own saved keys.
