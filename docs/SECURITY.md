# Security

Open Script Studio is designed so model provider keys stay on the server.

Before publishing a fork or deployment:

1. Keep `.env` out of git.
2. Run `npm run scan:secrets`.
3. Review `git status --ignored` to make sure `data/`, logs, and local env files are not staged.
4. Avoid adding deployment hostnames, SSH aliases, server IPs, private API bases, or production logs to docs.
5. Do not store raw user source material in public issue reports or logs.

If you discover a vulnerability, open a private security advisory or contact the maintainer privately.
