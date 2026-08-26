# mcp-abs-au

Australian Bureau of Statistics (ABS) Data API MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `list_dataflows` | Browse or search ABS datasets (dataflows). Returns dataflow IDs + descriptive names; the ID (e.g. "CPI", "ALC", "ABS_REGIONAL_LGA2021") is what you pass to dataflow_structure and get_data. Optionally filter by a case-insensitive substring against the ID and name. |
| `dataflow_structure` | For one ABS dataflow, return its ordered dimensions and the valid codes for each. Use this to build a dataKey for get_data: the key has one dot-separated position per dimension, in the order returned here. Call this before get_data. |
| `get_data` | Fetch observations from an ABS dataflow. dataKey is a dot-separated SDMX filter with one position per dimension (order from dataflow_structure); each position is a code, "+"-joined codes, or empty for wildcard. Pass "all" to fetch everything (can be large). Returns decoded series with their dimension labels and time-indexed values. Fetch dataflow_structure first to learn the dimension order and valid codes. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "abs-au": {
      "url": "https://gateway.pipeworx.io/abs-au/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/abs-au/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Abs Au data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
