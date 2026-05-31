# Deployment Guide

Noval is a standard Node.js/Express app.

## Minimal Deployment

```bash
git clone https://github.com/MossHK/noval.git
cd noval
npm ci
cp .env.example .env
npm start
```

Set `PORT` if your platform requires a specific port.

## Production Checklist

- Use HTTPS.
- Keep `.env` private.
- Use persistent storage for `SCRIPT_STUDIO_STATE_DIR`.
- Put the app behind an auth layer before exposing it to real users.
- Avoid logging raw user stories or generated private project content.
- Run `npm run scan:secrets` before every public release.
- Run `npm audit --omit=dev` after dependency changes.

## Reverse Proxy Example

This app can sit behind Nginx, Caddy, a platform router, or a container ingress.

Forward standard headers and, if you have your own auth system, pass:

```text
x-script-studio-user
x-script-studio-email
```

The server uses those headers to separate saved project files.

## Environment Variables

The most important runtime values are:

```env
PORT=3000
SCRIPT_STUDIO_PROVIDER=anthropic
SCRIPT_STUDIO_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
SCRIPT_STUDIO_STATE_DIR=./data/projects
```

See `.env.example` for the full list.
