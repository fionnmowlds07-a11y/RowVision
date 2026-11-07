# 4. The 30-day deletion runs from the web host

**Decision:** deletion is a secret-protected route that the web host calls on a schedule.

**Why:** the plan was a database job, but files in Supabase Storage can only be removed through its API. It must also not depend on the worker's computer being on.

**Cost:** the schedule has to be set up on the host, and nothing deletes old video without it.
