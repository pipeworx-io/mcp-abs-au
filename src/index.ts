interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Australian Bureau of Statistics (ABS) Data API MCP.
 *
 * SDMX REST API at https://api.data.abs.gov.au (keyless, no auth).
 * Three concepts, in the order an LLM should use them:
 *   1. list_dataflows    — discover/search dataset IDs (e.g. "CPI", "ALC").
 *   2. dataflow_structure — for one dataflow, list its dimensions and the
 *      valid codes per dimension. You need this to build a dataKey.
 *   3. get_data          — pull observations. The dataKey is a dot-separated
 *      SDMX filter, one position per dimension (in the order shown by
 *      dataflow_structure), each position a code or "+"-joined codes, empty
 *      for wildcard, or the whole key "all". Always fetch the structure first.
 *
 * SDMX-JSON quirk: ABS speaks SDMX-JSON 2.0.0. The plain media types work
 * (no `;version=` param needed); we send them with `charset=utf-8`. Structure
 * requests use `application/vnd.sdmx.structure+json`, data requests use
 * `application/vnd.sdmx.data+json`. The bare /dataflow path 301-redirects, so
 * we rely on fetch following redirects automatically.
 */


const BASE = 'https://api.data.abs.gov.au';
const UA = 'pipeworx-mcp-abs-au/1.0 (+https://pipeworx.io)';
const ACCEPT_STRUCTURE = 'application/vnd.sdmx.structure+json; charset=utf-8; version=2.0.0';
const ACCEPT_DATA = 'application/vnd.sdmx.data+json; charset=utf-8; version=2.0.0';

