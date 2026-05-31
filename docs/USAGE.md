# Usage Guide

This guide explains the full Noval workflow from configuration to export.

## 1. Configure A Model Provider

Copy the sample environment file:

```bash
cp .env.example .env
```

Use Anthropic if your model name starts with `claude`, or set `SCRIPT_STUDIO_PROVIDER=anthropic` explicitly.

Use OpenAI-compatible providers by setting `SCRIPT_STUDIO_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_API_BASE`.

## 2. Start The App

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## 3. Prepare Source Material

The main plot/source story is required. Character references and world/skill references are optional.

Good main plot input usually includes:

- protagonist
- central conflict
- important relationships
- setting
- major turns
- ending direction, if known

If character or world references are missing, Noval creates them from the selected audience, market, genre, and tone.

## 4. Choose Creative Direction

Set the market, adaptation level, genre, audience, and tone before generation.

Use notes for special requirements, for example:

```text
Keep the protagonist morally gray. Make the romance slow burn. Avoid modern office settings.
```

## 5. Generate And Review

Click **Generate Plan**.

Review every generated section before using it downstream:

- Adaptation: the overall creative strategy.
- Mapping: how source elements were changed.
- Characters: protagonist, allies, antagonists, motives, arcs, and visual direction.
- World: setting, factions, rules, taboos, and visual language.
- Beats: episode or segment structure.
- Full Script: production-readable scenes, dialogue, narration, visuals, and hooks.

## 6. Export A Handoff Package

Click **Export Handoff** for a plain-text package.

Click **Save Handoff** to save structured handoff data in browser local storage under:

```text
openScriptStudio.handoff.v1
```

## Troubleshooting

If generation fails with an API key error, check `.env` and restart the server.

If a large upload fails, raise `SCRIPT_STUDIO_UPLOAD_LIMIT`.

If model output is too short, raise these limits carefully:

```env
SCRIPT_STUDIO_MAX_SOURCE_CHARS
SCRIPT_STUDIO_MAX_TOTAL_CHARS
SCRIPT_STUDIO_MAX_TOKENS
```

If you deploy for multiple users, add your own authentication layer and pass a stable `x-script-studio-user` header.
