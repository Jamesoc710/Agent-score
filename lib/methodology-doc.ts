// Reading docs/METHODOLOGY.md for /methodology, at build time. The record is append-only and is
// the pre-registration; the page links into it and quotes it, and never paraphrases it, so
// these helpers read structure (headings, dates, the paragraph under a heading) rather than
// depending on any particular wording.

export interface DocHeading {
  level: number;
  text: string;
  /** GitHub's anchor for the heading, so a link lands on the rendered file's section. */
  slug: string;
  /** A YYYY-MM-DD in the heading itself, if any. */
  date: string | null;
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens, repeats suffixed. */
export function githubSlugger() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** Every heading in document order, with its anchor. Fenced code is skipped. */
export function headingIndex(markdown: string): DocHeading[] {
  const slug = githubSlugger();
  const out: DocHeading[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const match = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!match) continue;
    const text = match[2];
    out.push({
      level: match[1].length,
      text,
      slug: slug(text),
      date: text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null,
    });
  }
  return out;
}

/** The first heading matching `pattern`, or null. */
export function findHeading(headings: DocHeading[], pattern: RegExp): DocHeading | null {
  return headings.find((h) => pattern.test(h.text)) ?? null;
}

/**
 * The first prose paragraph under the first heading matching `pattern`, joined onto one line,
 * or null when there is no such heading or it has no paragraph before the next heading.
 */
export function paragraphUnder(markdown: string, pattern: RegExp): string | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && pattern.test(l));
  if (start === -1) return null;
  const paragraph: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim() === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  return paragraph.length > 0 ? paragraph.join(" ") : null;
}

/** The first `count` sentences of a paragraph, verbatim. */
export function leadingSentences(paragraph: string, count: number): string {
  const sentences = paragraph.split(/(?<=\.)\s+(?=[A-Z])/);
  return sentences.slice(0, count).join(" ");
}

/** Inline markdown reduced to text plus code spans, for quoting a sentence as it reads. */
export function inlineSegments(text: string): { code: boolean; text: string }[] {
  const plain = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  return plain.split("`").map((part, i) => ({ code: i % 2 === 1, text: part }));
}
