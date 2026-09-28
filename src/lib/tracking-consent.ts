// What activity tracking collects, in the words people agree to. Shared by the
// permission screen and the server, which only accepts activity from someone
// who agreed to THIS version. Change what's collected -> bump the version,
// and everyone is asked again.

export const CONSENT_VERSION = 1;

export const CONSENT_COLLECTED = [
  "Only while you're clocked in and not on a break. Clocked out or on break, nothing is recorded.",
  "In Chrome (with the extension): the website and page title of the tab in front, and how long you're on it.",
  "On your computer (with the OneUp desktop tracker): the name of the program in front (e.g. CapCut, Photoshop) and its window title, and how long you're in it.",
  "When you're idle (no keyboard or mouse for 2 minutes) or away from the computer.",
];

export const CONSENT_NOT_COLLECTED = [
  "No screenshots, no screen recording, no webcam or microphone.",
  "No keystrokes and nothing you type.",
  "No page contents, messages or files, and no query strings in web addresses.",
  "Nothing outside your clocked-in hours.",
];

export const CONSENT_WHO_SEES =
  "Your managers and the CEO see it on the Team page, per day. You can see your own day on My hours.";
