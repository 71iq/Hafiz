export const states = [
  ["begin", "dawn", "wave", 0, "out", "Start your streak", "ابدأ سلسلتك"],
  ["open morning", "morning", "rest", 12, "unlit", "Ready for your wird?", "جاهز لوِردك؟"],
  ["open midday", "day", "wave", 12, "unlit", "Keep it going", "واصل"],
  ["open golden", "golden", "warm", 12, "unlit", "Wird time", "وقت الوِرد"],
  ["open dusk", "dusk", "glow", 12, "unlit", "Still time today", "ما زال في اليوم وقت"],
  ["open night", "night", "open_halo", 12, "unlit", "Before midnight", "قبل منتصف الليل"],
  ["open midnight", "midnight", "glow_halo", 12, "unlit", "Last hour today", "آخر ساعة اليوم"],
  ["done", "radiant", "shimmer", 13, "lit_t1", "", ""],
  ["done at night", "radiant_night", "shimmer_halo", 13, "lit_t1", "", ""],
  ["milestone 30", "milestone", "milestone", 30, "lit_t3", "", ""],
  ["earned back", "sunrise", "open", 5, "lit_t0", "Streak earned back", "استعدت سلسلتك"],
  ["kept", "calm", "sit", 12, "lit_t1", "Streak kept", "حُفظت السلسلة"],
  ["fresh start at night", "night", "glow_halo", 0, "out", "Start fresh tonight", "ابدأ من جديد الليلة"],
];
export const layoutSizes = {
  tile: [160, 160],
  wide: [330, 170],
  short: [170, 80],
  tiny: [110, 56],
  medium: [330, 100],
  smallTile: [110, 110],
  largeTile: [190, 190],
};
export const isTile = (layout) => ["tile", "smallTile", "largeTile"].includes(layout);

export const ladder = [
  ["Calm", "day", "eager", 12, "waiting", "Keep it going"],
  ["Nudge", "golden", "impatient", 12, "waiting", "Keep your 12 days"],
  ["Urgent", "dusk", "worried", 12, "waiting", "Save your 12 days"],
  ["Critical", "night", "anxious_halo", 12, "waiting", "Under 2 hours left!"],
  ["Last hour", "midnight", "panicked_halo", 12, "waiting", "Last hour!"],
  ["Done", "radiant", "shimmer", 13, "lit_t1", "", "", "#763509"],
  ["Done late", "radiant_night", "relieved_halo", 13, "lit_t1", "", "", "#FFD09A"],
  ["After a break", "dawn", "lonely", 0, "out", "Start again today"],
];
