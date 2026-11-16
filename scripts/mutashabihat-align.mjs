
const SPELLING_MARKS = /[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u0640]/g;
const ARABIC_LETTER = /[\u0621-\u064A]/;
const DATA_AYAH_END = /﴿\s*\p{Nd}+\s*﴾/gu;

const WINDOW_AYAT = 3;
const SMALL_GAP = 3;
export const MAX_FILL = 12;
const DROP_COST = 2;
const MERGE_COST = 1;
const LEVEL_SCORE = [0, 1.5, 2.5, 3];
const SHAPES = [
  [1, 1],
  [2, 1],
  [1, 2],
  [3, 1],
  [1, 3],
];

export function letterKey(word) {
  return word
    .replace(/\u0635(?=[\u064B-\u065F\u06D6-\u06ED]*\u06DC)/g, "\u0633")
    .replace(/\u0649\u0670(?=[\u064B-\u065F\u06D6-\u06ED]*[\u0621-\u064A])/g, "ا")
    .replace(/\u0649\u0670/g, "\u0649")
    .replace(/\u0648\u0670/g, "ا")
    .replace(/\u0670/g, "ا")
    .replace(SPELLING_MARKS, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A]/g, "")
    .replace(/ءا/g, "ا")
    .replace(/ا+/g, "ا");
}

export function skeletonKey(word) {
  return letterKey(word)
    .replace(/[اويء]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function keyed(text) {
  const letters = letterKey(text);
  const consonants = letters.replace(/[اويء]/g, "");
  return { text, letters, consonants, skeleton: consonants.replace(/(.)\1+/g, "$1") };
}

export function sourceWords(text, marks = {}) {
  const count = (kind, n) => {
    if (n > 0) marks[kind] = (marks[kind] ?? 0) + n;
  };
  const source = String(text ?? "");
  count("ayahMarks", (source.match(DATA_AYAH_END) ?? []).length);
  const stripped = source.replace(DATA_AYAH_END, " ");
  count("fullStops", (stripped.match(/\./g) ?? []).length);
  count("asterisks", (stripped.match(/\*/g) ?? []).length);
  count("pauseMarks", (stripped.match(/[\u06D6-\u06DB]/g) ?? []).length);
  count("sectionMarks", (stripped.match(/[\u06DE\u06E9]/g) ?? []).length);
  return stripped
    .replace(/[.*]/g, " ")
    .split(/\s+/)
    .filter((token) => ARABIC_LETTER.test(token));
}

function matchLevel(source, quran) {
  if (source.length === 1 && quran.length === 1) {
    const [a] = source;
    const [b] = quran;
    if (a.text === b.text) return 3;
    if (a.letters !== "" && a.letters === b.letters) return 2;
    if (a.skeleton !== "" && a.skeleton === b.skeleton) return 1;
    const bare = (letters) => (/^[وف]../.test(letters) ? letters.slice(1) : letters);
    return bare(a.letters) === bare(b.letters) && bare(a.letters).length >= 2 ? 1 : 0;
  }
  const letters = (words) =>
    words
      .map((word) => word.letters)
      .join("")
      .replace(/ا+/g, "ا");
  if (letters(source) !== "" && letters(source) === letters(quran)) return 2;
  const bare = (word) => word.skeleton === "" && word.letters !== "يا";
  if (quran.some(bare) || source.some(bare)) return 0;
  const skeleton = (words) => words.map((word) => word.consonants).join("");
  return skeleton(source) !== "" && skeleton(source) === skeleton(quran) ? 1 : 0;
}

function align(source, quran, { anchored, skipCost, reversed = false }) {
  const n = source.length;
  const m = quran.length;
  const score = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  for (let j = 0; j <= m; j += 1) score[0][j] = anchored ? -skipCost * j : 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const here = score[i][j];
      if (here === -Infinity) continue;
      if (i < n && here - DROP_COST > score[i + 1][j]) {
        score[i + 1][j] = here - DROP_COST;
        back[i + 1][j] = { i, j, op: "drop" };
      }
      if (i > 0 && i < n && j < m && here - skipCost > score[i][j + 1]) {
        score[i][j + 1] = here - skipCost;
        back[i][j + 1] = { i, j, op: "skip" };
      }
      for (const [k, l] of SHAPES) {
        if (i + k > n || j + l > m) continue;
        const run = (words, from, to) => (reversed ? words.slice(from, to).reverse() : words.slice(from, to));
        const level = matchLevel(run(source, i, i + k), run(quran, j, j + l));
        if (level === 0) continue;
        const value = here + LEVEL_SCORE[level] * Math.max(k, l) - (k + l > 2 ? MERGE_COST : 0);
        if (value > score[i + k][j + l]) {
          score[i + k][j + l] = value;
          back[i + k][j + l] = { i, j, op: "match", k, l, level };
        }
      }
    }
  }
  const ends = [];
  let best = -Infinity;
  for (let j = 0; j <= m; j += 1) {
    if (score[n][j] > best) {
      best = score[n][j];
      ends.length = 0;
    }
    if (score[n][j] === best) ends.push(j);
  }
  const trace = (end) => {
    const matches = [];
    let i = n;
    let j = end;
    while (i > 0 || (anchored && j > 0 && back[i][j])) {
      const step = back[i][j];
      if (!step) break;
      if (step.op === "match")
        matches.push({ s: step.i, sEnd: step.i + step.k, q: step.j, qEnd: step.j + step.l, level: step.level });
      i = step.i;
      j = step.j;
    }
    return matches.reverse();
  };
  return { score: best, alignments: ends.map(trace) };
}

