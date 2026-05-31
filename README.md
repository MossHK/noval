# Noval (Open Script Studio)

Noval is a self-hosted AI script adaptation studio. It helps writers and small creative teams turn story drafts, novels, character notes, and worldbuilding references into a production-ready adaptation package.

It can generate an adaptation strategy, localized story direction, character bible, world bible, skill/item codex, episode beats, a full adapted script, and a production handoff document.

This repository was extracted from a production feature and sanitized for open source. It does not include private deployment details, API keys, server IPs, logs, user data, or proprietary service integrations.

## What You Can Build With It

- Adapt a long story, novel excerpt, or script into a new short-drama/script plan.
- Generate characters and world rules automatically when the user only provides a target audience and a main plot.
- Upload references as `.txt`, `.md`, `.markdown`, `.json`, `.docx`, or `.epub`.
- Use Anthropic Claude through `/v1/messages`, including prompt-cache-friendly Anthropic payloads.
- Use OpenAI-compatible chat-completions providers.
- Save work server-side and keep browser drafts locally.
- Export a production handoff text package for downstream video, comic, or drama production.
- Switch UI labels between English, Chinese, Japanese, and Spanish.

## Demo Workflow

1. Paste or upload the main plot/source story.
2. Optionally add character notes and world/skill references.
3. Choose target market, adaptation strength, genre, audience, and tone.
4. Click **Generate Plan**.
5. Review the generated strategy, mapping table, characters, world rules, beats, and full script.
6. Click **Export Handoff** to create a text package for production.
7. Click **Save Handoff** to store the handoff package in browser storage.

## Quick Start

Requirements:

- Node.js 18 or newer
- An Anthropic API key or an OpenAI-compatible API key

Install and configure:

```bash
git clone https://github.com/MossHK/noval.git
cd noval
npm install
cp .env.example .env
```

Edit `.env` and set one provider.

For Anthropic Claude:

```env
SCRIPT_STUDIO_PROVIDER=anthropic
SCRIPT_STUDIO_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_API_BASE=https://api.anthropic.com
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_BETA=prompt-caching-2024-07-31
```

For OpenAI-compatible providers:

```env
SCRIPT_STUDIO_PROVIDER=openai
SCRIPT_STUDIO_MODEL=gpt-4o-mini
OPENAI_API_KEY=your_openai_api_key
OPENAI_API_BASE=https://api.openai.com/v1
```

Run locally:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Using The App

### 1. Add Source Material

The main plot field is enough to start. Character and world/skill references are optional.

If the optional references are empty, Noval asks the model to create characters, world rules, and skill systems from the selected target audience, market, genre, and tone.

Supported uploads:

- `.txt`
- `.md`
- `.markdown`
- `.json`
- `.docx`
- `.epub`

The default upload limit is 20 MB.

### 2. Set Creative Direction

Use the settings panel to choose:

- target market
- adaptation level
- genre
- target audience
- tone
- extra notes

These settings are sent to the model and directly influence the adaptation style.

### 3. Generate

Click **Generate Plan**. The server creates a background job and the browser polls job status until the result is ready.

The generated result includes:

- adaptation strategy
- globalization/localization notes
- source-to-adaptation mapping
- character bible
- world bible
- skill/item codex
- opening scenes
- episode beats
- full adapted script
- production handoff prompt/rules/warnings

### 4. Export

Click **Export Handoff** to generate a plain-text handoff document.

Click **Save Handoff** to save a structured handoff package to browser local storage. This is useful if another local tool wants to pick up the generated script package later.

## Configuration

All runtime configuration lives in `.env`.

Important options:

```env
PORT=3000
SCRIPT_STUDIO_UPLOAD_LIMIT=20971520
SCRIPT_STUDIO_MAX_TOKENS=9000
SCRIPT_STUDIO_MAX_SOURCE_CHARS=120000
SCRIPT_STUDIO_MAX_TOTAL_CHARS=320000
SCRIPT_STUDIO_MAX_RAW_SOURCE_CHARS=2000000
SCRIPT_STUDIO_ANTHROPIC_MESSAGE_CHARS=380000
SCRIPT_STUDIO_STATE_DIR=./data/projects
```

Project state is stored in:

```text
./data/projects
```

`data/` is ignored by git.

## API Overview

The app exposes a small JSON API:

- `GET /api/script-studio/config`
- `GET /api/script-studio/project/current`
- `PUT /api/script-studio/project/current`
- `POST /api/script-studio/script/read`
- `POST /api/script-studio/jobs`
- `GET /api/script-studio/jobs/:jobId`
- `POST /api/script-studio/export-handoff`

The default demo server uses a local user identity. For multi-user deployments, place it behind your own auth layer and pass stable user headers:

```text
x-script-studio-user: user-id
x-script-studio-email: user@example.com
```

## More Guides

- [Usage Guide](docs/USAGE.md): full workflow from source material to exported handoff.
- [Deployment Guide](docs/DEPLOYMENT.md): production checklist and environment notes.
- [GitHub About Settings](docs/GITHUB_ABOUT.md): suggested repository description, website, and topics.
- [Security Notes](docs/SECURITY.md): safe handling of keys, logs, uploads, and public forks.

## Deployment Notes

For a simple server deployment:

```bash
npm ci
cp .env.example .env
npm start
```

Recommended production setup:

- Run behind HTTPS.
- Keep `.env` outside git and backups that may become public.
- Put a reverse proxy such as Nginx, Caddy, or a platform router in front of Node.
- Add authentication before exposing it to real users.
- Keep `SCRIPT_STUDIO_STATE_DIR` on persistent storage.
- Avoid logging raw uploaded stories or generated private project content.

## Development

Run syntax checks:

```bash
npm run check
```

Run the repository secret scan:

```bash
npm run scan:secrets
```

Run dependency audit:

```bash
npm audit --omit=dev
```

## Security

- Do not commit `.env`.
- Do not expose model provider keys to the browser.
- Do not paste real API keys into issues, screenshots, or docs.
- Review generated content before using it in production.
- Run `npm run scan:secrets` before publishing changes.

See [docs/SECURITY.md](docs/SECURITY.md) for more notes.

## Repository Description

Suggested GitHub About description:

```text
Self-hosted AI script adaptation studio for turning novels, story notes, and worldbuilding references into production-ready scripts and handoff packages.
```

Suggested topics:

```text
ai, writing, screenwriting, scriptwriting, story-adaptation, express, anthropic, openai
```

## License

MIT
