# ARM MCP Server

[![CI](https://github.com/Presh-AR/ARM-MCP-Server/actions/workflows/ci.yml/badge.svg)](https://github.com/Presh-AR/ARM-MCP-Server/actions/workflows/ci.yml)

MCP server for AutoRABIT ARM APIs, covering all CI Jobs v1 endpoints.

## Modeled APIs

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

## MCP Tools

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

## MCP Resources

- `arm://docs/overview`
- `arm://docs/cijobs-v1`
- `arm://docs/auth`

## MCP Prompts

- `arm_quick_deploy_guide`
- `arm_rollback_guide`
- `arm_trigger_build_guide`
- `arm_poll_status_guide`

## Authentication

ARM expects an API token in a `token` header.

Required env vars:

- `ARM_BASE_URL` (example: `pilot.autorabit.com` or `https://pilot.autorabit.com`)
- `ARM_API_TOKEN`

Optional env vars:

- `ARM_TIMEOUT_MS` (default `30000`)
- `ARM_MAX_RETRIES` (default `2`)

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
        "ARM_API_TOKEN": "YOUR_TOKEN"
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
  -e ARM_API_TOKEN=YOUR_TOKEN \
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
        "arm-mcp-server"
      ],
      "env": {
        "ARM_BASE_URL": "pilot.autorabit.com",
        "ARM_API_TOKEN": "YOUR_TOKEN"
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
