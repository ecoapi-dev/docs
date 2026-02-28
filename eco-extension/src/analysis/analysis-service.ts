import { randomUUID } from "crypto";
import {
  ApiCallInput,
  EndpointRecord,
  EndpointStatus,
  GraphData,
  GraphEdge,
  GraphNode,
  ScanSummary,
  Suggestion,
  SuggestionType
} from "./types";
import {
  DEFAULT_PER_CALL_COST_USD,
  PROVIDER_KEYWORDS,
  PROVIDER_PRICING
} from "./pricing";

export interface AnalysisResult {
  endpoints: EndpointRecord[];
  suggestions: Suggestion[];
  graph: GraphData;
  summary: ScanSummary;
}

const parseCallsPerDay = (frequency?: string): number => {
  if (!frequency) return 100;
  const normalized = frequency.trim().toLowerCase();
  if (normalized === "per-request") return 1000;
  if (normalized === "per-session") return 300;
  if (normalized === "hourly") return 24;
  if (normalized === "daily") return 1;
  if (normalized === "weekly") return 1 / 7;

  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*\/\s*(day|daily)$/);
  if (numericMatch) return Number(numericMatch[1]);

  const numberOnly = Number(normalized);
  if (!Number.isNaN(numberOnly) && numberOnly >= 0) return numberOnly;

  return 100;
};

const detectProvider = (url: string): string => {
  const normalizedUrl = url.toLowerCase();
  if (normalizedUrl.startsWith("/")) return "internal";

  for (const [provider, keywords] of Object.entries(PROVIDER_KEYWORDS)) {
    if (keywords.some((keyword) => normalizedUrl.includes(keyword))) {
      return provider;
    }
  }

  return "internal";
};

const getPerCallCost = (provider: string): number => {
  return PROVIDER_PRICING[provider]?.perCallCostUsd ?? DEFAULT_PER_CALL_COST_USD;
};

const roundCurrency = (value: number): number => Number(value.toFixed(4));

const pickStatus = (flags: Set<EndpointStatus>): EndpointStatus => {
  const priority: EndpointStatus[] = [
    "rate_limit_risk",
    "n_plus_one_risk",
    "cacheable",
    "batchable",
    "redundant",
    "normal"
  ];
  return priority.find((status) => flags.has(status)) ?? "normal";
};

const fenced = (code: string, lang = "typescript"): string =>
  `\`\`\`${lang}\n${code}\n\`\`\``;

const siteRef = (call: ApiCallInput): string =>
  `\`${call.file}:${call.line}\``;

const withSnippet = (call: ApiCallInput, fixLines: string[]): string => {
  const header = call.codeSnippet
    ? `// Detected (${call.file}:${call.line}):\n${call.codeSnippet}\n\n`
    : `// Detected at ${call.file}:${call.line}\n\n`;
  return fenced(header + fixLines.join("\n"));
};

