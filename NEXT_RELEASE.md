### Secrets are now kept in Obsidian's secret storage

The server bearer token and the hosted embedding API key are no longer stored in the plugin's data file, which syncs with your vault (git, Syncthing, cloud). They now live in Obsidian's secret storage, which stays on each device.

- **Nothing to do.** Every device moves its token and key into its own secret storage the next time it starts. You stay connected: MCP clients, `.mcp.json` and all your synced devices keep working with the same token.
- A plain-text copy from older versions stays in the data file for 60 days so devices you haven't opened yet can migrate too, then it is deleted automatically. Once all your devices run this version, you can delete it right away with **Remove plain-text copy now** in the Server section.
- The bearer token and API key settings now use Obsidian's secret picker. Regenerating the token or changing the key only touches secret storage.
- If a device ever reports that the bearer token is missing, set it there with the picker (same value as on your other devices). The plugin never replaces it on its own, so your clients are never disconnected behind your back.
