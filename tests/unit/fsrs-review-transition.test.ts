import { localStartOfTomorrow } from "@/lib/date";
import {
  calculateReviewTransition,
  type ReviewTransition,
} from "@/lib/fsrs/review-transition";
import { gradeCard, Rating, State, type Grade } from "@/lib/fsrs/scheduler";
import {
  DEFAULT_DECK_DAILY_REVIEW_LIMIT,
  DEFAULT_DECK_ENABLE_FUZZ,
  DEFAULT_DECK_ENABLE_SHORT_TERM,
  DEFAULT_DECK_LEARNING_STEPS,
  DEFAULT_DECK_MAXIMUM_INTERVAL,
  DEFAULT_DECK_NEW_CARD_LIMIT,
  DEFAULT_DECK_RELEARNING_STEPS,
  DEFAULT_DECK_REQUEST_RETENTION,
  DEFAULT_ENABLED_MODES,
  DEFAULT_NEW_CARD_SORT_ORDER,
  DEFAULT_NEW_REVIEW_ORDER,
  DEFAULT_REVIEW_SORT_ORDER,
  DEFAULT_WORD_TEST_MODES,
  type DeckReviewSettings,
  type StudyCardRow,
} from "@/lib/fsrs/types";

const REVIEWED_AT = new Date("2026-08-30T09:15:00.000Z");

function makeReviewPolicy(overrides: Partial<DeckReviewSettings> = {}): DeckReviewSettings {
  return {
    dailyReviewLimit: DEFAULT_DECK_DAILY_REVIEW_LIMIT,
    newCardsLimit: DEFAULT_DECK_NEW_CARD_LIMIT,
    requestRetention: DEFAULT_DECK_REQUEST_RETENTION,
    maximumInterval: DEFAULT_DECK_MAXIMUM_INTERVAL,
    enableFuzz: DEFAULT_DECK_ENABLE_FUZZ,
    enableShortTerm: DEFAULT_DECK_ENABLE_SHORT_TERM,
    learningSteps: [...DEFAULT_DECK_LEARNING_STEPS],
    relearningSteps: [...DEFAULT_DECK_RELEARNING_STEPS],
    newReviewOrder: DEFAULT_NEW_REVIEW_ORDER,
    reviewSortOrder: DEFAULT_REVIEW_SORT_ORDER,
    newCardSortOrder: DEFAULT_NEW_CARD_SORT_ORDER,
    testModes: [...DEFAULT_ENABLED_MODES],
    wordTestModes: [...DEFAULT_WORD_TEST_MODES],
    ...overrides,
  };
}