const tools: McpToolExport['tools'] = [
  {
    name: 'list_dataflows',
    description:
      'Browse or search ABS datasets (dataflows). Returns dataflow IDs + descriptive names; the ID (e.g. "CPI", "ALC", "ABS_REGIONAL_LGA2021") is what you pass to dataflow_structure and get_data. Optionally filter by a case-insensitive substring against the ID and name.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Case-insensitive substring to match against dataflow id/name (e.g. "consumer price", "labour", "population").' },
        limit: { type: 'number', description: 'Max results to return (default 50, max 500).' },
      },
    },
  },
  {
    name: 'dataflow_structure',
    description:
      'For one ABS dataflow, return its ordered dimensions and the valid codes for each. Use this to build a dataKey for get_data: the key has one dot-separated position per dimension, in the order returned here. Call this before get_data.',
    inputSchema: {
      type: 'object',
      properties: {
        dataflowId: { type: 'string', description: 'Dataflow id from list_dataflows, e.g. "CPI".' },
        maxCodesPerDimension: { type: 'number', description: 'Cap codes listed per dimension to keep output small (default 50).' },
      },
      required: ['dataflowId'],
    },
  },
  {
    name: 'get_data',
    description:
      'Fetch observations from an ABS dataflow. dataKey is a dot-separated SDMX filter with one position per dimension (order from dataflow_structure); each position is a code, "+"-joined codes, or empty for wildcard. Pass "all" to fetch everything (can be large). Returns decoded series with their dimension labels and time-indexed values. Fetch dataflow_structure first to learn the dimension order and valid codes.',
    inputSchema: {
      type: 'object',
      properties: {
        dataflowId: { type: 'string', description: 'Dataflow id, e.g. "CPI".' },
        dataKey: { type: 'string', description: 'Dot-separated dimension filter, e.g. "1.10001.10.50.Q" or "all". Empty positions are wildcards.' },
        startPeriod: { type: 'string', description: 'Earliest period, e.g. "2020" or "2020-Q1" or "2020-01".' },
        endPeriod: { type: 'string', description: 'Latest period, e.g. "2024".' },
        maxSeries: { type: 'number', description: 'Cap decoded series returned (default 100). The raw response may contain thousands.' },
      },
      required: ['dataflowId', 'dataKey'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_dataflows':
      return listDataflows(args.search as string | undefined, clampNum(args.limit, 50, 1, 500));
    case 'dataflow_structure':
      return dataflowStructure(reqStr(args, 'dataflowId', '"CPI"'), clampNum(args.maxCodesPerDimension, 50, 1, 10000));
    case 'get_data':
      return getData(
        reqStr(args, 'dataflowId', '"CPI"'),
        reqStr(args, 'dataKey', '"all"'),
        args.startPeriod as string | undefined,
        args.endPeriod as string | undefined,
        clampNum(args.maxSeries, 100, 1, 5000),
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function listDataflows(search: string | undefined, limit: number): Promise<unknown> {
  const json = (await absGet(`/dataflow?detail=allstubs`, ACCEPT_STRUCTURE)) as any;
  const flows: any[] = json?.data?.dataflows ?? [];
  const needle = search?.trim().toLowerCase();
  const matched = needle
    ? flows.filter((f) => `${f.id} ${f.name ?? ''}`.toLowerCase().includes(needle))
    : flows;
  return {
    total: flows.length,
    matched: matched.length,
    returned: Math.min(matched.length, limit),
    dataflows: matched.slice(0, limit).map((f) => ({
      id: f.id,
      agencyID: f.agencyID,
      version: f.version,
      name: f.name ?? f.names?.en,
    })),
  };
}

async function dataflowStructure(dataflowId: string, maxCodes: number): Promise<unknown> {
  const json = (await absGet(`/datastructure/ABS/${encodeURIComponent(dataflowId)}?references=all`, ACCEPT_STRUCTURE)) as any;
  const data = json?.data ?? {};
  const dsd = (data.dataStructures ?? [])[0];
  if (!dsd) throw new Error(`ABS: no data structure found for dataflow "${dataflowId}"`);

  // Build a urn -> codelist lookup. enumeration URNs look like
  // "urn:sdmx:org.sdmx.infomodel.codelist.Codelist=ABS:CL_CPI_INDEX(1.0.0)".
  const codelists = new Map<string, any>();
  for (const cl of data.codelists ?? []) {
    codelists.set(`${cl.agencyID}:${cl.id}(${cl.version})`, cl);
  }

  const dims: any[] = dsd.dataStructureComponents?.dimensionList?.dimensions ?? [];
  // Honour SDMX position so the dataKey order is correct.
  dims.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  return {
    dataflowId: dsd.id,
    name: dsd.name ?? dsd.names?.en,
    description: dsd.description,
    dataKeyHint: `Build a dataKey as ${dims.map((d) => `<${d.id}>`).join('.')} (dot-separated, this order). Use "" for a wildcard position, "+"-join multiple codes, or pass "all" for the whole key.`,
    dimensions: dims.map((d) => {
      const urn: string | undefined = d.localRepresentation?.enumeration;
      const cl = urn ? codelists.get(urnToKey(urn)) : undefined;
      const codes: any[] = cl?.codes ?? [];
      return {
        id: d.id,
        name: d.concept?.name ?? d.id,
        codelist: cl ? `${cl.agencyID}:${cl.id}(${cl.version})` : undefined,
        codeCount: codes.length,
        codes: codes.slice(0, maxCodes).map((c) => ({ id: c.id, name: c.name ?? c.names?.en })),
        codesTruncated: codes.length > maxCodes ? codes.length - maxCodes : 0,
      };
    }),
  };
}

async function getData(
  dataflowId: string,
  dataKey: string,
  startPeriod: string | undefined,
  endPeriod: string | undefined,
  maxSeries: number,
): Promise<unknown> {
  const params = new URLSearchParams();
  if (startPeriod) params.set('startPeriod', startPeriod);
  if (endPeriod) params.set('endPeriod', endPeriod);
  const qs = params.toString();
  const path = `/data/${encodeURIComponent(dataflowId)}/${encodeURIComponent(dataKey)}${qs ? `?${qs}` : ''}`;
  const json = (await absGet(path, ACCEPT_DATA)) as any;

  const structure = (json?.data?.structures ?? [])[0];
  const dataSet = (json?.data?.dataSets ?? [])[0];
  if (!structure || !dataSet) {
    return { dataflowId, dataKey, note: 'No data returned for this key/period.', raw: json?.data ?? json };
  }

  // Series dimensions: each value in a series key is an index into that
  // dimension's `values` array. Observation dimension (usually TIME_PERIOD)
  // is keyed similarly inside each series' observations.
  const seriesDims: any[] = structure.dimensions?.series ?? [];
  const obsDims: any[] = structure.dimensions?.observation ?? [];
  const obsDim = obsDims[0];

  const seriesEntries = Object.entries<any>(dataSet.series ?? {});
  const decoded = seriesEntries.slice(0, maxSeries).map(([key, series]) => {
    const idx = key.split(':').map((n) => parseInt(n, 10));
    const dimensions: Record<string, string> = {};
    seriesDims.forEach((dim, i) => {
      const v = dim.values?.[idx[i]];
      if (v) dimensions[dim.id] = v.name ?? v.names?.en ?? v.id;
    });
    const observations: Record<string, number | null> = {};
    for (const [obsIdx, val] of Object.entries<any>(series.observations ?? {})) {
      const periodVal = obsDim?.values?.[parseInt(obsIdx, 10)];
      const period = periodVal?.id ?? periodVal?.name ?? obsIdx;
      observations[period] = Array.isArray(val) ? (val[0] ?? null) : (val ?? null);
    }
    return { dimensions, observations };
  });

  return {
    dataflowId,
    dataKey,
    name: structure.name ?? structure.names?.en,
    totalSeries: seriesEntries.length,
    returnedSeries: decoded.length,
    seriesTruncated: seriesEntries.length > decoded.length ? seriesEntries.length - decoded.length : 0,
    series: decoded,
  };
}

async function absGet(path: string, accept: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: accept, 'User-Agent': UA } });
  if (!res.ok) throw new Error(`ABS: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) return res.json();
  // Fall back to text for non-JSON (some SDMX errors return XML/plain).
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { contentType: ct, body: text.slice(0, 4000) };
  }
}

function urnToKey(urn: string): string {
  // ".Codelist=ABS:CL_CPI_INDEX(1.0.0)" -> "ABS:CL_CPI_INDEX(1.0.0)"
  const eq = urn.lastIndexOf('=');
  return eq >= 0 ? urn.slice(eq + 1) : urn;
}

function clampNum(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
