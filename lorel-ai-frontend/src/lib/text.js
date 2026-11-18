/* Small display helpers shared by the demo, the app and the admin page. */

/** "Holt 1894, p. 40" -> "Holt 1894 · p. 40" for citation chips. */
export const chipLabel = (citation) => (citation?.label ?? "source").replace(", p. ", " · p. ");

/** The indexed passages are lowercased with tokenizer spacing ("wet - nurse , and"); make them readable. */
export function readablePassage(text = "") {
  const tidy = text
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/(\w) - (\w)/g, "$1-$2")
    .replace(/\s+'\s*(s|t|d|ll|re|ve|m)\b/g, "'$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return tidy
    .replace(/(^|[.!?]\s+|["“]\s*)([a-z])/g, (match, lead, letter, offset, whole) =>
      // "10 p. m. and" is an abbreviation, not the end of a sentence
      ABBREVIATION.test(whole.slice(0, offset + 1)) ? match : lead + letter.toUpperCase()
    )
    .replace(/\bi\b/g, "I");
}

const ABBREVIATION = /(?:^|[\s(])(?:[a-z]|mr|mrs|dr|st|viz|etc|vol|no|pp|ch|fig|e\.g|i\.e)\.$/i;

export function relativeTime(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** "google/gemma-4-26b-a4b-it:free" -> "gemma-4-26b-a4b-it" */
export const modelName = (model) => (model ? model.split("/").pop().replace(/:free$/, "") : null);

export function surname(author = "") {
  const words = author.replace(/&/g, " ").split(/\s+/).filter((w) => w && !/^[A-Z]\.$/.test(w));
  return words[words.length - 1] ?? author;
}

export const formatBytes = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** "the-whole_brain child.pdf" -> "The Whole Brain Child" */
export function titleFromFilename(name = "") {
  const base = name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 200);
}

const SPINE_COLORS = ["#6b4a86", "#9a6b55", "#56705f", "#8a5470", "#4f5f86", "#7d6a3f"];
/** A stable color per book for the typographic "spines" that stand in for covers. */
export function spineColor(id = "") {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SPINE_COLORS[hash % SPINE_COLORS.length];
}

/** Questions the demo library answers well, offered as one-tap prompts. */
export const SUGGESTIONS = [
  "How often should a three-month-old be fed?",
  "Is it good to rock a baby to sleep?",
  "When should a baby be weaned?",
  "How should a newborn be bathed?",
];
