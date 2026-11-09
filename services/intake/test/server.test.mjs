import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { makeServer } from "../server.mjs";

let folder, server, base, clock = 0;
before(async () => {
  folder = mkdtempSync(path.join(tmpdir(), "intake-"));
  server = makeServer({ folder, adminToken: "owner-secret", now: () => 1_000_000 + clock });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(folder, { recursive: true, force: true }); });

const put = (link, body) => fetch(base + link, { method: "PUT", body });
const meta = JSON.stringify({ setup: { boat: "2-" }, note: "late catch", consent: { adult: true, allowed: true } });

test("a send takes each file once, then shows in the owner's list", async () => {
  const { id, uploads } = await (await fetch(`${base}/sends`, { method: "POST" })).json();
  assert.equal((await fetch(`${base}/sends/${id}/done`, { method: "POST" })).status, 409);
  assert.equal((await put(uploads.video, "video bytes")).status, 200);
  assert.equal((await put(uploads.video, "again")).status, 403);
  assert.equal((await put(uploads.meta, meta)).status, 200);
  assert.equal((await fetch(`${base}/sends/${id}/done`, { method: "POST" })).status, 200);
  assert.equal(readFileSync(path.join(folder, id, "working.mp4"), "utf8"), "video bytes");

  assert.equal((await fetch(`${base}/admin/sends`)).status, 401);
  assert.equal((await fetch(`${base}/admin/sends`, { headers: { authorization: "Bearer wrong-secret" } })).status, 401);
  const list = await (await fetch(`${base}/admin/sends`, { headers: { authorization: "Bearer owner-secret" } })).json();
  assert.deepEqual(list.sends.map((send) => [send.id, send.note]), [[id, "late catch"]]);
});

test("old links and odd paths are refused", async () => {
  const { uploads } = await (await fetch(`${base}/sends`, { method: "POST" })).json();
  clock += 2 * 60 * 60 * 1000;
  assert.equal((await put(uploads.video, "late")).status, 403);
  assert.equal((await put("/upload/../../etc", "x")).status, 404);
  assert.equal((await fetch(`${base}/sends/..%2f/done`, { method: "POST" })).status, 404);
  assert.equal(existsSync(path.join(folder, "..", "etc")), false);
});