function keptRuns(matches, sourceLength, region, edgeAyah) {
  const blocks = [];
  for (const match of matches) {
    const last = blocks[blocks.length - 1];
    if (last && last.qEnd === match.q) {
      last.qEnd = match.qEnd;
      last.matches.push(match);
    } else {
      blocks.push({ q: match.q, qEnd: match.qEnd, matches: [match] });
    }
  }
  let start = 0;
  let covered = 0;
  let lastKept = -1;
  let cut = null;
  const kept = new Set();
  for (const block of blocks) {
    const gap = block.q - covered;
    const words = block.qEnd - block.q;
    const endsSource = block.matches.some((match) => match.sEnd === sourceLength);
    const droppedBetween = block.matches[0].s - (lastKept + 1);
    const boundaryAyah = covered > 0 ? region[covered - 1].ayah : edgeAyah;
    const near = Math.abs(region[block.q].ayah - boundaryAyah) <= 1 && droppedBetween <= SMALL_GAP;
    const long = (gap <= SMALL_GAP && words >= 2) || words >= 3 || (words >= 2 && endsSource);
    if (gap !== 0 && !(near && long)) continue;
    if (gap > MAX_FILL) {
      if (kept.size > 0) {
        cut = block.matches[0].s;
        break;
      }
      start = block.q;
    }
    covered = block.qEnd;
    for (const match of block.matches) for (let s = match.s; s < match.sEnd; s += 1) kept.add(s);
    lastKept = Math.max(...kept);
  }
  return { start, covered, kept, cut };
}

function isRepeat(all, from, to) {
  const keys = all.slice(from, to).map((word) => word.skeleton || word.letters);
  const same = (start) =>
    start >= 0 &&
    start + keys.length <= all.length &&
    keys.every((key, index) => key === (all[start + index].skeleton || all[start + index].letters));
  return same(from - keys.length) || same(to);
}

function contextOf(quran, surah, ayah) {
  const first = surah === 1 || surah === 9 ? 1 : 0;
  const words = [];
  const count = quran.ayahCount(surah);
  for (let a = Math.max(first, ayah - WINDOW_AYAT); a <= Math.min(count, ayah + WINDOW_AYAT); a += 1) {
    const texts = a === 0 ? quran.basmala : quran.ayahWords(surah, a);
    texts.forEach((text, index) => words.push({ ...keyed(text), ayah: a, index, last: index === texts.length - 1 }));
  }
  return words;
}

function placeSimilar(similar, context, ayah) {
  if (similar.length === 0) return [];
  const own = placementsIn(similar, context, (word) => word.ayah === ayah, ayah);
  if (own.some((place) => place.dropped === 0)) return own;
  const wider = placementsIn(similar, context, (word) => Math.abs(word.ayah - ayah) <= 1, ayah);
  const fewest = (places) => Math.min(Infinity, ...places.map((place) => place.dropped));
  return fewest(wider) < fewest(own) ? wider : own;
}

