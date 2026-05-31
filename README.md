# Open Script Studio

Open Script Studio is a small Express app that turns story references, character notes, and worldbuilding material into an adapted production plan and a handoff-ready script package.

It was extracted from a production feature and sanitized for open source. The repository does not include private deployment details, API keys, server IPs, logs, user data, or proprietary service integrations.

## Features

- Paste or upload story references.
- Optional character and world/skill references.
- If character or world references are missing, the model creates them from audience, genre, market, and tone.
- Supports `.txt`, `.md`, `.markdown`, `.json`, `.docx`, and `.epub` uploads.
- Generates:
  - adaptation strategy
  - localization notes
  - mapping table
  - character bible
  - world bible
  - skill/item codex
  - episode beats
  - full adapted script
  - production handoff text
- Supports English, Chinese, Japanese, and Spanish UI labels.
- Uses server-side project persistence plus local browser drafts.
- Avoids cached polling responses with `no-store` headers.

## Quick Start

```bash
npm install
cp .env.example .env
```

Edit `.env` and set either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

Then run:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Model Providers

Anthropic Messages API:

```env
SCRIPT_STUDIO_PROVIDER=anthropic
SCRIPT_STUDIO_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_API_KEY=your_anthropic_api_key
```

OpenAI-compatible Chat Completions API:

```env
SCRIPT_STUDIO_PROVIDER=openai
SCRIPT_STUDIO_MODEL=gpt-4o-mini
OPENAI_API_KEY=your_openai_api_key
OPENAI_API_BASE=https://api.openai.com/v1
```

For Anthropic models, the app sends `system` and the first user content block with ephemeral `cache_control` when prompt caching is enabled by `ANTHROPIC_BETA`.

## Configuration

See `.env.example` for all options.

Important limits:

- `SCRIPT_STUDIO_UPLOAD_LIMIT`
- `SCRIPT_STUDIO_MAX_SOURCE_CHARS`
- `SCRIPT_STUDIO_MAX_TOTAL_CHARS`
- `SCRIPT_STUDIO_MAX_RAW_SOURCE_CHARS`
- `SCRIPT_STUDIO_ANTHROPIC_MESSAGE_CHARS`

Project state defaults to:

```text
./data/projects
```

`data/` is ignored by git.

## Security Notes

- Do not commit `.env`.
- Do not log raw uploaded source material in production.
- Do not expose API keys to the browser.
- Run `npm run scan:secrets` before publishing changes.

## Development

```bash
npm run check
npm run scan:secrets
```

## License

MIT
