import path from "node:path";
import { expect, test } from "vitest";
import { engineEnv } from "../../src/main/analysis";

const engine = path.resolve("engine", "rowvision-engine");

test("the engine's folder comes first on the path, so its own ffmpeg is found", () => {
  const env = engineEnv(engine, { PATH: ["a", "b"].join(path.delimiter), HOME: "/home/me" });
  expect(env.PATH).toBe([path.dirname(engine), "a", "b"].join(path.delimiter));
  expect(env.HOME).toBe("/home/me");
});

test("Windows spells it Path, and only one spelling is ever left", () => {
  const env = engineEnv(engine, { Path: "C:\\Windows" });
  expect(Object.keys(env)).toEqual(["Path"]);
  expect(env.Path).toBe([path.dirname(engine), "C:\\Windows"].join(path.delimiter));
});

test("a command looked up on the path, as in development, leaves the environment alone", () => {
  const env = { PATH: "a" };
  expect(engineEnv("python", env)).toBe(env);
});

test("a missing path still gives a usable one", () => {
  expect(engineEnv(engine, {}).PATH).toBe(path.dirname(engine));
});
