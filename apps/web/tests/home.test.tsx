import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "@/app/page";

test("the home page has a main heading", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1, name: "Own your stroke." })).toBeTruthy();
});