function placementsIn(similar, context, inRegion, ayah) {
  const region = context.map((word, index) => ({ word, index })).filter(({ word }) => inRegion(word));
  if (region.length === 0) return [];
  const offset = region[0].index;
  const { alignments } = align(
    similar,
    region.map(({ word }) => word),
    { anchored: false, skipCost: 1 },
  );
  const seen = new Set();
  const places = [];
  for (const matches of alignments) {
    if (matches.length === 0) continue;
    const start = offset + matches[0].q;
    const end = offset + matches[matches.length - 1].qEnd;
    if (seen.has(`${start}:${end}`)) continue;
    seen.add(`${start}:${end}`);
    if (!context.slice(start, end).some((word) => word.ayah === ayah)) continue;
    const matched = new Set(
      matches.flatMap((match) => Array.from({ length: match.sEnd - match.s }, (_, k) => match.s + k)),
    );
    const inContext = matches.map((match) => ({ ...match, q: offset + match.q, qEnd: offset + match.qEnd }));
    places.push({ start, end, matches: inContext, dropped: similar.length - matched.size });
  }
  return places;
}

function rebuildSide(side, source, context, inner, atAyahEdge, all, sourceOffset) {
  const step = side === "pre" ? -1 : 1;
  const region = [];
  for (let index = inner; index >= 0 && index < context.length; index += step) region.push(context[index]);
  const words = side === "pre" ? [...source].reverse() : source;
  const result = {
    start: 0,
    covered: 0,
    alignedTo: 0,
    found: new Set(),
    dropped: [],
    repeats: [],
    cut: [],
    replaced: false,
  };
  if (words.length === 0) return result;
  const { alignments } = align(words, region, { anchored: true, skipCost: 0.2, reversed: side === "pre" });
  const matches = alignments[0] ?? [];
  const edgeAyah = context[side === "pre" ? inner + 1 : inner - 1].ayah;
  const { start, covered, kept, cut } = keptRuns(matches, words.length, region, edgeAyah);
  for (const match of matches) {
    if (kept.has(match.s)) for (let q = match.q; q < match.qEnd; q += 1) result.found.add(q);
  }
  const toPassage = (s) => sourceOffset + (side === "pre" ? words.length - 1 - s : s);
  const keptOuter = kept.size > 0 ? Math.max(...kept) : -1;
  let foreignOuter = false;
  for (let s = 0; s < words.length; s += 1) {
    if (kept.has(s)) continue;
    if (cut !== null && s > keptOuter) {
      for (let k = s; k < words.length; k += 1) result.cut.push(toPassage(k));
      break;
    }
    let e = s;
    while (e + 1 < words.length && !kept.has(e + 1)) e += 1;
    const from = Math.min(toPassage(s), toPassage(e));
    const to = Math.max(toPassage(s), toPassage(e)) + 1;
    const repeat = isRepeat(all, from, to);
    for (let k = from; k < to; k += 1) (repeat ? result.repeats : result.dropped).push(k);
    if (!repeat && e > keptOuter) foreignOuter = true;
    s = e;
  }
  result.cut.sort((a, b) => a - b);
  result.start = start;
  result.covered = covered;
  result.alignedTo = covered;
  if (foreignOuter) {
    result.replaced = true;
    result.covered = toAyahBoundary(region, covered, atAyahEdge, side);
  }
  return result;
}

function toAyahBoundary(region, covered, atAyahEdge, side) {
  if (region.length === 0) return covered;
  let ayah;
  if (covered > 0) ayah = region[covered - 1].ayah;
  else if (!atAyahEdge || side === "pre") ayah = region[0].ayah;
  else return 0;
  let end = covered;
  while (end < region.length && region[end].ayah === ayah) end += 1;
  return end - covered <= MAX_FILL ? end : covered;
}

function textOf(context, from, to) {
  return context
    .slice(from, to)
    .map((word) => word.text)
    .join(" ");
}

function restartedWords(side, source, similar, next) {
  const key = (word) => word.skeleton || word.letters;
  const reads = (word) => next !== undefined && matchLevel([word], [next]) > 0;
  for (let count = Math.min(source.length, similar.length); count > 0; count -= 1) {
    const repeated = side === "post" ? source.slice(0, count) : source.slice(source.length - count);
    const own = side === "post" ? similar.slice(similar.length - count) : similar.slice(0, count);
    if (!repeated.every((word, index) => key(word) === key(own[index]))) continue;
    const first = side === "post" ? repeated[0] : repeated[count - 1];
    const after = side === "post" ? source[count] : source[source.length - count - 1];
    if (reads(first) || (after !== undefined && !reads(after))) return 0;
    return count;
  }
  return 0;
}

