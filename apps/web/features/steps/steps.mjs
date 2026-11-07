import assert from "node:assert/strict";
import { Then, When } from "@cucumber/cucumber";

const app = "http://127.0.0.1:3100";
const api = "http://127.0.0.1:54421";
const key = process.env.SUPABASE_ANON_KEY;

When("I ask for the deep health check", async function () {
  this.response = await fetch(`${app}/api/health?deep=1`);
});

Then("the service reports that it is healthy", async function () {
  assert.equal(this.response.status, 200);
  assert.equal((await this.response.json()).status, "ok");
});

When("{string} asks for a sign-in code from the API", async function (email) {
  this.response = await fetch(`${api}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
});

Then("they are refused", function () {
  assert.equal(this.response.status, 403);
});

When("I read the clips table without signing in", async function () {
  this.response = await fetch(`${api}/rest/v1/clips?select=id`, { headers: { apikey: key } });
});

Then("I am refused", function () {
  assert.ok([401, 403].includes(this.response.status), `got ${this.response.status}`);
});

When("I list the working bucket without signing in", async function () {
  this.response = await fetch(`${api}/storage/v1/object/list/working`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "" }),
  });
});

Then("I see no files", async function () {
  const files = this.response.ok ? await this.response.json() : [];
  assert.deepEqual(files, []);
});

When("I start the 30-day deletion without the secret", async function () {
  this.response = await fetch(`${app}/api/retention`, { method: "POST" });
});

When("I start the 30-day deletion with the secret", async function () {
  this.response = await fetch(`${app}/api/retention`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RETENTION_SECRET ?? "local-only"}` },
  });
});

Then("it reports how many clips it deleted", async function () {
  assert.equal(this.response.status, 200);
  assert.equal(typeof (await this.response.json()).deleted, "number");
});
