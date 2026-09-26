#!/usr/bin/env python3
"""Cadence and tell checker for the written-voice house style.

Reports the markers that make prose read as machine-written (the catalog and
its budgets are references/ai-tells.md), plus a crude unknown-word pass. It
flags candidates for a person to judge. It never rewrites, and it never claims
a passing score means anything about a detector.

Usage:
    python3 voice-check.py FILE [FILE ...] [--allow WORDFILE]

Accepts .md, .txt, or .html (tags and <style>/<script> blocks are stripped).
"""

import argparse
import pathlib
import re
import statistics
import sys

DICT = pathlib.Path("/usr/share/dict/words")

# Vocabulary with measured frequency spikes in machine-assisted writing, plus
# the house hype ban. Sources: references/ai-tells.md.
TICS = [
    "delve", "underscore", "underscores", "meticulous", "meticulously",
    "intricate", "commendable", "realm", "showcase", "leverage", "utilize",
    "tapestry", "testament", "navigate the", "in today's", "ever-evolving",
    "seamless", "seamlessly", "robust", "revolutionary", "best-in-class",
    "cutting-edge", "game-changing", "powerful", "blazing", "unlock",
    "elevate", "foster", "myriad", "plethora", "crucial", "pivotal", "vital",
    "foundational", "landscape", "interplay", "garner", "vibrant", "enduring",
    "nestled", "boasts", "multifaceted", "holistic", "synergy", "paradigm",
    "transformative", "groundbreaking",
]
TRANSITIONS = [
    "moreover", "furthermore", "additionally", "consequently", "notably",
    "importantly", "it's important to note", "it is important to note",
    "in conclusion", "ultimately", "that said", "at its core", "in essence",
]
# Openers, sign-offs, and filler that belong to a chat window, not a document.
STOCK_PHRASES = [
    "here's the thing", "here is the thing", "hope this helps",
    "after careful consideration", "i wanted to provide a quick update",
    "i wanted to reach out", "great question", "you're absolutely right",
    "let's dive in", "let's dive into", "dive into", "deep dive",
    "let's break it down", "let's unpack", "in today's fast-paced",
    "it's worth noting", "at the end of the day", "without further ado",
    "let me know if you have any questions", "feel free to",
    "i hope this email finds you well", "most people", "the bottom line",
    "game changer", "a testament to", "plays a crucial role",
]
# Adverbs that add a mood instead of a fact ("X quietly runs Y").
FILLER_ADVERBS = [
    "quietly", "simply", "truly", "genuinely", "fundamentally", "deeply",
    "incredibly", "effortlessly", "profoundly", "seamlessly",
]
COPULA = re.compile(r"\b(?:serves|stands|functions|acts) as (?:a|an|the)\b", re.I)
NOT_JUST = re.compile(r"\bnot (?:just|only|merely) [^.;!?]{1,60}?,? but(?: also)?\b", re.I)
SPACED_DASH = re.compile(r"(?<=[\w,)]) [-\u2013] (?=[\w(])")
BULLET = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+", re.M)
BOLD_LEAD = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+\*\*[^*\n]+\*\*", re.M)
EMOJI_HEADING = re.compile(r"^#{1,6}\s*[\U0001F300-\U0001FAFF\u2600-\u27BF]", re.M)

# The single most recognisable machine construction: negate, then correct.
ANTITHESIS = [
    re.compile(r"\b(?:it|that|this|the \w+)\s+(?:is|was)n't\s+[^.!?]{2,60}[.;]\s+(?:it|that|this)\s+(?:is|was|'s)\b", re.I),
    re.compile(r"\bnot\s+(?:because|that)\b[^.!?]{2,80}\.\s*(?:because|but)\b", re.I),
    re.compile(r"\bisn't\s+\w+[^.!?]{0,40}[.;]\s+it's\b", re.I),
    re.compile(r"\bnot\s+\w+\.\s+\w+\.", re.I),  # "Not reassurance. Specific."
]

TRIAD = re.compile(r"\b[\w'-]+(?:\s+[\w'-]+){0,3},\s+[\w'-]+(?:\s+[\w'-]+){0,3},\s+and\s+[\w'-]+", re.I)
APHORISM_OPEN = re.compile(r"^(that's|that is|this is|it's|it is|which is|and that)\b", re.I)

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'“])")


def load_text(path):
    raw = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() in {".html", ".htm"}:
        raw = re.sub(r"<(script|style)\b.*?</\1>", " ", raw, flags=re.S | re.I)
        # Drop review/appendix blocks so scaffolding doesn't skew the numbers.
        raw = re.sub(r'<div class="review".*?</div>', " ", raw, flags=re.S | re.I)
        raw = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
        raw = re.sub(r"</(p|h[1-6]|li|figcaption|blockquote|div)>", "\n\n", raw, flags=re.I)
        raw = re.sub(r"<[^>]+>", " ", raw)
        raw = re.sub(r"&nbsp;", " ", raw)
        raw = re.sub(r"&mdash;", "—", raw)
        raw = re.sub(r"&(amp|lt|gt|quot|#39);", " ", raw)
    else:
        raw = re.sub(r"```.*?```", " ", raw, flags=re.S)
        raw = re.sub(r"^\s{4,}\S.*$", " ", raw, flags=re.M)
    return raw


