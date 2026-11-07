# RowVision

Biomechanical video analysis for rowers. Upload launch footage, choose your boat, rowing type and seat, and see how each limb moves through the stroke against where it should be, with a clear rating of how far the result can be trusted.

Status: a working web app, running locally. Nothing is deployed. The first version is an invite-only preview for adults.

## What is here

| Folder | What it does |
|---|---|
| `apps/web` | The web app: sign-in, upload, results, frame viewer, history, admin |
| `services/worker` | Takes clips from the queue and analyses them |
| `services/vision` | The analysis engine |
| `supabase` | Database, security rules, storage and their tests |
| `apps/preview` | A local tool for labelling footage |

Start with the [handover](docs/handover.md), the [web app plan](docs/web-app-plan.md) and the [runbook](docs/runbook.md). Also see [what is stored](docs/privacy.md), [deployment](docs/deployment.md) and [the home worker](docs/home-worker.md).

## Research

Technique targets are based on published research. See the [evidence summary](docs/research/README.md) and the [full list of studies](docs/research/studies.md).

## Footage and privacy

Real rowing footage shows identifiable athletes, many of them juniors. Videos, frames and overlays from real clips must never be committed to this repository. Tests use generated footage instead.
