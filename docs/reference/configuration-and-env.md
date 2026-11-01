# Configuration and environment

Most people can use PromptBr0 without changing any configuration. This page
covers the few settings useful for the CLI, or provider setup.

## Use a different library

The desktop app and CLI use the same local library by default. Set
`PROMPTBR0_DB` when you want an entry point to use a different database:

    export PROMPTBR0_DB="/path/to/my-library.db"
    promptbr0 list

The default location is:

| System | Library path |
| --- | --- |
| macOS | `~/Library/Application Support/PromptBr0/library.db` |
| Linux | `$XDG_CONFIG_HOME/promptbr0/library.db` (or `~/.config/promptbr0/library.db`) |
| Windows | `%APPDATA%\PromptBr0\library.db` |

## Use an environment API key

Set one of these before starting PromptBr0, then use **Use environment key**
in **Settings → AI Providers**:

| Variable | Provider |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google |

## Sync connectivity

For device sync, allow PromptBr0 to communicate with your other devices on
your local network or VPN. On macOS, allow the system Local Network permission
when prompted. If nearby discovery does not work, use **Pair by address** in
**Settings → Sync**.
