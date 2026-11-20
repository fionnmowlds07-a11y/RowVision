// How a sweep boat is rigged: which side each seat rows on, bow seat first.
// The engine uses it for each seat's side and for who each rower follows at the catch.
import { BOAT_SEATS, sidesFor } from "./setup";

export type Side = "stroke" | "bow";
export type Rig = Side[];
export type RigPreset = { id: string; name: string; about: string; sides: Rig };

const other = (side: Side): Side => (side === "stroke" ? "bow" : "stroke");

/** Sides alternating seat by seat, with the stroke seat on `strokeSide`. */
export function alternating(seats: number, strokeSide: Side = "stroke"): Rig {
  return Array.from({ length: seats }, (_, index) => ((seats - 1 - index) % 2 === 0 ? strokeSide : other(strokeSide)));
}

/** True for a boat with a side to rig: pairs, fours and eights. */
export function hasRig(boat: string): boolean {
  return (BOAT_SEATS[boat] ?? 1) > 1 && sidesFor(boat).includes("stroke");
}

/** The usual rigs for a boat. Names for bucket rigs vary between clubs, so each says which seats share a side. */
export function presetsFor(boat: string): RigPreset[] {
  const seats = BOAT_SEATS[boat] ?? 1;
  if (!hasRig(boat)) return [];
  const presets: RigPreset[] = [
    { id: "normal", name: "Normal", about: "Sides alternate, stroke seat on stroke side", sides: alternating(seats, "stroke") },
    { id: "reversed", name: "Normal, reversed", about: "Sides alternate, stroke seat on bow side", sides: alternating(seats, "bow") },
  ];
  if (seats === 4) {
    presets.push({ id: "bucket", name: "Bucket rig", about: "2 and 3 on the same side", sides: ["stroke", "bow", "bow", "stroke"] });
  }
  if (seats === 8) {
    presets.push(
      { id: "german", name: "German rig", about: "4 and 5 on the same side", sides: ["stroke", "bow", "stroke", "bow", "bow", "stroke", "bow", "stroke"] },
      { id: "italian", name: "Italian rig", about: "Bow and stroke on one side, the rest in pairs", sides: ["stroke", "bow", "bow", "stroke", "stroke", "bow", "bow", "stroke"] },
    );
  }
  return presets;
}

/** The preset a rig matches, or null for a custom one. */
export function presetOf(boat: string, rig: Rig): RigPreset | null {
  return presetsFor(boat).find((preset) => preset.sides.length === rig.length && preset.sides.every((side, index) => side === rig[index])) ?? null;
}

/** A rig that fits the boat: the one given if it does, otherwise the normal rig. */
export function fitRig(boat: string, rig: unknown): Rig {
  const seats = BOAT_SEATS[boat] ?? 1;
  if (Array.isArray(rig) && rig.length === seats && rig.every((side) => side === "stroke" || side === "bow")) return rig as Rig;
  return alternating(seats, "stroke");
}

/** Whether every seat has a side, and both sides are rowed, as a sweep boat needs. */
export function isRig(boat: string, rig: unknown): rig is Rig {
  if (!hasRig(boat)) return false;
  const seats = BOAT_SEATS[boat];
  return Array.isArray(rig) && rig.length === seats && rig.every((side) => side === "stroke" || side === "bow") && rig.includes("stroke") && rig.includes("bow");
}

/** Switch one seat to the other side. */
export function flipSeat(rig: Rig, seat: number): Rig {
  return rig.map((side, index) => (index === seat - 1 ? other(side) : side));
}
