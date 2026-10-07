export const CONVERSATION_SPARKS = [
  {
    id: "tiny-bright-thing",
    label: "Small wonder",
    prompt: "What tiny thing made today a little better?",
  },
  {
    id: "week-in-color",
    label: "Right now",
    prompt: "If your week had a color, what would it be?",
  },
  {
    id: "tomorrow-anywhere",
    label: "Elsewhere",
    prompt: "Where in the world would you wake up tomorrow?",
  },
  {
    id: "ordinary-talent",
    label: "Tiny truth",
    prompt: "What ordinary thing are you strangely good at?",
  },
  {
    id: "night-weather-song",
    label: "After dark",
    prompt: "What song feels like the weather tonight?",
  },
  {
    id: "free-day",
    label: "No obligations",
    prompt: "What would you do with one completely free day?",
  },
  {
    id: "changed-mind",
    label: "A shift",
    prompt: "What have you changed your mind about lately?",
  },
  {
    id: "kindness-kept",
    label: "Human signal",
    prompt: "What small kindness have you never forgotten?",
  },
  {
    id: "almost-excited",
    label: "Looking forward",
    prompt: "What are you excited about, even just a little?",
  },
  {
    id: "stranger-memory",
    label: "Passing through",
    prompt: "What do you hope a stranger remembers about you?",
  },
] as const;

export type ConversationSpark = (typeof CONVERSATION_SPARKS)[number];
export type ConversationSparkId = ConversationSpark["id"];

export interface ConversationSparkEvent {
  id: ConversationSparkId;
  clock: number;
  author: string;
}

const SPARK_IDS = new Set<string>(
  CONVERSATION_SPARKS.map((spark) => spark.id),
);
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isConversationSparkId(
  value: unknown,
): value is ConversationSparkId {
  return typeof value === "string" && SPARK_IDS.has(value);
}

export function isConversationSparkEvent(
  value: unknown,
): value is ConversationSparkEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    isConversationSparkId(event.id) &&
    typeof event.clock === "number" &&
    Number.isSafeInteger(event.clock) &&
    event.clock > 0 &&
    event.clock <= 1_000_000 &&
    typeof event.author === "string" &&
    SESSION_ID_PATTERN.test(event.author)
  );
}

export function getConversationSpark(
  id: ConversationSparkId,
): ConversationSpark {
  return CONVERSATION_SPARKS.find((spark) => spark.id === id)!;
}

export function pickConversationSpark(
  currentId?: ConversationSparkId,
): ConversationSparkId {
  const choices = currentId
    ? CONVERSATION_SPARKS.filter((spark) => spark.id !== currentId)
    : CONVERSATION_SPARKS;
  return choices[Math.floor(Math.random() * choices.length)].id;
}

export function compareConversationSparkEvents(
  left: ConversationSparkEvent,
  right: ConversationSparkEvent,
): number {
  if (left.clock !== right.clock) return left.clock - right.clock;
  return left.author.localeCompare(right.author);
}
