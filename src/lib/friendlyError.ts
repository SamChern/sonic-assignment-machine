/**
 * Turns technical failures into one plain sentence a listener can act on.
 *
 * Everything the app shows in a toast or an inline warning should pass through
 * here so nobody ever reads "Edge function returned a non-2xx status code",
 * "FunctionsHttpError" or a raw Postgres message.
 */

const PATTERNS: { test: RegExp; message: string }[] = [
  {
    test: /free look|guest_limit|free account to keep/i,
    message:
      "You've used your free look for today. Create a free account to keep analysing audio.",
  },
  {
    test: /429|rate.?limit|too many requests/i,
    message: "That's a lot of requests at once. Wait a moment and try again.",
  },
  {
    test: /took longer than|timeout|timed out|abort/i,
    message: "That took too long to come back. Try again in a moment.",
  },
  {
    test: /401|403|unauthorized|forbidden|jwt|not authenticated|invalid token/i,
    message: "Your session expired. Sign in again and retry.",
  },
  {
    test: /failed to fetch|network|networkerror|offline|err_internet/i,
    message: "We couldn't reach the service. Check your connection and try again.",
  },
  {
    test: /payment|credits|quota exceeded|insufficient/i,
    message: "The analysis service is out of capacity right now. Please try again later.",
  },
  {
    test: /non-2xx|functionshttperror|functionsrelayerror|500|502|503|internal server/i,
    message: "Something went wrong on our side. Please try again.",
  },
  {
    test: /permission denied|row-level security|violates/i,
    message: "You don't have access to that yet.",
  },
  {
    test: /statement timeout|canceling statement/i,
    message: "That search was too broad to finish. Narrow it down and try again.",
  },
  {
    test: /not found|no rows|does not exist/i,
    message: "We couldn't find that item any more.",
  },
];

/** True when a message already reads like a sentence written for a person. */
const looksHuman = (text: string) =>
  /[a-z]/.test(text) &&
  text.length <= 160 &&
  /[.!?]$/.test(text.trim()) &&
  !/[{}<>_]|https?:\/\/|error:|exception/i.test(text);

export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as { message?: unknown })?.message === "string"
          ? String((err as { message: string }).message)
          : "";

  const text = raw.trim();
  if (!text) return fallback;

  for (const { test, message } of PATTERNS) {
    if (test.test(text)) return message;
  }

  return looksHuman(text) ? text : fallback;
}