def paragraphs(text):
    parts = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    return [p for p in parts if len(p.split()) >= 8]


def sentences(para):
    return [s.strip() for s in SENT_SPLIT.split(para) if s.strip()]


def cv(values):
    """Coefficient of variation. Low means uniform, which is the tell."""
    if len(values) < 2:
        return 0.0
    m = statistics.mean(values)
    return (statistics.pstdev(values) / m) if m else 0.0


def known_words():
    if not DICT.exists():
        return None
    return {w.strip().lower() for w in DICT.read_text(errors="replace").splitlines() if w.strip()}


IRREGULAR = {
    "became": "become", "begun": "begin", "began": "begin", "held": "hold",
    "kept": "keep", "left": "leave", "meant": "mean", "sent": "send",
    "spent": "spend", "built": "build", "caught": "catch", "taught": "teach",
    "brought": "bring", "bought": "buy", "fought": "fight", "thought": "think",
    "sought": "seek", "told": "tell", "sold": "sell", "felt": "feel",
    "dealt": "deal", "knew": "know", "known": "know", "grew": "grow",
    "grown": "grow", "threw": "throw", "thrown": "throw", "drew": "draw",
    "drawn": "draw", "flew": "fly", "flown": "fly", "wrote": "write",
    "written": "write", "spoke": "speak", "spoken": "speak", "broke": "break",
    "broken": "break", "chose": "choose", "chosen": "choose", "froze": "freeze",
    "stole": "steal", "rose": "rise", "risen": "rise", "drove": "drive",
    "driven": "drive", "gave": "give", "given": "give", "took": "take",
    "taken": "take", "shook": "shake", "saw": "see", "seen": "see",
    "went": "go", "gone": "go", "did": "do", "done": "do", "made": "make",
    "found": "find", "got": "get", "gotten": "get", "had": "have",
    "heard": "hear", "lost": "lose", "paid": "pay", "said": "say",
    "sat": "sit", "stood": "stand", "understood": "understand", "won": "win",
    "ran": "run", "run": "run", "came": "come", "fell": "fall", "fallen": "fall",
    "led": "lead", "read": "read", "put": "put", "set": "set", "cut": "cut",
    "let": "let", "shut": "shut", "hit": "hit", "cost": "cost", "hurt": "hurt",
    "worse": "bad", "worst": "bad", "better": "good", "best": "good",
    "men": "man", "women": "woman", "people": "person", "children": "child",
    "feet": "foot", "teeth": "tooth", "lives": "life", "selves": "self",
}

CONTRACTION = re.compile(r"(?:n't|'m|'re|'ve|'ll|'d|'s)$", re.I)


def _forms(w):
    """Every base form a token might reduce to. Crude, deliberately generous."""
    out = {w}
    if w in IRREGULAR:
        out.add(IRREGULAR[w])
    for suf, repls in (
        ("s", ("",)), ("es", ("", "e")), ("ies", ("y",)),
        ("ed", ("", "e")), ("ied", ("y",)),
        ("ing", ("", "e")),
        ("er", ("", "e")), ("est", ("", "e")), ("ier", ("y",)), ("iest", ("y",)),
        ("ly", ("", "le")), ("ily", ("y",)),
        ("ness", ("",)), ("ment", ("",)), ("tion", ("te", "t")),
    ):
        if w.endswith(suf) and len(w) > len(suf) + 1:
            stem = w[: -len(suf)]
            for r in repls:
                out.add(stem + r)
            # doubled final consonant: dropped -> drop, formatted -> format
            if len(stem) > 2 and stem[-1] == stem[-2] and stem[-1] not in "aeiou":
                out.add(stem[:-1])
    return {f for f in out if len(f) > 1}


def unknown_words(text, vocab, allow):
    if vocab is None:
        return None

    def ok(tok):
        return any(f in vocab or f in allow for f in _forms(tok))

    out = {}
    for m in re.finditer(r"[A-Za-z][A-Za-z'\u2019-]*", text):
        raw = m.group(0).replace("\u2019", "'")
        # a hyphenated compound is fine if every part is fine
        parts = [p for p in raw.split("-") if p]
        good = True
        for part in parts:
            t = CONTRACTION.sub("", part.lower()).strip("'")
            if len(t) < 3:
                continue
            if not ok(t):
                good = False
                break
        if good:
            continue
        out[raw.lower()] = out.get(raw.lower(), 0) + 1
    return out


