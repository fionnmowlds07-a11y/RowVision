// Runs the local stand-in. Never deployed without asking the owner.
import path from "node:path";
import { makeServer } from "./server.mjs";

const folder = path.resolve(process.env.INTAKE_FOLDER ?? "received");
const port = Number(process.env.PORT ?? 8787);
makeServer({ folder, adminToken: process.env.INTAKE_ADMIN_TOKEN }).listen(port, "127.0.0.1", () => {
  console.log(`Intake stand-in on http://127.0.0.1:${port}, saving to ${folder}`);
});
