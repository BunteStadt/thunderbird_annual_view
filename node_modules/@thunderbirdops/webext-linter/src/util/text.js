// Word-wrap for prose printed to the terminal or report - notably LLM-authored
// text (the change summary, escalation explanations), whose lines can be
// arbitrarily long. Each source line is wrapped independently so the model's
// own structure (bullets, blank lines) is kept, and a leading list marker
// hanging-indents its continuations.
//
// Belongs here: wrapText (a generic width-wrapper) and humanSize (a byte-size
// formatter). Does NOT belong here: the report's section layout
// (src/report/format.js) or the activity-feed narration
// (src/checks/escalation.js) that call them.

// A leading list marker ("- ", "* ", "• ", "1. ", "2) ") - its width sets the
// hanging indent for the wrapped continuations.
const MARKER = /^([-*•]\s+|\d+[.)]\s+)/;

/**
 * Wrap text to `width` columns. Source line breaks are preserved (each line is
 * wrapped on its own, blank lines kept). A leading list marker keeps its
 * continuation lines hanging-indented under the text. A single word longer than
 * the available width is left on its own over-long line rather than broken.
 * @param {string} text
 * @param {string} [indent]  Prefix applied to every output line.
 * @param {number} [width]
 * @returns {string[]}
 */
export function wrapText(text, indent = "", width = 80) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      out.push("");
      continue;
    }
    const lead = line.match(/^\s*/)[0];
    const afterLead = line.slice(lead.length);
    const marker = afterLead.match(MARKER)?.[0] ?? "";
    const firstPrefix = indent + lead + marker;
    const contPrefix = indent + lead + " ".repeat(marker.length);
    let cur = firstPrefix;
    let started = false;
    for (const word of afterLead.slice(marker.length).split(/\s+/)) {
      if (!word) {
        continue;
      }
      if (!started) {
        cur += word;
        started = true;
      } else if (cur.length + 1 + word.length <= width) {
        cur += ` ${word}`;
      } else {
        out.push(cur);
        cur = contPrefix + word;
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * A byte count as a short human string: "812 B", "4.5 KB", "2.4 MB" (one
 * decimal for KB/MB). Used for the LLM-payload size in the summary status lines.
 * @param {number} bytes
 * @returns {string}
 */
export function humanSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}
