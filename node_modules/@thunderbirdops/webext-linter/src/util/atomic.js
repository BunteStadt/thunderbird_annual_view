// One way to write a file that must never be seen half-written: to a temp name in
// the same directory, then rename over the target. Every cache and download in the
// tool goes through here, so an interrupted run leaves either the old bytes or the
// new ones, never a truncated cache that the next run happily reads as valid.
//
// Belongs here: the write-then-rename dance (and cleaning up the temp file when it
// fails). Does NOT belong here: what is written, where a cache lives, or whether a
// failed write matters - each caller decides that (a download throws, a cache logs
// and carries on).

import fs from "node:fs";
import path from "node:path";

/**
 * Write `data` to `file`, atomically. The temp file is a sibling, so the rename is
 * within one filesystem; the directory is created if it does not exist yet.
 * @param {string} file  The final path.
 * @param {string|Buffer} data
 */
export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) {
      fs.rmSync(tmp, { force: true });
    }
  }
}
