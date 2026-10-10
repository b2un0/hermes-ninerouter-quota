# hermes-ninerouter-quota

Hermes plugin that shows [9router](https://github.com/decolua/9router) provider quotas (Codex, Claude, ...) in the Hermes Desktop status bar.

## Install

```bash
hermes plugins install b2un0/hermes-ninerouter-quota
```

## Config

Add to `$HERMES_HOME/.env`:

```
NINEROUTER_DASHBOARD_PASSWORD=...
NINEROUTER_URL=https://your-9router-host
```

## Layout

- `dashboard/plugin_api.py` – backend, fetches and caches quotas
- `desktop/plugin.js` – status bar UI

## License

MIT