function similarElsewhere(quran, similar) {
  const keys = similar.map((word) => word.skeleton || word.letters).join(" ");
  const found = [];
  for (const [surah, ayah, words] of quran.allAyat()) {
    const text = words.map((word) => skeletonKey(word) || letterKey(word)).join(" ");
    if (` ${text} `.includes(` ${keys} `)) found.push([surah, ayah]);
  }
  return found;
}

function ayahOfSharedWords(place, context, ayah, siblings) {
  const run = context.slice(place.start, place.end);
  const beside = [...new Set(run.map((word) => word.ayah))].filter((other) => other !== ayah);
  if (beside.length !== 1 || beside[0] < 1) return null;
  const key = (word) => word.skeleton || word.letters;
  const shared = new Set(siblings.flatMap((text) => sourceWords(text).map((word) => key(keyed(word)))));
  const sharedIn = (where) => run.filter((word) => word.ayah === where && shared.has(key(word))).length;
  return sharedIn(ayah) === 0 && sharedIn(beside[0]) > 0 ? beside[0] : null;
}

function rebuildAround(place, segments, context, all) {
  const [pre, similar, post] = segments;
  const preRestart = restartedWords("pre", pre, similar, context[place.start - 1]);
  const postRestart = restartedWords("post", post, similar, context[place.end]);
  const preSide = rebuildSide(
    "pre",
    pre.slice(0, pre.length - preRestart),
    context,
    place.start - 1,
    context[place.start].index === 0,
    all,
    0,
  );
  const postOffset = pre.length + similar.length;
  const postSide = rebuildSide(
    "post",
    post.slice(postRestart),
    context,
    place.end,
    context[place.end - 1].last,
    all,
    postOffset + postRestart,
  );
  for (let k = 0; k < preRestart; k += 1) preSide.repeats.push(pre.length - preRestart + k);
  for (let k = 0; k < postRestart; k += 1) postSide.repeats.push(postOffset + k);
  const preStart = place.start - preSide.covered;
  const preEnd = place.start - preSide.start;
  const postStart = place.end + postSide.start;
  const postEnd = place.end + postSide.covered;
  const removed = preSide.dropped.length + preSide.repeats.length + postSide.dropped.length + postSide.repeats.length;
  const found = new Set([
    ...[...preSide.found].map((q) => place.start - 1 - q),
    ...place.matches.flatMap((match) => Array.from({ length: match.qEnd - match.q }, (_, k) => match.q + k)),
    ...[...postSide.found].map((q) => place.end + q),
  ]);
  let restored = 0;
  let added = 0;
  let maxFill = 0;
  let run = 0;
  for (const [from, to] of [
    [preStart, preEnd],
    [place.start, place.end],
    [postStart, postEnd],
  ]) {
    run = 0;
    for (let index = from; index < to; index += 1) {
      if (found.has(index)) {
        run = 0;
        continue;
      }
      run += 1;
      maxFill = Math.max(maxFill, run);
      const outside = index < place.start - preSide.alignedTo || index >= place.end + postSide.alignedTo;
      if (outside) added += 1;
      else restored += 1;
    }
  }
  let similarSkip = 0;
  run = 0;
  for (let index = place.start; index < place.end; index += 1) {
    run = found.has(index) ? 0 : run + 1;
    similarSkip = Math.max(similarSkip, run);
  }
  return {
    place,
    preSide,
    postSide,
    preStart,
    preEnd,
    postStart,
    postEnd,
    keptWords: all.length - removed - place.dropped,
    restored,
    added,
    maxFill,
    similarSkip,
  };
}

function bestRebuild(places, segments, context, all) {
  const rebuilds = places.map((place) => rebuildAround(place, segments, context, all));
  rebuilds.sort((a, b) => b.keptWords - a.keptWords || a.place.dropped - b.place.dropped);
  const best = rebuilds[0] ?? null;
  const tied =
    best !== null &&
    rebuilds.length > 1 &&
    rebuilds[1].keptWords === best.keptWords &&
    rebuilds[1].place.dropped === best.place.dropped;
  return { best, tied };
}

function segmentsOf(rebuilt, context) {
  return {
    pre: textOf(context, rebuilt.preStart, rebuilt.preEnd),
    similar: textOf(context, rebuilt.place.start, rebuilt.place.end),
    post: textOf(context, rebuilt.postStart, rebuilt.postEnd),
  };
}

