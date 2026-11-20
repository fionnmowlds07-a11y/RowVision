# 3. No AWS stacks

**Decision:** the original plan's CDK stacks were dropped. Delivery is Docker Compose and Supabase config.

**Why:** hosting will be Supabase, a web host and a home PC, so stacks for AWS would describe nothing that runs.