export const analyzeApiCalls = (
  projectId: string,
  scanId: string,
  apiCalls: ApiCallInput[]
): AnalysisResult => {
  const byEndpoint = new Map<string, ApiCallInput[]>();
  for (const call of apiCalls) {
    const key = `${call.method.toUpperCase()} ${call.url}`;
    const existing = byEndpoint.get(key) ?? [];
    existing.push(call);
    byEndpoint.set(key, existing);
  }

  const endpointStatuses = new Map<string, Set<EndpointStatus>>();
  const endpoints: EndpointRecord[] = [];
  const providerDailyTotals = new Map<string, number>();

  for (const [key, calls] of byEndpoint.entries()) {
    const first = calls[0];
    const provider = detectProvider(first.url);
    const perCallCost = getPerCallCost(provider);
    const callsPerDay = calls.reduce((sum, call) => sum + parseCallsPerDay(call.frequency), 0);
    const monthlyCost = roundCurrency(callsPerDay * perCallCost * 30);
    const endpointId = randomUUID();
    const statusSet: Set<EndpointStatus> = new Set(["normal"]);
    endpointStatuses.set(key, statusSet);
    providerDailyTotals.set(provider, (providerDailyTotals.get(provider) ?? 0) + callsPerDay);

    endpoints.push({
      id: endpointId,
      projectId,
      scanId,
      provider,
      method: first.method.toUpperCase(),
      url: first.url,
      files: Array.from(new Set(calls.map((call) => call.file))),
      callSites: calls.map((call) => ({
        file: call.file,
        line: call.line,
        library: call.library,
        frequency: call.frequency,
        codeSnippet: call.codeSnippet,
      })),
      callsPerDay: roundCurrency(callsPerDay),
      monthlyCost,
      status: "normal"
    });
  }

  const keyToEndpoint = new Map<string, EndpointRecord>();
  for (const endpoint of endpoints) {
    keyToEndpoint.set(`${endpoint.method} ${endpoint.url}`, endpoint);
  }

  const suggestions: Suggestion[] = [];
  const pushSuggestion = (
    type: SuggestionType,
    severity: "high" | "medium" | "low",
    affected: EndpointRecord[],
    description: string,
    estimatedMonthlySavings: number,
    codeFix: string
  ): void => {
    suggestions.push({
      id: randomUUID(),
      projectId,
      scanId,
      type,
      severity,
      affectedEndpoints: affected.map((e) => e.id),
      affectedFiles: Array.from(new Set(affected.flatMap((e) => e.files))),
      estimatedMonthlySavings: roundCurrency(estimatedMonthlySavings),
      description,
      codeFix
    });
  };

  for (const [key, calls] of byEndpoint.entries()) {
    const endpoint = keyToEndpoint.get(key);
    if (!endpoint) continue;
    const uniqueFiles = new Set(calls.map((call) => call.file));

    if (calls.length > 1 || uniqueFiles.size > 1) {
      endpointStatuses.get(key)?.add("redundant");
      const sites = calls.slice(0, 3).map(siteRef).join(", ");
      pushSuggestion(
        "redundancy",
        calls.length > 3 ? "high" : "medium",
        [endpoint],
        `\`${endpoint.method} ${endpoint.url}\` is called from ${calls.length} places (${sites}). Consolidate into a shared service to avoid redundant requests.`,
        endpoint.monthlyCost * 0.2,
        withSnippet(calls[0], [
          "// Move this call into a shared module:",
          `export const fetch${endpoint.url.split("/").pop()?.replace(/[^a-zA-Z]/g, "") || "Data"} = () =>`,
          `  fetch("${endpoint.url}").then(r => r.json());`,
        ])
      );
    }

    if (endpoint.method === "GET" && uniqueFiles.size >= 2) {
      endpointStatuses.get(key)?.add("cacheable");
      const sites = calls.slice(0, 2).map(siteRef).join(" and ");
      pushSuggestion(
        "cache",
        "medium",
        [endpoint],
        `\`GET ${endpoint.url}\` is fetched from ${uniqueFiles.size} files (${sites}) on every call. Caching responses would eliminate redundant network requests.`,
        endpoint.monthlyCost * 0.35,
        withSnippet(calls[0], [
          "// Add an in-memory cache around this call:",
          "const _cache = new Map<string, { v: unknown; exp: number }>();",
          `async function cachedGet(url: string) {`,
          "  const hit = _cache.get(url);",
          "  if (hit && hit.exp > Date.now()) return hit.v;",
          "  const v = await fetch(url).then(r => r.json());",
          "  _cache.set(url, { v, exp: Date.now() + 5 * 60_000 }); // 5 min TTL",
          "  return v;",
          "}",
        ])
      );
    }

    if (endpoint.callsPerDay >= 1000) {
      endpointStatuses.get(key)?.add("n_plus_one_risk");
      pushSuggestion(
        "n_plus_one",
        "high",
        [endpoint],
        `\`${endpoint.url}\` fires ~${Math.round(endpoint.callsPerDay).toLocaleString()} times/day — likely inside a loop. Replace with a single batched request to drastically cut API calls.`,
        endpoint.monthlyCost * 0.4,
        withSnippet(calls[0], [
          "// Instead of calling per-item inside a loop:",
          "// for (const id of ids) { await fetch(`.../${id}`); }",
          "",
          "// Fetch all at once:",
          `const results = await fetch(\`${endpoint.url.replace(/\/:[^/]+/, "")}?ids=\${ids.join(",")}\`)`,
          "  .then(r => r.json());",
          "",
          "// Or in parallel (if no bulk endpoint):",
          "const results = await Promise.all(ids.map(id => fetch(`.../${id}`)));",
        ])
      );
    }
  }

  const fileMap = new Map<string, ApiCallInput[]>();
  for (const call of apiCalls) {
    const existing = fileMap.get(call.file) ?? [];
    existing.push(call);
    fileMap.set(call.file, existing);
  }

  for (const [file, calls] of fileMap.entries()) {
    const sorted = [...calls].sort((a, b) => a.line - b.line);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const left = sorted[i];
      const right = sorted[i + 1];
      const closeLines = Math.abs(right.line - left.line) <= 8;
      const leftBase = left.url.split("/:")[0];
      const rightBase = right.url.split("/:")[0];
      const related = leftBase === rightBase || left.url.startsWith(rightBase) || right.url.startsWith(leftBase);

      if (closeLines && related && left.url !== right.url) {
        const leftEndpoint = keyToEndpoint.get(`${left.method.toUpperCase()} ${left.url}`);
        const rightEndpoint = keyToEndpoint.get(`${right.method.toUpperCase()} ${right.url}`);
        if (leftEndpoint && rightEndpoint) {
          endpointStatuses.get(`${leftEndpoint.method} ${leftEndpoint.url}`)?.add("batchable");
          endpointStatuses.get(`${rightEndpoint.method} ${rightEndpoint.url}`)?.add("batchable");
          pushSuggestion(
            "batch",
            "medium",
            [leftEndpoint, rightEndpoint],
            `Related API calls in ${file} at nearby lines can likely be batched.`,
            (leftEndpoint.monthlyCost + rightEndpoint.monthlyCost) * 0.25,
            "Introduce a bulk endpoint or combine requests with server-side aggregation."
          );
        }
      }
    }
  }

  for (const [provider, dailyTotal] of providerDailyTotals.entries()) {
    if (provider !== "internal" && dailyTotal > 1000) {
      const impacted = endpoints.filter((endpoint) => endpoint.provider === provider);
      for (const endpoint of impacted) {
        endpointStatuses.get(`${endpoint.method} ${endpoint.url}`)?.add("rate_limit_risk");
      }
      pushSuggestion(
        "rate_limit",
        "high",
        impacted,
        `Provider ${provider} exceeds 1000 calls/day and risks rate limiting.`,
        impacted.reduce((sum, endpoint) => sum + endpoint.monthlyCost, 0) * 0.15,
        "Use exponential backoff, queueing, and provider-specific rate limit guards."
      );
    }
  }

  for (const endpoint of endpoints) {
    const status = endpointStatuses.get(`${endpoint.method} ${endpoint.url}`);
    endpoint.status = pickStatus(status ?? new Set(["normal"]));
  }

  const nodes: GraphNode[] = endpoints.map((endpoint) => ({
    id: endpoint.id,
    label: `${endpoint.method} ${endpoint.url}`,
    provider: endpoint.provider,
    monthlyCost: endpoint.monthlyCost,
    callsPerDay: endpoint.callsPerDay,
    status: endpoint.status,
    group: endpoint.provider
  }));

  const edges: GraphEdge[] = endpoints.flatMap((endpoint) =>
    endpoint.callSites.map((site) => ({
      source: site.file,
      target: endpoint.id,
      line: site.line
    }))
  );

  const summary: ScanSummary = {
    totalEndpoints: endpoints.length,
    totalCallsPerDay: roundCurrency(endpoints.reduce((sum, endpoint) => sum + endpoint.callsPerDay, 0)),
    totalMonthlyCost: roundCurrency(endpoints.reduce((sum, endpoint) => sum + endpoint.monthlyCost, 0)),
    highRiskCount: suggestions.filter((suggestion) => suggestion.severity === "high").length
  };

  return {
    endpoints,
    suggestions,
    graph: { nodes, edges },
    summary
  };
};
