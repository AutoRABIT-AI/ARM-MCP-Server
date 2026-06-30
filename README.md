# ARM MCP Server

[![CI](https://github.com/Presh-AR/ARM-MCP-Server/actions/workflows/ci.yml/badge.svg)](https://github.com/Presh-AR/ARM-MCP-Server/actions/workflows/ci.yml)

MCP server for AutoRABIT ARM APIs, covering CI Jobs v1 endpoints, Deployment Reporting v1 endpoints, and SIEM Audit Logs.

## Modeled APIs

### CI Jobs v1

- `GET /api/cijobs/v1/listcijobs`
- `GET /api/cijobs/v1/history/{ciJobName}`
- `GET /api/cijobs/v1/latestresults/{ciJobName}`
- `GET /api/cijobs/v1/pollstatus/{ciJobName}/{buildNumber?}`
- `GET /api/cijobs/v1/rollback/history/{ciJobName}/{buildNumber?}`
- `GET /api/cijobs/v1/rollback/{ciJobName}`
- `POST /api/cijobs/v1/trigger`
- `POST /api/cijobs/v1/update/baselinerevision`
- `POST /api/cijobs/v1/triggerquickdeploy/{ciJobName}/{buildNumber?}`
- `POST /api/cijobs/v1/rollback`
- `PUT /api/cijobs/v1/abort/{ciJobName}/{buildNumber?}`

### Deployment Reporting v1

- `GET /rabit/api/deployments/v1/list`
- `GET /rabit/api/deployments/v1/{label}`
- `GET /rabit/api/deployments/v1/{label}/components`
- `GET /rabit/api/deployments/v1/{label}/stories`
- `GET /rabit/api/deployments/v1/{label}/logs/{iterationNumber}`
- `GET /rabit/api/deployments/v1/{label}/coverage/{iterationNumber}`

### SIEM Audit Logs

- `GET /logs/audit_logs` — query audit logs with optional filters
- `GET /logs/audit_logs/download` — download audit logs as ZIP (max 90-day range)

## MCP Tools

### CI Jobs

- `arm_list_ci_jobs` — list all CI jobs
- `arm_ci_job_history` — retrieve CI job build history
- `arm_latest_results` — get latest results for a CI job
- `arm_poll_job_status` — poll current build status
- `arm_rollback_history` — fetch rollback history
- `arm_rollback_details` — view rollback information
- `arm_trigger_build` — trigger a new CI build
- `arm_update_baseline_revision` — update baseline revision
- `arm_quick_deploy` — trigger quick deployment
- `arm_start_rollback` — initiate rollback
- `arm_abort_ci_job` — abort an ongoing CI job
- `arm_call_api` — generic fallback for any ARM endpoint

### Deployments

- `arm_list_deployments` — list deployments with optional status, date, label, destination org, and limit filters
- `arm_get_deployment` — retrieve deployment summary and iteration metadata
- `arm_get_deployment_components` — retrieve component-level deployment changes
- `arm_get_deployment_stories` — retrieve Jira stories and commit traceability
- `arm_get_deployment_promotion_log` — retrieve the plain-text promotion log for an iteration
- `arm_get_deployment_test_coverage` — retrieve Apex test and code coverage for an iteration

### Audit Logs

- `arm_audit_get_logs` — query SIEM audit logs with optional time, count, and event type filters
- `arm_audit_download_logs` — download audit logs as ZIP for a date range
- `arm_audit_list_event_types` — list the 12 known event types with descriptions (local, no API call)

## MCP Resources

- `arm://docs/overview`
- `arm://docs/cijobs-v1`
- `arm://docs/deployments-v1`
- `arm://docs/auth`
- `arm://docs/audit-logs`

## MCP Prompts

- `arm_quick_deploy_guide`
- `arm_rollback_guide`
- `arm_trigger_build_guide`
- `arm_poll_status_guide`
- `arm_deployment_report_guide`
- `arm_audit_logs_guide`

## Authentication

### CI Jobs and Deployment APIs

ARM expects an API token in a `token` header.

Required env vars:

- `ARM_BASE_URL` (example: `pilot.autorabit.com` or `https://pilot.autorabit.com`)
- `ARM_API_TOKEN`

Optional env vars:

- `ARM_TIMEOUT_MS` (default `30000`)
- `ARM_MAX_RETRIES` (default `2`)

Deployment tools call `/rabit/api/deployments/v1/...` on the same ARM host and use the same `ARM_API_TOKEN`.

### SIEM Audit Logs API

The audit logs API uses a **separate** base URL and Bearer token (not shared with CI Jobs).

Required env vars:

- `ARM_AUDIT_BASE_URL` (example: `auditlogs.autorabit.com`)
- `ARM_AUDIT_API_TOKEN` — sent as `Authorization: Bearer <token>`

Optional env vars:

- `ARM_AUDIT_TIMEOUT_MS` (default `30000`)
- `ARM_AUDIT_MAX_RETRIES` (default `2`)

## Setup

```bash
npm install
cp .env.example .env
# edit .env
npm run build
```

## Run

```bash
npm run dev
```

or production:

```bash
npm run build
npm start
```

## MCP client config (stdio)

```json
{
  "mcpServers": {
    "arm": {
      "command": "node",
      "args": ["/absolute/path/to/arm-mcp-server/dist/index.js"],
      "env": {
        "ARM_BASE_URL": "pilot.autorabit.com",
        "ARM_API_TOKEN": "YOUR_CI_JOBS_TOKEN",
        "ARM_AUDIT_BASE_URL": "auditlogs.autorabit.com",
        "ARM_AUDIT_API_TOKEN": "YOUR_AUDIT_BEARER_TOKEN"
      }
    }
  }
}
```

## Docker

### Build the image

```bash
docker build -t arm-mcp-server .
```

### Run interactively

```bash
docker run -i --rm \
  -e ARM_BASE_URL=pilot.autorabit.com \
  -e ARM_API_TOKEN=YOUR_CI_JOBS_TOKEN \
  -e ARM_AUDIT_BASE_URL=auditlogs.autorabit.com \
  -e ARM_AUDIT_API_TOKEN=YOUR_AUDIT_BEARER_TOKEN \
  arm-mcp-server
```

### MCP client config (Docker)

```json
{
  "mcpServers": {
    "arm": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "ARM_BASE_URL",
        "-e", "ARM_API_TOKEN",
        "-e", "ARM_AUDIT_BASE_URL",
        "-e", "ARM_AUDIT_API_TOKEN",
        "arm-mcp-server"
      ],
      "env": {
        "ARM_BASE_URL": "pilot.autorabit.com",
        "ARM_API_TOKEN": "YOUR_CI_JOBS_TOKEN",
        "ARM_AUDIT_BASE_URL": "auditlogs.autorabit.com",
        "ARM_AUDIT_API_TOKEN": "YOUR_AUDIT_BEARER_TOKEN"
      }
    }
  }
}
```

### docker-compose

```bash
cp .env.example .env
# edit .env with your credentials
docker compose run --rm arm-mcp-server
```

## Tool payloads

### `arm_list_ci_jobs`

```json
{
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_ci_job_history`

```json
{
  "ciJobName": "BuildOnCommitNoRevision",
  "projectName": "MyProject",
  "title": "Release 1.2.3",
  "from": -1,
  "to": -1
}
```

### `arm_latest_results`

```json
{
  "ciJobName": "BuildOnCommitNoRevision",
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_poll_job_status`

```json
{
  "ciJobName": "BuildOnCommitNoRevision",
  "buildNumber": 7,
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_rollback_history`

```json
{
  "ciJobName": "BuildOnCommitNoRevision",
  "buildNumber": 7,
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_rollback_details`

```json
{
  "ciJobName": "BuildOnCommitNoRevision",
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_trigger_build`

```json
{
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_update_baseline_revision`

```json
{
  "projectName": "MyProject",
  "baseLineRevision": "26cXXX"
}
```

### `arm_quick_deploy`

```json
{
  "ciJobName": "BuildOnCommitNoRevision",
  "buildNumber": 7,
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_start_rollback`

```json
{
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_abort_ci_job`

```json
{
  "ciJobName": "BuildOnCommitNoRevision",
  "buildNumber": 7,
  "projectName": "MyProject",
  "title": "Release 1.2.3"
}
```

### `arm_list_deployments`

```json
{
  "status": "Successful",
  "fromDate": "2025-01-01",
  "toDate": "2025-06-30",
  "labelName": "hotfix",
  "destSfOrg": "prod@company.com",
  "limit": 25
}
```

### `arm_get_deployment`

```json
{
  "label": "Deploy-March-Release-v1"
}
```

### `arm_get_deployment_components`

```json
{
  "label": "Deploy-March-Release-v1"
}
```

### `arm_get_deployment_stories`

```json
{
  "label": "Deploy-March-Release-v1",
  "iterationNumber": 1
}
```

### `arm_get_deployment_promotion_log`

```json
{
  "label": "Deploy-March-Release-v1",
  "iterationNumber": 1
}
```

### `arm_get_deployment_test_coverage`

```json
{
  "label": "Deploy-March-Release-v1",
  "iterationNumber": 1
}
```

### `arm_audit_get_logs`

```json
{
  "startTime": "2024-01-15T00:00:00",
  "maxResults": 500,
  "eventType": "LOGIN,DEPLOYMENT"
}
```

### `arm_audit_download_logs`

```json
{
  "startTime": "2024-01-01T00:00:00",
  "endTime": "2024-03-01T00:00:00"
}
```

### `arm_audit_list_event_types`

```json
{}
```