def report(path, allow):
    text = load_text(path)
    paras = paragraphs(text)
    if not paras:
        print(f"{path}: no prose paragraphs found")
        return 0

    sents = [s for p in paras for s in sentences(p)]
    slen = [len(s.split()) for s in sents]
    plen = [len(p.split()) for p in paras]
    words = sum(slen)

    print(f"\n=== {path.name} ===")
    print(f"{words} words / {len(paras)} paragraphs / {len(sents)} sentences")

    print("\n-- cadence --")
    s_cv, p_cv = cv(slen), cv(plen)
    print(f"sentence length: mean {statistics.mean(slen):.1f}, "
          f"range {min(slen)}-{max(slen)}, variation {s_cv:.2f} "
          f"{'OK' if s_cv >= 0.55 else 'FLAT -> vary it'}")
    print(f"paragraph length: mean {statistics.mean(plen):.1f}, "
          f"range {min(plen)}-{max(plen)}, variation {p_cv:.2f} "
          f"{'OK' if p_cv >= 0.50 else 'FLAT -> vary it'}")
    short_paras = sum(1 for n in plen if n <= 25)
    long_paras = sum(1 for n in plen if n >= 110)
    print(f"paragraphs <=25 words: {short_paras}  (want some)")
    print(f"paragraphs >=110 words: {long_paras}  (want some)")

    openers = {}
    for s in sents:
        first = s.split()[0].strip('",“').lower() if s.split() else ""
        openers[first] = openers.get(first, 0) + 1
    common = {"the", "a", "an", "i", "we", "you", "and", "but", "in", "for", "if", "when"}
    repeats = sorted(((n, w) for w, n in openers.items()
                      if w not in common and n / max(len(sents), 1) >= 0.03), reverse=True)
    if repeats:
        print("over-used sentence openers (>=3% of sentences): "
              + ", ".join(f"{w} x{n}" for n, w in repeats[:8]))
    else:
        print("over-used sentence openers: none")

    print("\n-- constructions --")
    hits = 0
    for pat in ANTITHESIS:
        for m in pat.finditer(text):
            hits += 1
            if hits <= 6:
                print(f"  negate-then-correct: ...{m.group(0)[:88].strip()}...")
    print(f"negate-then-correct total: {hits} {'OK' if hits <= 2 else '-> cut most of these'}")

    triads = TRIAD.findall(text)
    print(f"rule-of-three lists: {len(triads)} {'OK' if len(triads) <= 3 else '-> break some into 2 or 4'}")
    for t in triads[:5]:
        print(f"  {t.strip()[:80]}")

    closers = 0
    for p in paras:
        ss = sentences(p)
        if ss and len(ss[-1].split()) <= 12 and APHORISM_OPEN.match(ss[-1]):
            closers += 1
    print(f"short aphoristic paragraph endings: {closers} "
          f"{'OK' if closers <= 3 else '-> let some paragraphs end flat'}")

    copulas = len(COPULA.findall(text))
    print(f"'serves as' copulas: {copulas} {'OK' if copulas <= 1 else '-> say is'}")
    notjust = len(NOT_JUST.findall(text))
    print(f"'not just X but Y': {notjust} {'OK' if notjust <= 1 else '-> state the point once'}")

    print("\n-- lexicon --")
    low = text.lower()

    def counts(words):
        found = [(w, len(re.findall(r"\b" + re.escape(w) + r"\b", low))) for w in words]
        return [(w, n) for w, n in found if n]

    def listed(found):
        return ", ".join(f"{w} x{n}" for w, n in found) if found else "none"

    print("banned tics: " + listed(counts(TICS)))
    print("stock phrases: " + listed(counts(STOCK_PHRASES)))
    print("filler adverbs: " + listed(counts(FILLER_ADVERBS)))
    print("formulaic transitions: " + listed(counts(TRANSITIONS)))
    em = text.count("\u2014")
    spaced = len(SPACED_DASH.findall(text))
    dashes = em + spaced
    print(f"em dashes: {dashes} ({em} em, {spaced} spaced hyphen or en) "
          f"{'OK' if dashes <= 2 else '-> house limit is rare and deliberate'}")

    print("\n-- formatting --")
    raw = path.read_text(encoding="utf-8", errors="replace")
    bullets = len(BULLET.findall(raw))
    bold = len(BOLD_LEAD.findall(raw))
    heavy = bullets >= 6 and bold / bullets > 0.6
    print(f"bold-lead bullets: {bold} of {bullets} "
          f"{'-> most bullets open with a bold label; let some be plain' if heavy else 'OK'}")
    emoji = len(EMOJI_HEADING.findall(raw))
    print(f"emoji headings: {emoji} {'OK' if not emoji else '-> remove'}")

    print("\n-- spelling (candidates, not verdicts) --")
    unk = unknown_words(text, known_words(), allow)
    if unk is None:
        print("no system dictionary at /usr/share/dict/words; skipped")
    elif not unk:
        print("no unknown words")
    else:
        for w, n in sorted(unk.items(), key=lambda kv: (-kv[1], kv[0]))[:40]:
            print(f"  {w} (x{n})")
        print(f"{len(unk)} unknown word(s). Add real ones to the allowlist.")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=pathlib.Path)
    ap.add_argument("--allow", type=pathlib.Path,
                    default=pathlib.Path(__file__).with_name("allow-words.txt"))
    args = ap.parse_args()
    allow = set()
    if args.allow.exists():
        allow = {w.strip().lower() for w in args.allow.read_text().splitlines()
                 if w.strip() and not w.startswith("#")}
    for f in args.files:
        if not f.exists():
            print(f"{f}: not found", file=sys.stderr)
            continue
        report(f, allow)


if __name__ == "__main__":
    main()
