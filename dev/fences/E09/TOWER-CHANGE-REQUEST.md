# Issue for `devos-control-tower`: link requests from DEV_OS projects

The owner files this as a new issue with the form **"Dev OS change request"**. Each section below is one field of the
form. It is the Tower side of engine task E09 (PR-61), with the owner's decisions of 2026-10-26:

- the link is a request that the owner approves;
- no limitation on developers;
- the registry address is the current `TOWER_URL` (option A);
- the Control Tower stays private and the owner's alone.

## Title

```
Request: link requests from DEV_OS projects — a project asks, I approve, the Tower adds it
```

## What should change

```
DEV_OS projects whose developer opted in will ask the Tower to link them. I approve each request once; the
Tower then adds the project, and its cycle events (event contract v1) start to arrive.

1. A new machine route, POST /api/link, on the production host only, like /api/ingest.
   - Authorization: Bearer <GitHub OIDC token of the project's workflow>, verified exactly as /api/ingest does
     (verifyGithubOidc, audience = TOWER_URL). The repository and its owner come from the token's claims
     (repository, repository_owner_id), never from the body.
   - The body is exactly { "v": 1, "key": "DEMO-SHOP", "engine": "0.2.9", "contract": "0-draft-3" }, at most 1 KB:
     key matches ^[A-Z][A-Z0-9_-]{1,31}$; engine and contract are strings of at most 32 characters. Anything else
     is 400 { "error": "schema" }.
   - Answers:
     - this repository and owner already have a project row: 200 { "status": "linked", "key": "<its key>" };
     - a pending request exists: 202 { "status": "pending" } (update last_requested_at, engine, contract);
     - I declined it: 403 { "status": "declined" };
     - a new repository: create a pending request, 202 { "status": "pending" };
     - authentication fails: 401 { "error": <reason> }, the same reasons and reason-only rejection rows as
       /api/ingest; unavailable: 429 or 5xx.
2. A table link_requests: repository, owner_github_id, proposed_key, engine_version, contract_version, state
   (pending, approved, declined), first_requested_at, last_requested_at, decided_at. Unique on (repository,
   owner_github_id). Owner-only under RLS, like every table.
3. A "Link requests" panel on the overview, for me only. It lists the pending requests with those fields.
   - Approve: create the projects row (repo and owner_github_id from the request; key = the proposed key, or
     with -2, -3 … when that key is taken) and mark the request approved, so the next /api/link answers linked
     with that key.
   - Decline: mark it declined, so the next /api/link answers 403.
   - A linked project can be declined later: its project row stays for the record and shows as disconnected.
4. docs/contract/ documents /api/link next to event contract v1.

Not changing: /api/ingest and event contract v1. An approved repository's events are stored as today; any other
repository keeps repo_not_registered.
```

## Why

```
The DEV_OS Engine is being released. A developer who opts in at setup links their project to my Control Tower
by request, and nothing is registered until I approve it. This replaces the GitHub App registration planned as
TR1: no app to install, no stored token, no receipt.

The Control Tower stays private and mine alone. It is not part of the public engine, engine users never get
access to it, and nothing about a developer is limited by the link: the engine works the same whether a link
is approved, pending, declined or never asked.
```

## How you will judge it done

```
- Route tests for every answer above, including a body with an extra field (400), a bad audience (401) and a
  production-host check (404 elsewhere).
- Approve creates the project with the proposed key, and with -2 when that key is taken; decline turns the
  next request into 403.
- An approved repository's event is stored by /api/ingest; a pending repository's event is rejected
  repo_not_registered.
- On the deployed site, POST https://devos-control-tower.vercel.app/api/link with no token answers
  401 { "error": "no_token" } (it answers 404 today).
- The panel is visible only to me, signed in; no new public page.
```

## How big is it?

`Feature (several tasks)`

## Priority

`Next up`
