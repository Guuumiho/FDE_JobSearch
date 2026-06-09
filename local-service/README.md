# JD Local Service MVP

This local service receives job data from the Firefox extension and saves it to:

- `data/jobs.db`
- `data/jobs.jsonl`

## Start

Double-click:

```text
local-service\run.cmd
```

Or run:

```text
python local-service\server.py
```

The service listens on:

```text
http://127.0.0.1:8765
```

## Check

Open this URL in a browser:

```text
http://127.0.0.1:8765/health
```

List saved jobs:

```text
http://127.0.0.1:8765/api/jobs
```
