ALTER TABLE public.reflections
  ADD COLUMN IF NOT EXISTS juz_start INTEGER,
  ADD COLUMN IF NOT EXISTS juz_end INTEGER;

WITH juz_map(juz, surah, ayah_start, ayah_end) AS (
  VALUES
    (1, 1, 1, 7),
    (1, 2, 1, 141),
    (2, 2, 142, 252),
    (3, 2, 253, 286),
    (3, 3, 1, 92),
    (4, 3, 93, 200),
    (4, 4, 1, 23),
    (5, 4, 24, 147),
    (6, 4, 148, 176),
    (6, 5, 1, 81),
    (7, 5, 82, 120),
    (7, 6, 1, 110),
    (8, 6, 111, 165),
    (8, 7, 1, 87),
    (9, 7, 88, 206),
    (9, 8, 1, 40),
    (10, 8, 41, 75),
    (10, 9, 1, 92),
    (11, 9, 93, 129),
    (11, 10, 1, 109),
    (11, 11, 1, 5),
    (12, 11, 6, 123),
    (12, 12, 1, 52),
    (13, 12, 53, 111),
    (13, 13, 1, 43),
    (13, 14, 1, 52),
    (14, 15, 1, 99),
    (14, 16, 1, 128),
    (15, 17, 1, 111),
    (15, 18, 1, 74),
    (16, 18, 75, 110),
    (16, 19, 1, 98),
    (16, 20, 1, 135),
    (17, 21, 1, 112),
    (17, 22, 1, 78),
    (18, 23, 1, 118),
    (18, 24, 1, 64),
    (18, 25, 1, 20),
    (19, 25, 21, 77),
    (19, 26, 1, 227),
    (19, 27, 1, 55),
    (20, 27, 56, 93),
    (20, 28, 1, 88),
    (20, 29, 1, 45),
    (21, 29, 46, 69),
    (21, 30, 1, 60),
    (21, 31, 1, 34),
    (21, 32, 1, 30),
    (21, 33, 1, 30),
    (22, 33, 31, 73),
    (22, 34, 1, 54),
    (22, 35, 1, 45),
    (22, 36, 1, 27),
    (23, 36, 28, 83),
    (23, 37, 1, 182),
    (23, 38, 1, 88),
    (23, 39, 1, 31),
    (24, 39, 32, 75),
    (24, 40, 1, 85),
    (24, 41, 1, 46),
    (25, 41, 47, 54),
    (25, 42, 1, 53),
    (25, 43, 1, 89),
    (25, 44, 1, 59),
    (25, 45, 1, 37),
    (26, 46, 1, 35),
    (26, 47, 1, 38),
    (26, 48, 1, 29),
    (26, 49, 1, 18),
    (26, 50, 1, 45),
    (26, 51, 1, 30),
    (27, 51, 31, 60),
    (27, 52, 1, 49),
    (27, 53, 1, 62),
    (27, 54, 1, 55),
    (27, 55, 1, 78),
    (27, 56, 1, 96),
    (27, 57, 1, 29),
    (28, 58, 1, 22),
    (28, 59, 1, 24),
    (28, 60, 1, 13),
    (28, 61, 1, 14),
    (28, 62, 1, 11),
    (28, 63, 1, 11),
    (28, 64, 1, 18),
    (28, 65, 1, 12),
    (28, 66, 1, 12),
    (29, 67, 1, 30),
    (29, 68, 1, 52),
    (29, 69, 1, 52),
    (29, 70, 1, 44),
    (29, 71, 1, 28),
    (29, 72, 1, 28),
    (29, 73, 1, 20),
    (29, 74, 1, 56),
    (29, 75, 1, 40),
    (29, 76, 1, 31),
    (29, 77, 1, 50),
    (30, 78, 1, 40),
    (30, 79, 1, 46),
    (30, 80, 1, 42),
    (30, 81, 1, 29),
    (30, 82, 1, 19),
    (30, 83, 1, 36),
    (30, 84, 1, 25),
    (30, 85, 1, 22),
    (30, 86, 1, 17),
    (30, 87, 1, 19),
    (30, 88, 1, 26),
    (30, 89, 1, 30),
    (30, 90, 1, 20),
    (30, 91, 1, 15),
    (30, 92, 1, 21),
    (30, 93, 1, 11),
    (30, 94, 1, 8),
    (30, 95, 1, 8),
    (30, 96, 1, 19),
    (30, 97, 1, 5),
    (30, 98, 1, 8),
    (30, 99, 1, 8),
    (30, 100, 1, 11),
    (30, 101, 1, 11),
    (30, 102, 1, 8),
    (30, 103, 1, 3),
    (30, 104, 1, 9),
    (30, 105, 1, 5),
    (30, 106, 1, 4),
    (30, 107, 1, 7),
    (30, 108, 1, 3),
    (30, 109, 1, 6),
    (30, 110, 1, 3),
    (30, 111, 1, 5),
    (30, 112, 1, 4),
    (30, 113, 1, 5),
    (30, 114, 1, 6)
),
mapped AS (
  SELECT
    r.id,
    start_map.juz AS next_juz_start,
    end_map.juz AS next_juz_end
  FROM public.reflections r
  JOIN juz_map start_map
    ON start_map.surah = r.surah
    AND r.ayah_start BETWEEN start_map.ayah_start AND start_map.ayah_end
  JOIN juz_map end_map
    ON end_map.surah = r.surah
    AND r.ayah_end BETWEEN end_map.ayah_start AND end_map.ayah_end
)
UPDATE public.reflections r
SET
  juz_start = mapped.next_juz_start,
  juz_end = mapped.next_juz_end
FROM mapped
WHERE r.id = mapped.id
  AND (r.juz_start IS NULL OR r.juz_end IS NULL);

ALTER TABLE public.reflections
  ALTER COLUMN juz_start SET NOT NULL,
  ALTER COLUMN juz_end SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reflections_juz_range_check'
  ) THEN
    ALTER TABLE public.reflections
      ADD CONSTRAINT reflections_juz_range_check
      CHECK (
        juz_start BETWEEN 1 AND 30
        AND juz_end BETWEEN 1 AND 30
        AND juz_start <= juz_end
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reflections_feed_created
  ON public.reflections(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reflections_feed_likes
  ON public.reflections(status, likes_count DESC, comments_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reflections_surah_feed
  ON public.reflections(status, surah, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reflections_juz_feed
  ON public.reflections(status, juz_start, juz_end, created_at DESC);
