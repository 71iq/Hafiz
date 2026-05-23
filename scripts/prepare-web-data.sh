#!/bin/bash
# Copy data files to public/ for web static serving.
# On web, these are fetched at runtime via fetch() instead of being
# bundled into the JS bundle via require().

set -e

echo "Preparing web data files..."

if [ ! -s assets/data/quran.db ]; then
  node scripts/build-quran-db.mjs
fi

mkdir -p public/data/translations public/data/layout public/data/mutashabihat

# Runtime JSON that is still intentionally lazy on web.
cp assets/data/surah-info.json public/data/
cp assets/data/wbw-arabic-meanings.json public/data/
cp assets/data/irab-per-word.json public/data/
cp assets/data/tajweed-rules-ar.json public/data/
cp assets/data/tajweed-rules-en.json public/data/
cp assets/data/al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json public/data/
cp assets/data/mutashabihat/nourquran_hafiz.json public/data/mutashabihat/
cp assets/data/layout/page-words.json public/data/layout/
cp assets/data/layout/page-lines.json public/data/layout/
cp assets/data/translations/*.json public/data/translations/

echo "Done. Web data files copied to public/data/"
