# mcp-abs-au

Australian Bureau of Statistics (ABS) Data API MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Abs Au data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
