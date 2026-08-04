import {
  isReviewedGap,
  isReviewedRoom,
  type RoomReviewState,
} from "../../lib/reviter/room-review.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import { roomModelFingerprint } from "./review-exchange.ts";

const prefix = "reviter:room-review:v1:";

function key(result: ConvertResult) {
  return `${prefix}${roomModelFingerprint(result)}`;
}

export function loadRoomReview(result: ConvertResult): RoomReviewState {
  if (typeof localStorage === "undefined") return { rooms: [], gaps: [] };
  try {
    const value = JSON.parse(localStorage.getItem(key(result)) ?? "null") as Partial<RoomReviewState> | null;
    if (value && Array.isArray(value.rooms) && value.rooms.every(isReviewedRoom)
      && Array.isArray(value.gaps) && value.gaps.every(isReviewedGap)) {
      return { rooms: value.rooms, gaps: value.gaps };
    }
  } catch {
    // Corrupt local review state is ignored; the portable sidecar remains the
    // recovery path and fresh candidates can be regenerated.
  }
  return { rooms: [], gaps: [] };
}

export function saveRoomReview(result: ConvertResult, review: RoomReviewState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key(result), JSON.stringify(review));
}
