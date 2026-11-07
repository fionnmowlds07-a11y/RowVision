/** Mirrors BOAT_SEATS and sides_for in the preview, and boat_seats in the database. */
export const BOAT_SEATS: Record<string, number> = { "1x": 1, "2x": 2, "2-": 2, "4x": 4, "4-": 4, "4+": 4, "8+": 8 };
export const BOAT_NAMES: Record<string, string> = {
  "1x": "Single (1x)", "2x": "Double (2x)", "2-": "Pair (2-)", "4x": "Quad (4x)",
  "4-": "Coxless four (4-)", "4+": "Coxed four (4+)", "8+": "Eight (8+)",
};
export const SIDE_NAMES: Record<string, string> = { stroke: "Stroke side", bow: "Bow side", scull: "Sculling" };
const SCULLING = new Set(["1x", "2x", "4x"]);

export type Setup = { boat: string; side: string; seat: number };

export function sidesFor(boat: string): string[] {
  return SCULLING.has(boat) ? ["scull"] : ["stroke", "bow"];
}

export function seatsFor(boat: string): number[] {
  return Array.from({ length: BOAT_SEATS[boat] ?? 1 }, (_, index) => index + 1);
}

/** Keep what still makes sense after the boat changes. */
export function fitSetup(setup: Setup): Setup {
  const boat = setup.boat in BOAT_SEATS ? setup.boat : "8+";
  const sides = sidesFor(boat);
  return {
    boat,
    side: sides.includes(setup.side) ? setup.side : sides[0],
    seat: Math.min(Math.max(setup.seat, 1), BOAT_SEATS[boat]),
  };
}
