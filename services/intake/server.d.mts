import type { Server } from "node:http";

export function makeServer(options: { folder: string; adminToken?: string; now?: () => number }): Server;
