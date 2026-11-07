import { describe, expect, test } from "vitest";
import { isCode, isEmail, normaliseEmail, sendError, verifyError } from "@/lib/auth";

describe("sign-in rules", () => {
  test("emails are trimmed and lower-cased", () => {
    expect(normaliseEmail("  You@Example.COM ")).toBe("you@example.com");
  });
  test.each([["you@example.com", true], ["you@example", false], ["you", false], ["a b@c.d", false]])(
    "%s is an email: %s",
    (value, expected) => expect(isEmail(value)).toBe(expected),
  );
  test.each([["123456", true], ["12345", false], ["1234567", false], ["12a456", false]])(
    "%s is a code: %s",
    (value, expected) => expect(isCode(value)).toBe(expected),
  );
});

describe("sign-in messages", () => {
  test("an unapproved email is told about the list", () => {
    expect(sendError({ message: "not_approved" })).toContain("preview list");
  });
  test("a removed account is told about the list", () => {
    expect(sendError({ code: "user_banned" })).toContain("preview list");
    expect(verifyError({ code: "user_banned" })).toContain("preview list");
  });
  test("too many codes says to wait", () => {
    expect(sendError({ status: 429 })).toContain("Wait a minute");
  });
  test("an unknown failure says what to do", () => {
    expect(sendError({})).toContain("try again");
  });
  test("a wrong code offers a way forward", () => {
    expect(verifyError({})).toContain("send a new one");
  });
});