function changeOf(rebuilt) {
  const { preSide, postSide, place, restored, added, maxFill } = rebuilt;
  const sorted = (key) => [...preSide[key], ...postSide[key]].sort((a, b) => a - b);
  return {
    restored,
    added,
    maxFill,
    replaced: preSide.replaced || postSide.replaced,
    repeats: sorted("repeats"),
    dropped: sorted("dropped"),
    cut: sorted("cut"),
    gapsLeft: { pre: preSide.start, post: postSide.start },
    similarDropped: place.dropped,
  };
}

export function rebuildRef(ref, quran, siblings = []) {
  const marks = {};
  const raw = [ref.pre_text, ref.similar_text, ref.post_text].map((text) => sourceWords(text, marks));
  const segments = raw.map((words) => words.map(keyed));
  const all = segments.flat();
  const old = { pre: ref.pre_text ?? "", similar: ref.similar_text ?? "", post: ref.post_text ?? "" };
  const base = { old, marks };
  const kept = (note) => ({ ...base, status: "kept", kinds: [], notes: [note], segments: old });
  const context = contextOf(quran, ref.surah, ref.ayah);
  const { best, tied } = bestRebuild(placeSimilar(segments[1], context, ref.ayah), segments, context, all);
  const similarSure = best && best.place.dropped <= Math.floor(segments[1].length / 3);

  const foreignShare = best ? 1 - best.keptWords / Math.max(1, all.length) : 1;
  if (!best || !similarSure || foreignShare > 0.4) {
    let other = null;
    for (const [surah, ayah] of similarElsewhere(quran, segments[1])) {
      if (surah === ref.surah && ayah === ref.ayah) continue;
      const otherContext = contextOf(quran, surah, ayah);
      const found = bestRebuild(placeSimilar(segments[1], otherContext, ayah), segments, otherContext, all);
      if (!found.best) continue;
      if (!other || found.best.keptWords > other.rebuilt.keptWords) {
        other = { surah, ayah, context: otherContext, rebuilt: found.best, tied: found.tied, rival: false };
      } else if (found.best.keptWords === other.rebuilt.keptWords) {
        other.rival = true;
      }
    }
    const ownKept = best ? best.keptWords : 0;
    if (other && other.rebuilt.keptWords > ownKept && other.rebuilt.keptWords >= 0.8 * all.length) {
      const note = `text reads as ${other.surah}:${other.ayah} (${other.rebuilt.keptWords} of ${all.length} source words there, ${ownKept} here)`;
      if (other.tied || other.rival) return kept(`${note}, but equally well elsewhere`);
      if (other.rebuilt.similarSkip > MAX_FILL) return kept(`${note}, but its similar words skip a long stretch there`);
      return {
        ...base,
        status: "relabelled",
        relabel: { surah: other.surah, ayah: other.ayah },
        kinds: ["relabelled"],
        notes: [note],
        segments: segmentsOf(other.rebuilt, other.context),
        change: changeOf(other.rebuilt),
      };
    }
    if (!best || !similarSure) {
      return kept(best ? "similar words only partly found in its own ayah" : "similar words not found in its own ayah");
    }
  }
  if (tied) return kept("similar words fit more than one place in its own ayah equally");
  if (best.similarSkip > MAX_FILL) return kept("its similar words skip a long stretch of its ayah");

  const beside = ayahOfSharedWords(best.place, context, ref.ayah, siblings);
  if (beside !== null) {
    const note = `the similar words it shares with its group are ${ref.surah}:${beside}'s`;
    const besideContext = contextOf(quran, ref.surah, beside);
    const found = bestRebuild(placeSimilar(segments[1], besideContext, beside), segments, besideContext, all);
    const sure =
      found.best &&
      !found.tied &&
      found.best.place.dropped <= Math.floor(segments[1].length / 3) &&
      found.best.similarSkip <= MAX_FILL;
    if (!sure) return kept(`${note}, but they do not rebuild there with certainty`);
    return {
      ...base,
      status: "relabelled",
      relabel: { surah: ref.surah, ayah: beside },
      kinds: ["relabelled"],
      notes: [note],
      segments: segmentsOf(found.best, besideContext),
      change: changeOf(found.best),
    };
  }
  return {
    ...base,
    status: "rebuilt",
    kinds: [],
    notes: [],
    segments: segmentsOf(best, context),
    change: changeOf(best),
  };
}