function makeStudyCard(overrides: Partial<StudyCardRow> = {}): StudyCardRow {
  return {
    id: "2:255",
    deck_id: "retention",
    due: "2026-08-30T08:00:00.000Z",
    stability: 18,
    difficulty: 5.5,
    elapsed_days: 7,
    scheduled_days: 7,
    learning_steps: 0,
    reps: 12,
    lapses: 2,
    state: State.Review,
    last_review: "2026-08-23T09:15:00.000Z",
    suspended_at: null,
    buried_until: null,
    marked_at: "2026-08-24T10:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-08-23T09:15:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function expectTransitionToMatchScheduler(
  transition: ReviewTransition,
  source: StudyCardRow,
  rating: Grade,
  policy: DeckReviewSettings,
): void {
  const expected = gradeCard(
    {
      due: new Date(source.due),
      stability: source.stability,
      difficulty: source.difficulty,
      elapsed_days: source.elapsed_days,
      scheduled_days: source.scheduled_days,
      learning_steps: source.learning_steps,
      reps: source.reps,
      lapses: source.lapses,
      state: State.Review,
      last_review: source.last_review ? new Date(source.last_review) : undefined,
    },
    REVIEWED_AT,
    rating,
    policy,
  );

  expect(transition.updatedCard).toEqual({
    ...source,
    due: expected.card.due.toISOString(),
    stability: expected.card.stability,
    difficulty: expected.card.difficulty,
    elapsed_days: expected.card.elapsed_days,
    scheduled_days: expected.card.scheduled_days,
    learning_steps: expected.card.learning_steps,
    reps: expected.card.reps,
    lapses: expected.card.lapses,
    state: expected.card.state,
    last_review: REVIEWED_AT.toISOString(),
    updated_at: REVIEWED_AT.toISOString(),
  });
  expect(transition.reviewRecord).toEqual({
    rating,
    state: expected.log.state,
    due: expected.log.due.toISOString(),
    stability: expected.log.stability,
    difficulty: expected.log.difficulty,
    elapsedDays: expected.log.elapsed_days,
    scheduledDays: expected.log.scheduled_days,
    reviewedAt: REVIEWED_AT.toISOString(),
  });
}

describe("review transition", () => {
  it.each<Grade>([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy])(
    "maps rating %s to the persisted card and review record",
    (rating) => {
      const source = makeStudyCard();
      const policy = makeReviewPolicy({ enableFuzz: false });

      const transition = calculateReviewTransition({
        card: source,
        rating,
        reviewedAt: REVIEWED_AT,
        reviewPolicy: policy,
      });

      expectTransitionToMatchScheduler(transition, source, rating, policy);
      expect(source).toEqual(makeStudyCard());
    },
  );

  it("uses the supplied deck review policy", () => {
    const transition = calculateReviewTransition({
      card: makeStudyCard({
        state: State.New,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        last_review: null,
      }),
      rating: Rating.Again,
      reviewedAt: REVIEWED_AT,
      reviewPolicy: makeReviewPolicy({ enableFuzz: false, learningSteps: ["7m"] }),
    });

    expect(new Date(transition.updatedCard.due).getTime() - REVIEWED_AT.getTime()).toBe(7 * 60 * 1000);
  });

  it("requeues active same-day learning cards", () => {
    const transition = calculateReviewTransition({
      card: makeStudyCard({
        state: State.New,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        last_review: null,
      }),
      rating: Rating.Again,
      reviewedAt: REVIEWED_AT,
      reviewPolicy: makeReviewPolicy({ enableFuzz: false, learningSteps: ["1m", "10m"] }),
    });

    expect(new Date(transition.updatedCard.due).getTime()).toBeLessThan(
      localStartOfTomorrow(REVIEWED_AT).getTime(),
    );
    expect(transition.shouldRequeueToday).toBe(true);
  });

  it.each<Partial<StudyCardRow>>([
    { suspended_at: "2026-08-29T09:15:00.000Z" },
    { buried_until: "2026-08-31T09:15:00.000Z" },
    { deleted_at: "2026-08-29T09:15:00.000Z" },
  ])("does not requeue an inactive card", (status) => {
    const transition = calculateReviewTransition({
      card: makeStudyCard({
        state: State.New,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        last_review: null,
        ...status,
      }),
      rating: Rating.Again,
      reviewedAt: REVIEWED_AT,
      reviewPolicy: makeReviewPolicy({ enableFuzz: false, learningSteps: ["1m", "10m"] }),
    });

    expect(transition.shouldRequeueToday).toBe(false);
  });

  it("requeues a same-day card after its burial has expired", () => {
    const transition = calculateReviewTransition({
      card: makeStudyCard({
        state: State.New,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        last_review: null,
        buried_until: "2026-08-30T09:14:59.000Z",
      }),
      rating: Rating.Again,
      reviewedAt: REVIEWED_AT,
      reviewPolicy: makeReviewPolicy({ enableFuzz: false, learningSteps: ["1m", "10m"] }),
    });

    expect(transition.shouldRequeueToday).toBe(true);
  });

  it("does not requeue a card scheduled after the local review day", () => {
    const transition = calculateReviewTransition({
      card: makeStudyCard(),
      rating: Rating.Easy,
      reviewedAt: REVIEWED_AT,
      reviewPolicy: makeReviewPolicy({ enableFuzz: false }),
    });

    expect(new Date(transition.updatedCard.due).getTime()).toBeGreaterThanOrEqual(
      localStartOfTomorrow(REVIEWED_AT).getTime(),
    );
    expect(transition.shouldRequeueToday).toBe(false);
  });

  it("rejects a persisted scheduler state outside the known state set", () => {
    expect(() =>
      calculateReviewTransition({
        card: makeStudyCard({ state: 99 }),
        rating: Rating.Good,
        reviewedAt: REVIEWED_AT,
      }),
    ).toThrow(new RangeError("Unsupported study card state: 99"));
  });
});
