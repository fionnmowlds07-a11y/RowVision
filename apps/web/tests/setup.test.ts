import { describe, expect, test } from "vitest";
import { BOAT_SEATS, fitSetup, seatsFor, sidesFor } from "@/lib/setup";

describe("setup rules", () => {
  test("sculling boats only scull", () => {
    for (const boat of ["1x", "2x", "4x"]) expect(sidesFor(boat)).toEqual(["scull"]);
  });
  test("sweep boats have two sides", () => {
    for (const boat of ["2-", "4-", "4+", "8+"]) expect(sidesFor(boat)).toEqual(["stroke", "bow"]);
  });
  test("seats match the boat", () => {
    for (const [boat, seats] of Object.entries(BOAT_SEATS)) expect(seatsFor(boat)).toHaveLength(seats);
  });
  test("changing boat keeps a valid side and seat", () => {
    expect(fitSetup({ boat: "1x", side: "bow", seat: 7 })).toEqual({ boat: "1x", side: "scull", seat: 1 });
    expect(fitSetup({ boat: "8+", side: "scull", seat: 3 })).toEqual({ boat: "8+", side: "stroke", seat: 3 });
    expect(fitSetup({ boat: "4-", side: "bow", seat: 2 })).toEqual({ boat: "4-", side: "bow", seat: 2 });
  });
  test("an unknown boat falls back to an eight", () => {
    expect(fitSetup({ boat: "x", side: "bow", seat: 3 }).boat).toBe("8+");
  });
});
