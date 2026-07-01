#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type JsonObject = Record<string, unknown>;

interface ArmConfig {
  baseUrl: string;
  apiToken: string;
  timeoutMs: number;
  maxRetries: number;
}

interface AuditConfig {
  baseUrl: string;
  bearerToken: string;
  timeoutMs: number;
  maxRetries: number;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function getConfig(): ArmConfig {
  const baseUrl = process.env.ARM_BASE_URL?.trim();
  const apiToken = process.env.ARM_API_TOKEN?.trim();
  const timeoutMs = Number(process.env.ARM_TIMEOUT_MS ?? "30000");
  const maxRetries = Number(process.env.ARM_MAX_RETRIES ?? "2");

  if (!baseUrl) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing ARM_BASE_URL environment variable");
  }

  if (!apiToken) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing ARM_API_TOKEN environment variable");
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiToken,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000,
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 2,
  };
}

function getAuditConfig(): AuditConfig {
  const baseUrl = process.env.ARM_AUDIT_BASE_URL?.trim();
  const bearerToken = process.env.ARM_AUDIT_API_TOKEN?.trim();
  const timeoutMs = Number(process.env.ARM_AUDIT_TIMEOUT_MS ?? "30000");
  const maxRetries = Number(process.env.ARM_AUDIT_MAX_RETRIES ?? "2");

  if (!baseUrl) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing ARM_AUDIT_BASE_URL environment variable");
  }

  if (!bearerToken) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing ARM_AUDIT_API_TOKEN environment variable");
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    bearerToken,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000,
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 2,
  };
}

function asJsonObject(value: unknown, fieldName: string): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  throw new McpError(ErrorCode.InvalidParams, `${fieldName} must be a JSON object`);
}

function getStringArg(value: unknown, fieldName: string, required = true): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (!required && (value === undefined || value === null || value === "")) return undefined;
  throw new McpError(ErrorCode.InvalidParams, `${fieldName} must be a non-empty string`);
}

function getNumberArg(value: unknown, fieldName: string, required = true): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  if (!required && (value === undefined || value === null || value === "")) return undefined;
  throw new McpError(ErrorCode.InvalidParams, `${fieldName} must be a finite number`);
}

function buildUrl(baseUrl: string, path: string, query?: JsonObject): string {
  const url = new URL(path, `${baseUrl}/`);
  if (query) {
    for (const [key, rawValue] of Object.entries(query)) {
      if (rawValue === undefined || rawValue === null) continue;
      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(rawValue));
      }
    }
  }
  return url.toString();
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function armRequest(args: {
  config: ArmConfig;
  path: string;
  method: HttpMethod;
  query?: JsonObject;
  body?: JsonObject;
  extraHeaders?: JsonObject;
}): Promise<{ status: number; data: unknown; headers: Record<string, string> }> {
  const { config, path, method, query, body, extraHeaders } = args;
  const url = buildUrl(config.baseUrl, path, query);

  const headers: Record<string, string> = {
    Accept: "application/json",
    token: config.apiToken,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (v === undefined || v === null) continue;
      headers[k] = String(v);
    }
  }

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= config.maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await parseResponseBody(response);
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        data,
        headers: responseHeaders,
      };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      attempt += 1;

      if (attempt > config.maxRetries) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }

  throw new McpError(
    ErrorCode.InternalError,
    `ARM request failed after ${config.maxRetries + 1} attempts: ${String(lastError)}`,
  );
}

