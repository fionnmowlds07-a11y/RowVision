# 2. The worker only connects outward

**Decision:** the worker takes jobs from a Postgres queue with `FOR UPDATE SKIP LOCKED`, leases and a heartbeat. It opens no ports.

**Why:** it can then run on a laptop, a home PC or rented machines with no change. A crash or power cut only delays a job.

**Instead of:** a separate queue service, which would be one more thing to run and pay for.
