/**
 * The shift clock is the one piece of arithmetic in this product that is
 * wrong by default. A 6pm-to-6am window crosses midnight, so every "is it
 * between start and end" check that reads naturally is inverted, and a shift
 * belongs to the day it *started* rather than the day it ends. None of that
 * shows up as a crash — it shows up as an alert that fired a day late.
 *
 * Run with: npx tsx scripts/check-shift-hours.ts
 */
import {
  isInShift,
  isOffShiftPkt,
  isQuietHours,
  nextShiftStartPkt,
  nextWorkingStart,
  workingHoursBetween,
} from "../src/lib/time";

/** An ISO wall clock read as Pakistan time, which is what the team lives in. */
const pkt = (iso: string) => new Date(`${iso}+05:00`);

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const e = expected instanceof Date ? expected.toISOString() : expected;
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
  }
}

// 2026-09-07 is a Monday, 09-11 Friday, 09-12 Saturday, 09-13 Sunday.
console.log("\ninside a shift");
check("Mon 8pm is in shift", isInShift(pkt("2026-09-07T20:00")), true);
check("Tue 3am belongs to Monday night", isInShift(pkt("2026-09-08T03:00")), true);
check("Mon 5:59pm is not yet", isInShift(pkt("2026-09-07T17:59")), false);
check("Mon 6pm exactly", isInShift(pkt("2026-09-07T18:00")), true);
check("Mon 6am exactly is over", isInShift(pkt("2026-09-07T06:00")), false);
check("Mon 10am is asleep", isInShift(pkt("2026-09-07T10:00")), false);
check("Sat 3am is Friday's shift", isInShift(pkt("2026-09-12T03:00")), true);
check("Sat 8pm is not an office shift", isInShift(pkt("2026-09-12T20:00")), false);
check("Sun 8pm is not an office shift", isInShift(pkt("2026-09-13T20:00")), false);
check("isQuietHours is the inverse", isQuietHours(pkt("2026-09-07T20:00")), false);

console.log("\nshift hours between two instants");
check("one whole shift is 12h", workingHoursBetween(pkt("2026-09-07T18:00"), pkt("2026-09-08T06:00")), 12);
check("half in, half out", workingHoursBetween(pkt("2026-09-07T12:00"), pkt("2026-09-07T20:00")), 2);
check("the full office week is 60h", workingHoursBetween(pkt("2026-09-07T18:00"), pkt("2026-09-12T06:00")), 60);
check("a weekend costs nothing", workingHoursBetween(pkt("2026-09-11T20:00"), pkt("2026-09-14T20:00")), 12);
check("Sat noon to Sun noon is dead time", workingHoursBetween(pkt("2026-09-12T12:00"), pkt("2026-09-13T12:00")), 0);
check("backwards is zero", workingHoursBetween(pkt("2026-09-08T06:00"), pkt("2026-09-07T18:00")), 0);

console.log("\nnotification hold window (weekends included)");
check("Sat 10am is a hold", isOffShiftPkt(pkt("2026-09-12T10:00")), true);
check("Sat 9pm still reaches somebody", isOffShiftPkt(pkt("2026-09-12T21:00")), false);
check("Sun 2am still reaches somebody", isOffShiftPkt(pkt("2026-09-13T02:00")), false);
check("held Sat message waits until Sat 6pm", nextShiftStartPkt(pkt("2026-09-12T10:00")), pkt("2026-09-12T18:00"));
check("held Mon message waits until Mon 6pm", nextShiftStartPkt(pkt("2026-09-07T07:00")), pkt("2026-09-07T18:00"));

console.log("\nnext office shift");
check("already inside one returns itself", nextWorkingStart(pkt("2026-09-12T03:00")), pkt("2026-09-12T03:00"));
check("Sat daytime waits for Monday", nextWorkingStart(pkt("2026-09-12T10:00")), pkt("2026-09-14T18:00"));
check("Sun evening waits for Monday", nextWorkingStart(pkt("2026-09-13T20:00")), pkt("2026-09-14T18:00"));

console.log(failures ? `\n${failures} failed\n` : "\nall good\n");
process.exit(failures ? 1 : 0);