async function auditRequest(args: {
  config: AuditConfig;
  path: string;
  method: HttpMethod;
  query?: JsonObject;
}): Promise<{ status: number; data: unknown; headers: Record<string, string> }> {
  const { config, path, method, query } = args;
  const url = buildUrl(config.baseUrl, path, query);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.bearerToken}`,
  };

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= config.maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await parseResponseBody(response);
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        data,
        headers: responseHeaders,
      };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      attempt += 1;

      if (attempt > config.maxRetries) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }

  throw new McpError(
    ErrorCode.InternalError,
    `Audit request failed after ${config.maxRetries + 1} attempts: ${String(lastError)}`,
  );
}

const AUDIT_EVENT_TYPES = [
  { eventType: "LOGIN", module: "Admin", description: "Login via Username/Password (UWP), VSCode apiToken, ChannelSecure, or Modernization jwtToken" },
  { eventType: "DEPLOYMENT", module: "CI Jobs, Deployment, Version Control", description: "CI Job Deployment, Quick Deployment, Rollback, Custom Deployment, Profile Manager, Org Synchronization, Commit/Merge Validation, Scratch Org creation" },
  { eventType: "CIBUILD", module: "CI Jobs", description: "Trigger Build and Build History events" },
  { eventType: "DATALOADER", module: "Single Dataloader", description: "Extract, Insert, Upsert, Update, Delete operations" },
  { eventType: "FEATUREDEPLOYMENT", module: "nCino", description: "All events related to the Feature Deployment module" },
  { eventType: "DATARETRIEVALMIGRATION", module: "nCino", description: "All Salesforce events involving data migration and retrieval" },
  { eventType: "FEATURECREATION", module: "nCino", description: "Events related to Feature Creation" },
  { eventType: "DATALOADERPRO", module: "Dataloader Pro", description: "Upsert, Data Masking, Applied Mapping, Filters" },
  { eventType: "DATALOADERCONFIGURATION", module: "Dataloader", description: "All events related to Dataloader Configurations" },
  { eventType: "TESTENVIRONMENTSETUP", module: "Dataloader", description: "Upsert and Applied Mappings" },
  { eventType: "EZCOMMIT", module: "Version Control", description: "Prevalidate Commit and EZ-Commit" },
  { eventType: "MERGE", module: "Version Control", description: "Dry Run, Prevalidate Merge, and Merge only" },
] as const;

const VALID_EVENT_TYPE_NAMES = AUDIT_EVENT_TYPES.map((e) => e.eventType);
const DEPLOYMENT_BASE_PATH = "/rabit/api/deployments/v1";
const DEPLOYMENT_STATUSES = ["Successful", "Failed", "In Progress"] as const;

function deploymentPath(path: string): string {
  return `${DEPLOYMENT_BASE_PATH}${path}`;
}

function getDeploymentLabel(args: Record<string, unknown>): string {
  return encodeURIComponent(getStringArg(args.label, "label")!);
}

function getDeploymentIterationSegment(args: Record<string, unknown>): string {
  return encodeURIComponent(String(getNumberArg(args.iterationNumber, "iterationNumber")!));
}

function getDeploymentHeaders(args: Record<string, unknown>): JsonObject | undefined {
  return asJsonObject(args.headers, "headers");
}

function formatToolResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

const server = new Server(
  {
    name: "arm-mcp-server",
    version: "0.4.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "arm_quick_deploy",
        description:
          "POST /api/cijobs/v1/triggerquickdeploy/{ciJobName}/{buildNumber?}. Triggers quick deploy.",
        inputSchema: {
          type: "object",
          properties: {
            ciJobName: {
              type: "string",
              description: "Case-sensitive CI job name",
            },
            buildNumber: {
              type: "number",
              description: "Optional build number. If omitted, latest build is used.",
            },
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["ciJobName", "projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_start_rollback",
        description: "POST /api/cijobs/v1/rollback. Initiates rollback operation for CI job.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_abort_ci_job",
        description: "PUT /api/cijobs/v1/abort/{ciJobName}/{buildNumber?}. Aborts ongoing CI job.",
        inputSchema: {
          type: "object",
          properties: {
            ciJobName: {
              type: "string",
              description: "Case-sensitive CI job name",
            },
            buildNumber: {
              type: "number",
              description: "Optional build number. If omitted, latest build is used.",
            },
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["ciJobName", "projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_list_ci_jobs",
        description:
          "GET /api/cijobs/v1/listcijobs. Lists all CI jobs configured in ARM.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_ci_job_history",
        description:
          "GET /api/cijobs/v1/history/{ciJobName}. Retrieves CI job build history.",
        inputSchema: {
          type: "object",
          properties: {
            ciJobName: {
              type: "string",
              description: "Case-sensitive CI job name",
            },
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            from: {
              type: "number",
              description: "Start index for history range. Defaults to -1 (all).",
            },
            to: {
              type: "number",
              description: "End index for history range. Defaults to -1 (all).",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["ciJobName", "projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_latest_results",
        description:
          "GET /api/cijobs/v1/latestresults/{ciJobName}. Retrieves detailed latest results for a CI job.",
        inputSchema: {
          type: "object",
          properties: {
            ciJobName: {
              type: "string",
              description: "Case-sensitive CI job name",
            },
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["ciJobName", "projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_poll_job_status",
        description:
          "GET /api/cijobs/v1/pollstatus/{ciJobName}/{buildNumber?}. Polls the current status of a CI job build.",
        inputSchema: {
          type: "object",
          properties: {
            ciJobName: {
              type: "string",
              description: "Case-sensitive CI job name",
            },
            buildNumber: {
              type: "number",
              description: "Optional build number. If omitted, latest build is used.",
            },
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["ciJobName", "projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_rollback_history",
        description:
          "GET /api/cijobs/v1/rollback/history/{ciJobName}/{buildNumber?}. Fetches rollback history for a CI job build.",
        inputSchema: {
          type: "object",
          properties: {
            ciJobName: {
              type: "string",
              description: "Case-sensitive CI job name",
            },
            buildNumber: {
              type: "number",
              description: "Optional build number. If omitted, latest build is used.",
            },
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["ciJobName", "projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_rollback_details",
        description:
          "GET /api/cijobs/v1/rollback/{ciJobName}. Retrieves complete rollback information for a CI job.",
        inputSchema: {
          type: "object",
          properties: {
            ciJobName: {
              type: "string",
              description: "Case-sensitive CI job name",
            },
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["ciJobName", "projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_trigger_build",
        description:
          "POST /api/cijobs/v1/trigger. Triggers a new build for a CI job.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            title: {
              type: "string",
              description: "CI job build label",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["projectName", "title"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_update_baseline_revision",
        description:
          "POST /api/cijobs/v1/update/baselinerevision. Updates the baseline revision for a CI job.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: {
              type: "string",
              description: "Case-sensitive CI job project name",
            },
            baseLineRevision: {
              type: "string",
              description: "Baseline revision number/hash for the CI job",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["projectName", "baseLineRevision"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_list_deployments",
        description:
          "GET /rabit/api/deployments/v1/list. Lists deployments with optional status, date range, label, destination org, and limit filters.",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: DEPLOYMENT_STATUSES,
              description: "Optional deployment status filter",
            },
            fromDate: {
              type: "string",
              description: "Optional start date filter in YYYY-MM-DD format",
            },
            toDate: {
              type: "string",
              description: "Optional end date filter in YYYY-MM-DD format",
            },
            labelName: {
              type: "string",
              description: "Optional deployment label name filter",
            },
            destSfOrg: {
              type: "string",
              description: "Optional destination Salesforce org filter",
            },
            limit: {
              type: "number",
              description: "Optional maximum number of deployments to return. Maximum 100.",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: "arm_get_deployment",
        description:
          "GET /rabit/api/deployments/v1/{label}. Retrieves deployment-level details for a deployment label.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Deployment label name",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_get_deployment_components",
        description:
          "GET /rabit/api/deployments/v1/{label}/components. Retrieves component-level changes for a deployment.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Deployment label name",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_get_deployment_stories",
        description:
          "GET /rabit/api/deployments/v1/{label}/stories. Retrieves Jira stories and commit traceability for a deployment, optionally scoped to an iteration.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Deployment label name",
            },
            iterationNumber: {
              type: "number",
              description: "Optional deployment iteration number",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_get_deployment_promotion_log",
        description:
          "GET /rabit/api/deployments/v1/{label}/logs/{iterationNumber}. Retrieves the plain-text promotion log for a deployment iteration.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Deployment label name",
            },
            iterationNumber: {
              type: "number",
              description: "Deployment iteration number",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["label", "iterationNumber"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_get_deployment_test_coverage",
        description:
          "GET /rabit/api/deployments/v1/{label}/coverage/{iterationNumber}. Retrieves Apex test and code coverage details for a deployment iteration.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Deployment label name",
            },
            iterationNumber: {
              type: "number",
              description: "Deployment iteration number",
            },
            headers: {
              type: "object",
              description: "Optional extra headers",
              additionalProperties: true,
            },
          },
          required: ["label", "iterationNumber"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_call_api",
        description:
          "Generic ARM API request tool for additional endpoints not yet modeled as dedicated tools.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Endpoint path starting with /api/...",
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
            },
            query: {
              type: "object",
              additionalProperties: true,
            },
            body: {
              type: "object",
              additionalProperties: true,
            },
            headers: {
              type: "object",
              additionalProperties: true,
            },
          },
          required: ["path", "method"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_audit_get_logs",
        description:
          "GET /logs/audit_logs. Retrieves SIEM audit logs from AutoRABIT with optional filters. Returns CEF-formatted log entries.",
        inputSchema: {
          type: "object",
          properties: {
            startTime: {
              type: "string",
              description:
                "Start time in ISO 8601 format (YYYY-MM-DDThh:mm:ss). Defaults to current day if omitted.",
            },
            maxResults: {
              type: "number",
              description: "Maximum number of results to return. Default is 1000.",
            },
            eventType: {
              type: "string",
              description:
                "Comma-separated event types to filter. Valid values: LOGIN, DEPLOYMENT, CIBUILD, DATALOADER, FEATUREDEPLOYMENT, DATARETRIEVALMIGRATION, FEATURECREATION, DATALOADERPRO, DATALOADERCONFIGURATION, TESTENVIRONMENTSETUP, EZCOMMIT, MERGE. If omitted, all events are returned.",
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: "arm_audit_download_logs",
        description:
          "GET /logs/audit_logs/download. Downloads SIEM audit logs as a ZIP file for a date range (max 90 days). Returns the constructed download URL and request metadata.",
        inputSchema: {
          type: "object",
          properties: {
            startTime: {
              type: "string",
              description: "Start date in ISO 8601 format (YYYY-MM-DDThh:mm:ss). Required.",
            },
            endTime: {
              type: "string",
              description:
                "End date in ISO 8601 format (YYYY-MM-DDThh:mm:ss). Optional; defaults to current day. Range must be within 90 days of startTime.",
            },
          },
          required: ["startTime"],
          additionalProperties: false,
        },
      },
      {
        name: "arm_audit_list_event_types",
        description:
          "Returns the 12 known ARM SIEM audit event types with their associated modules and descriptions. No API call is made; this is a local reference.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments ?? {};

  // --- Audit log tools (separate config + Bearer auth) ---

  if (toolName === "arm_audit_list_event_types") {
    return formatToolResult(AUDIT_EVENT_TYPES);
  }

  if (toolName === "arm_audit_get_logs") {
    const auditConfig = getAuditConfig();
    const query: JsonObject = {};

    const startTime = getStringArg(args.startTime, "startTime", false);
    if (startTime) query.startTime = startTime;

    const maxResultsRaw = args.maxResults;
    if (typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw)) {
      query.maxResults = maxResultsRaw;
    }

    const eventTypeRaw = getStringArg(args.eventType, "eventType", false);
    if (eventTypeRaw) {
      const types = eventTypeRaw.split(",").map((t) => t.trim());
      for (const t of types) {
        if (!VALID_EVENT_TYPE_NAMES.includes(t as (typeof VALID_EVENT_TYPE_NAMES)[number])) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid eventType "${t}". Valid values: ${VALID_EVENT_TYPE_NAMES.join(", ")}`,
          );
        }
      }
      query.eventType = eventTypeRaw;
    }

    const result = await auditRequest({
      config: auditConfig,
      path: "/logs/audit_logs",
      method: "GET",
      query,
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_audit_download_logs") {
    const auditConfig = getAuditConfig();
    const startTime = getStringArg(args.startTime, "startTime")!;
    const endTime = getStringArg(args.endTime, "endTime", false);

    const query: JsonObject = { startTime };
    if (endTime) query.endTime = endTime;

    const downloadUrl = buildUrl(auditConfig.baseUrl, "/logs/audit_logs/download", query);

    const result = await auditRequest({
      config: auditConfig,
      path: "/logs/audit_logs/download",
      method: "GET",
      query,
    });

    return formatToolResult({
      downloadUrl,
      startTime,
      endTime: endTime ?? "(current day)",
      note: "The API returns a ZIP file. If the response status is 200, the download was successful. Use the downloadUrl with a Bearer token to retrieve the file externally.",
      status: result.status,
      headers: result.headers,
    });
  }

  // --- CI Jobs tools (ARM config + token header auth) ---

  const config = getConfig();

  if (toolName === "arm_quick_deploy") {
    const ciJobName = encodeURIComponent(getStringArg(args.ciJobName, "ciJobName")!);
    const buildNumberRaw = args.buildNumber;
    const buildSegment =
      typeof buildNumberRaw === "number" && Number.isFinite(buildNumberRaw)
        ? `/${String(buildNumberRaw)}`
        : "";

    const result = await armRequest({
      config,
      path: `/api/cijobs/v1/triggerquickdeploy/${ciJobName}${buildSegment}`,
      method: "POST",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_start_rollback") {
    const result = await armRequest({
      config,
      path: "/api/cijobs/v1/rollback",
      method: "POST",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_abort_ci_job") {
    const ciJobName = encodeURIComponent(getStringArg(args.ciJobName, "ciJobName")!);
    const buildNumberRaw = args.buildNumber;
    const buildSegment =
      typeof buildNumberRaw === "number" && Number.isFinite(buildNumberRaw)
        ? `/${String(buildNumberRaw)}`
        : "";

    const result = await armRequest({
      config,
      path: `/api/cijobs/v1/abort/${ciJobName}${buildSegment}`,
      method: "PUT",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_list_ci_jobs") {
    const result = await armRequest({
      config,
      path: "/api/cijobs/v1/listcijobs",
      method: "GET",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_ci_job_history") {
    const ciJobName = encodeURIComponent(getStringArg(args.ciJobName, "ciJobName")!);
    const fromRaw = args.from;
    const toRaw = args.to;
    const query: JsonObject = {};
    if (typeof fromRaw === "number" && Number.isFinite(fromRaw)) {
      query.from = fromRaw;
    } else {
      query.from = -1;
    }
    if (typeof toRaw === "number" && Number.isFinite(toRaw)) {
      query.to = toRaw;
    } else {
      query.to = -1;
    }

    const result = await armRequest({
      config,
      path: `/api/cijobs/v1/history/${ciJobName}`,
      method: "GET",
      query,
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_latest_results") {
    const ciJobName = encodeURIComponent(getStringArg(args.ciJobName, "ciJobName")!);

    const result = await armRequest({
      config,
      path: `/api/cijobs/v1/latestresults/${ciJobName}`,
      method: "GET",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_poll_job_status") {
    const ciJobName = encodeURIComponent(getStringArg(args.ciJobName, "ciJobName")!);
    const buildNumberRaw = args.buildNumber;
    const buildSegment =
      typeof buildNumberRaw === "number" && Number.isFinite(buildNumberRaw)
        ? `/${String(buildNumberRaw)}`
        : "";

    const result = await armRequest({
      config,
      path: `/api/cijobs/v1/pollstatus/${ciJobName}${buildSegment}`,
      method: "GET",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_rollback_history") {
    const ciJobName = encodeURIComponent(getStringArg(args.ciJobName, "ciJobName")!);
    const buildNumberRaw = args.buildNumber;
    const buildSegment =
      typeof buildNumberRaw === "number" && Number.isFinite(buildNumberRaw)
        ? `/${String(buildNumberRaw)}`
        : "";

    const result = await armRequest({
      config,
      path: `/api/cijobs/v1/rollback/history/${ciJobName}${buildSegment}`,
      method: "GET",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_rollback_details") {
    const ciJobName = encodeURIComponent(getStringArg(args.ciJobName, "ciJobName")!);

    const result = await armRequest({
      config,
      path: `/api/cijobs/v1/rollback/${ciJobName}`,
      method: "GET",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_trigger_build") {
    const result = await armRequest({
      config,
      path: "/api/cijobs/v1/trigger",
      method: "POST",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        title: getStringArg(args.title, "title"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_update_baseline_revision") {
    const result = await armRequest({
      config,
      path: "/api/cijobs/v1/update/baselinerevision",
      method: "POST",
      body: {
        projectName: getStringArg(args.projectName, "projectName"),
        baseLineRevision: getStringArg(args.baseLineRevision, "baseLineRevision"),
      },
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_list_deployments") {
    const query: JsonObject = {};

    const status = getStringArg(args.status, "status", false);
    if (status) {
      if (!DEPLOYMENT_STATUSES.includes(status as (typeof DEPLOYMENT_STATUSES)[number])) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid status "${status}". Valid values: ${DEPLOYMENT_STATUSES.join(", ")}`,
        );
      }
      query.status = status;
    }

    const fromDate = getStringArg(args.fromDate, "fromDate", false);
    if (fromDate) query.fromDate = fromDate;

    const toDate = getStringArg(args.toDate, "toDate", false);
    if (toDate) query.toDate = toDate;

    const labelName = getStringArg(args.labelName, "labelName", false);
    if (labelName) query.labelName = labelName;

    const destSfOrg = getStringArg(args.destSfOrg, "destSfOrg", false);
    if (destSfOrg) query.destSfOrg = destSfOrg;

    const limit = getNumberArg(args.limit, "limit", false);
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new McpError(ErrorCode.InvalidParams, "limit must be an integer from 1 to 100");
      }
      query.limit = limit;
    }

    const result = await armRequest({
      config,
      path: deploymentPath("/list"),
      method: "GET",
      query,
      extraHeaders: getDeploymentHeaders(args),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_get_deployment") {
    const label = getDeploymentLabel(args);

    const result = await armRequest({
      config,
      path: deploymentPath(`/${label}`),
      method: "GET",
      extraHeaders: getDeploymentHeaders(args),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_get_deployment_components") {
    const label = getDeploymentLabel(args);

    const result = await armRequest({
      config,
      path: deploymentPath(`/${label}/components`),
      method: "GET",
      extraHeaders: getDeploymentHeaders(args),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_get_deployment_stories") {
    const label = getDeploymentLabel(args);
    const iterationNumber = getNumberArg(args.iterationNumber, "iterationNumber", false);
    const query: JsonObject = {};
    if (iterationNumber !== undefined) query.iterationNumber = iterationNumber;

    const result = await armRequest({
      config,
      path: deploymentPath(`/${label}/stories`),
      method: "GET",
      query,
      extraHeaders: getDeploymentHeaders(args),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_get_deployment_promotion_log") {
    const label = getDeploymentLabel(args);
    const iterationNumber = getDeploymentIterationSegment(args);

    const result = await armRequest({
      config,
      path: deploymentPath(`/${label}/logs/${iterationNumber}`),
      method: "GET",
      extraHeaders: getDeploymentHeaders(args),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_get_deployment_test_coverage") {
    const label = getDeploymentLabel(args);
    const iterationNumber = getDeploymentIterationSegment(args);

    const result = await armRequest({
      config,
      path: deploymentPath(`/${label}/coverage/${iterationNumber}`),
      method: "GET",
      extraHeaders: getDeploymentHeaders(args),
    });

    return formatToolResult(result);
  }

  if (toolName === "arm_call_api") {
    const path = typeof args.path === "string" ? args.path : undefined;
    const method = typeof args.method === "string" ? args.method.toUpperCase() : undefined;

    if (!path || !method) {
      throw new McpError(ErrorCode.InvalidParams, "path and method are required");
    }

    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new McpError(ErrorCode.InvalidParams, "Invalid method");
    }

    const result = await armRequest({
      config,
      path,
      method: method as HttpMethod,
      query: asJsonObject(args.query, "query"),
      body: asJsonObject(args.body, "body"),
      extraHeaders: asJsonObject(args.headers, "headers"),
    });

    return formatToolResult(result);
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "arm://docs/overview",
        name: "ARM MCP Overview",
        description: "Current ARM API tool mappings and utilities",
        mimeType: "application/json",
      },
      {
        uri: "arm://docs/cijobs-v1",
        name: "ARM CIJobs v1 APIs",
        description: "Modeled APIs from /api/cijobs/v1",
        mimeType: "application/json",
      },
      {
        uri: "arm://docs/deployments-v1",
        name: "ARM Deployments v1 APIs",
        description: "Modeled deployment reporting APIs from /rabit/api/deployments/v1",
        mimeType: "application/json",
      },
      {
        uri: "arm://docs/auth",
        name: "ARM Auth Guide",
        description: "Required environment variables and request headers",
        mimeType: "text/markdown",
      },
      {
        uri: "arm://docs/audit-logs",
        name: "ARM SIEM Audit Logs",
        description: "Audit log retrieval APIs, event types, and CEF response format",
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "arm://docs/overview") {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              server: "arm-mcp-server",
              version: "0.4.0",
              capabilities: ["tools", "resources", "prompts"],
              modeledApis: {
                ciJobs: [
                  "GET /api/cijobs/v1/listcijobs",
                  "GET /api/cijobs/v1/history/{ciJobName}",
                  "GET /api/cijobs/v1/latestresults/{ciJobName}",
                  "GET /api/cijobs/v1/pollstatus/{ciJobName}/{buildNumber?}",
                  "GET /api/cijobs/v1/rollback/history/{ciJobName}/{buildNumber?}",
                  "GET /api/cijobs/v1/rollback/{ciJobName}",
                  "POST /api/cijobs/v1/trigger",
                  "POST /api/cijobs/v1/update/baselinerevision",
                  "POST /api/cijobs/v1/triggerquickdeploy/{ciJobName}/{buildNumber?}",
                  "POST /api/cijobs/v1/rollback",
                  "PUT /api/cijobs/v1/abort/{ciJobName}/{buildNumber?}",
                ],
                auditLogs: [
                  "GET /logs/audit_logs",
                  "GET /logs/audit_logs/download",
                ],
                deployments: [
                  "GET /rabit/api/deployments/v1/list",
                  "GET /rabit/api/deployments/v1/{label}",
                  "GET /rabit/api/deployments/v1/{label}/components",
                  "GET /rabit/api/deployments/v1/{label}/stories",
                  "GET /rabit/api/deployments/v1/{label}/logs/{iterationNumber}",
                  "GET /rabit/api/deployments/v1/{label}/coverage/{iterationNumber}",
                ],
              },
              utilityFeatures: [
                "CI Jobs and Deployments: token header auth (ARM_API_TOKEN)",
                "Audit Logs: Bearer token auth (ARM_AUDIT_API_TOKEN)",
                "Base URL normalization with implicit https",
                "Timeout + retries",
                "Structured JSON response wrapping",
                "Generic endpoint tool",
              ],
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  if (uri === "arm://docs/cijobs-v1") {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            [
              {
                tool: "arm_list_ci_jobs",
                method: "GET",
                path: "/api/cijobs/v1/listcijobs",
                body: ["projectName", "title"],
              },
              {
                tool: "arm_ci_job_history",
                method: "GET",
                path: "/api/cijobs/v1/history/{ciJobName}",
                query: ["from", "to"],
                body: ["projectName", "title"],
              },
              {
                tool: "arm_latest_results",
                method: "GET",
                path: "/api/cijobs/v1/latestresults/{ciJobName}",
                body: ["projectName", "title"],
              },
              {
                tool: "arm_poll_job_status",
                method: "GET",
                path: "/api/cijobs/v1/pollstatus/{ciJobName}/{buildNumber?}",
                body: ["projectName", "title"],
              },
              {
                tool: "arm_rollback_history",
                method: "GET",
                path: "/api/cijobs/v1/rollback/history/{ciJobName}/{buildNumber?}",
                body: ["projectName", "title"],
              },
              {
                tool: "arm_rollback_details",
                method: "GET",
                path: "/api/cijobs/v1/rollback/{ciJobName}",
                body: ["projectName", "title"],
              },
              {
                tool: "arm_trigger_build",
                method: "POST",
                path: "/api/cijobs/v1/trigger",
                body: ["projectName", "title"],
              },
              {
                tool: "arm_update_baseline_revision",
                method: "POST",
                path: "/api/cijobs/v1/update/baselinerevision",
                body: ["projectName", "baseLineRevision"],
              },
              {
                tool: "arm_quick_deploy",
                method: "POST",
                path: "/api/cijobs/v1/triggerquickdeploy/{ciJobName}/{buildNumber?}",
                body: ["projectName", "title"],
              },
              {
                tool: "arm_start_rollback",
                method: "POST",
                path: "/api/cijobs/v1/rollback",
                body: ["projectName", "title"],
              },
              {
                tool: "arm_abort_ci_job",
                method: "PUT",
                path: "/api/cijobs/v1/abort/{ciJobName}/{buildNumber?}",
                body: ["projectName", "title"],
              },
            ],
            null,
            2,
          ),
        },
      ],
    };
  }

  if (uri === "arm://docs/deployments-v1") {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            [
              {
                tool: "arm_list_deployments",
                method: "GET",
                path: "/rabit/api/deployments/v1/list",
                query: ["status", "fromDate", "toDate", "labelName", "destSfOrg", "limit"],
                validStatuses: DEPLOYMENT_STATUSES,
                maxLimit: 100,
              },
              {
                tool: "arm_get_deployment",
                method: "GET",
                path: "/rabit/api/deployments/v1/{label}",
                pathParams: ["label"],
              },
              {
                tool: "arm_get_deployment_components",
                method: "GET",
                path: "/rabit/api/deployments/v1/{label}/components",
                pathParams: ["label"],
              },
              {
                tool: "arm_get_deployment_stories",
                method: "GET",
                path: "/rabit/api/deployments/v1/{label}/stories",
                pathParams: ["label"],
                query: ["iterationNumber"],
              },
              {
                tool: "arm_get_deployment_promotion_log",
                method: "GET",
                path: "/rabit/api/deployments/v1/{label}/logs/{iterationNumber}",
                pathParams: ["label", "iterationNumber"],
                responseFormat: "Plain text promotion log",
              },
              {
                tool: "arm_get_deployment_test_coverage",
                method: "GET",
                path: "/rabit/api/deployments/v1/{label}/coverage/{iterationNumber}",
                pathParams: ["label", "iterationNumber"],
                responseFormat: "JSON test coverage report",
              },
            ],
            null,
            2,
          ),
        },
      ],
    };
  }

  if (uri === "arm://docs/auth") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text: [
            "# ARM Auth",
            "",
            "## CI Jobs and Deployment APIs",
            "",
            "Set these environment variables before starting the MCP server:",
            "",
            "- `ARM_BASE_URL`: Your ARM org URL (for example `pilot.autorabit.com` or `https://pilot.autorabit.com`)",
            "- `ARM_API_TOKEN`: API token sent as `token` header",
            "- `ARM_TIMEOUT_MS` (optional): request timeout in milliseconds, default `30000`",
            "- `ARM_MAX_RETRIES` (optional): retry count for network failures, default `2`",
            "",
            "Deployment reporting tools call `/rabit/api/deployments/v1/...` and share the same `token` header auth.",
            "",
            "Default headers sent:",
            "- `token: <ARM_API_TOKEN>`",
            "- `Accept: application/json`",
            "- `Content-Type: application/json` when body exists",
            "",
            "## SIEM Audit Logs API",
            "",
            "The audit logs API uses a **separate** base URL and Bearer token (not shared with CI Jobs):",
            "",
            "- `ARM_AUDIT_BASE_URL`: Audit logs domain (for example `auditlogs.autorabit.com`)",
            "- `ARM_AUDIT_API_TOKEN`: Bearer token sent as `Authorization: Bearer <token>` header",
            "- `ARM_AUDIT_TIMEOUT_MS` (optional): request timeout in milliseconds, default `30000`",
            "- `ARM_AUDIT_MAX_RETRIES` (optional): retry count for network failures, default `2`",
            "",
            "Default headers sent:",
            "- `Authorization: Bearer <ARM_AUDIT_API_TOKEN>`",
            "- `Content-Type: application/json`",
          ].join("\n"),
        },
      ],
    };
  }

  if (uri === "arm://docs/audit-logs") {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              description: "AutoRABIT SIEM Audit Logs Retrieval API",
              baseUrl: "https://<prefix>auditlogs.autorabit.com",
              auth: "Authorization: Bearer <ARM_AUDIT_API_TOKEN>",
              endpoints: [
                {
                  tool: "arm_audit_get_logs",
                  method: "GET",
                  path: "/logs/audit_logs",
                  query: ["startTime", "maxResults", "eventType"],
                  responseFormat: "Array of CEF (Common Event Format) strings",
                },
                {
                  tool: "arm_audit_download_logs",
                  method: "GET",
                  path: "/logs/audit_logs/download",
                  query: ["startTime", "endTime"],
                  responseFormat: "ZIP file (max 90-day range)",
                },
              ],
              eventTypes: AUDIT_EVENT_TYPES,
              cefFormat: "timestamp CEF:version|vendor|product|productVersion|eventType|name|severity|extensions",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "arm_quick_deploy_guide",
        description: "Guide the model to execute quick deploy via ARM CI Jobs APIs",
        arguments: [
          {
            name: "ci_job_name",
            required: true,
            description: "Case-sensitive CI job name",
          },
          {
            name: "project_name",
            required: true,
            description: "Case-sensitive CI project name",
          },
          {
            name: "title",
            required: true,
            description: "Build label",
          },
          {
            name: "build_number",
            required: false,
            description: "Optional build number",
          },
        ],
      },
      {
        name: "arm_rollback_guide",
        description: "Guide the model to decide and execute rollback via ARM APIs",
        arguments: [
          {
            name: "project_name",
            required: true,
            description: "Case-sensitive CI project name",
          },
          {
            name: "title",
            required: true,
            description: "Build label",
          },
        ],
      },
      {
        name: "arm_trigger_build_guide",
        description: "Guide the model to trigger a new CI build and monitor its progress",
        arguments: [
          {
            name: "project_name",
            required: true,
            description: "Case-sensitive CI project name",
          },
          {
            name: "title",
            required: true,
            description: "Build label",
          },
        ],
      },
      {
        name: "arm_poll_status_guide",
        description: "Guide the model to poll CI job status and interpret the results",
        arguments: [
          {
            name: "ci_job_name",
            required: true,
            description: "Case-sensitive CI job name",
          },
          {
            name: "project_name",
            required: true,
            description: "Case-sensitive CI project name",
          },
          {
            name: "title",
            required: true,
            description: "Build label",
          },
          {
            name: "build_number",
            required: false,
            description: "Optional build number to poll",
          },
        ],
      },
      {
        name: "arm_audit_logs_guide",
        description:
          "Guide the model to query and analyze SIEM audit logs from AutoRABIT ARM",
        arguments: [
          {
            name: "event_types",
            required: false,
            description:
              "Comma-separated event types (e.g. LOGIN,DEPLOYMENT). Use arm_audit_list_event_types to discover valid values.",
          },
          {
            name: "start_time",
            required: false,
            description: "Start time in ISO 8601 format (YYYY-MM-DDThh:mm:ss)",
          },
          {
            name: "max_results",
            required: false,
            description: "Maximum number of log entries to retrieve (default 1000)",
          },
        ],
      },
      {
        name: "arm_deployment_report_guide",
        description:
          "Guide the model to collect deployment detail, components, Jira stories, logs, and test coverage for a deployment report",
        arguments: [
          {
            name: "label",
            required: true,
            description: "Deployment label name",
          },
          {
            name: "iteration_number",
            required: false,
            description: "Deployment iteration number for logs and coverage. Use latestIterationNumber from detail if omitted.",
          },
        ],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === "arm_quick_deploy_guide") {
    const ciJobName = typeof args.ci_job_name === "string" ? args.ci_job_name : "<ci_job_name>";
    const projectName = typeof args.project_name === "string" ? args.project_name : "<project_name>";
    const title = typeof args.title === "string" ? args.title : "<title>";
    const buildNumber = typeof args.build_number === "string" ? args.build_number : "<optional_build_number>";

    return {
      description: "Quick deploy execution flow",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Execute quick deploy for this ARM CI job:",
              `- ci_job_name: ${ciJobName}`,
              `- project_name: ${projectName}`,
              `- title: ${title}`,
              `- build_number: ${buildNumber}`,
              "",
              "Use tool `arm_quick_deploy` and summarize:",
              "- HTTP status",
              "- deployment initiation message",
              "- rollback validation flag",
            ].join("\n"),
          },
        },
      ],
    };
  }

  if (name === "arm_rollback_guide") {
    const projectName = typeof args.project_name === "string" ? args.project_name : "<project_name>";
    const title = typeof args.title === "string" ? args.title : "<title>";

    return {
      description: "Rollback decision and execution flow",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Attempt rollback for this ARM CI job payload:",
              `- project_name: ${projectName}`,
              `- title: ${title}`,
              "",
              "Call `arm_start_rollback` and classify result as:",
              "- rollback initiated",
              "- not eligible",
              "- unknown",
              "",
              "Then provide next action recommendation.",
            ].join("\n"),
          },
        },
      ],
    };
  }

  if (name === "arm_trigger_build_guide") {
    const projectName = typeof args.project_name === "string" ? args.project_name : "<project_name>";
    const title = typeof args.title === "string" ? args.title : "<title>";

    return {
      description: "Trigger build and monitor execution flow",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Trigger a new CI build for this ARM CI job:",
              `- project_name: ${projectName}`,
              `- title: ${title}`,
              "",
              "Steps:",
              "1. Call `arm_trigger_build` with the above payload",
              "2. Note the returned build number (cyclenum)",
              "3. Call `arm_poll_job_status` to monitor progress",
              "4. Summarize: build number, current status, and whether rollback is validated",
            ].join("\n"),
          },
        },
      ],
    };
  }

  if (name === "arm_poll_status_guide") {
    const ciJobName = typeof args.ci_job_name === "string" ? args.ci_job_name : "<ci_job_name>";
    const projectName = typeof args.project_name === "string" ? args.project_name : "<project_name>";
    const title = typeof args.title === "string" ? args.title : "<title>";
    const buildNumber = typeof args.build_number === "string" ? args.build_number : "<optional_build_number>";

    return {
      description: "Poll job status and interpret results",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Poll the status of this ARM CI job build:",
              `- ci_job_name: ${ciJobName}`,
              `- project_name: ${projectName}`,
              `- title: ${title}`,
              `- build_number: ${buildNumber}`,
              "",
              "Call `arm_poll_job_status` and classify the result as:",
              "- Completed successfully",
              "- In progress",
              "- Failed",
              "",
              "Report: build status, quick deploy status, rollback validation flag.",
              "If in progress, suggest polling again after a short delay.",
            ].join("\n"),
          },
        },
      ],
    };
  }

  if (name === "arm_audit_logs_guide") {
    const eventTypes =
      typeof args.event_types === "string" ? args.event_types : "<optional_event_types>";
    const startTime =
      typeof args.start_time === "string" ? args.start_time : "<optional_start_time>";
    const maxResults =
      typeof args.max_results === "string" ? args.max_results : "1000";

    return {
      description: "Audit log query and analysis flow",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Query and analyze SIEM audit logs from AutoRABIT ARM.",
              "",
              "Parameters:",
              `- event_types: ${eventTypes}`,
              `- start_time: ${startTime}`,
              `- max_results: ${maxResults}`,
              "",
              "Steps:",
              "1. Call `arm_audit_list_event_types` to review available event types and their modules",
              "2. Call `arm_audit_get_logs` with the specified filters (startTime, maxResults, eventType)",
              "3. Parse the CEF-formatted log entries — each line follows: timestamp CEF:version|vendor|product|productVersion|eventType|name|severity|extensions",
              "4. Summarize findings:",
              "   - Total number of log entries returned",
              "   - Breakdown by event type",
              "   - Notable patterns (failed logins, deployment activity, recent commits/merges)",
              "   - Any anomalies or security concerns",
              "5. If relevant, suggest narrower queries for deeper investigation",
            ].join("\n"),
          },
        },
      ],
    };
  }

  if (name === "arm_deployment_report_guide") {
    const label = typeof args.label === "string" ? args.label : "<deployment_label>";
    const iterationNumber =
      typeof args.iteration_number === "string" ? args.iteration_number : "<latest_iteration_number>";

    return {
      description: "Deployment reporting and traceability flow",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Generate a deployment report for this ARM deployment:",
              `- label: ${label}`,
              `- iteration_number: ${iterationNumber}`,
              "",
              "Steps:",
              "1. Call `arm_get_deployment` for summary details and latest iteration metadata",
              "2. Call `arm_get_deployment_components` for component changes",
              "3. Call `arm_get_deployment_stories` for Jira-linked commit traceability",
              "4. Call `arm_get_deployment_promotion_log` for the selected iteration",
              "5. Call `arm_get_deployment_test_coverage` for the selected iteration",
              "",
              "Summarize: deployment status, source and target environments, triggering user, changed components by type and change type, Jira stories with commits, notable log diagnostics, and test coverage pass/fail counts.",
              "If iteration_number is omitted, use the latestIterationNumber from `arm_get_deployment` for logs and coverage.",
            ].join("\n"),
          },
        },
      ],
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start ARM MCP server:", error);
  process.exit(1);
});
