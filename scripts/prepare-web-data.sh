#!/bin/bash
# Copy data files to public/ for web static serving.
# On web, these are fetched at runtime via fetch() instead of being
# bundled into the JS bundle via require().

set -e

echo "Preparing web data files..."

mkdir -p public/data/tafseer public/data/tafsir-sources/tahrir-tanwir public/data/tafsir-sources/qurtubi public/data/tafsir-sources/kashshaf public/data/tafsir-sources/alusi public/data/tafsir-sources/nazam-durar public/data/translations public/data/wbw public/data/masaq public/data/layout public/data/mutashabihat

# Core data files
cp assets/data/quran-data.json public/data/
cp assets/data/quran-qcf2.json public/data/
cp assets/data/surah-info.json public/data/
cp assets/data/reflection-journey.json public/data/
cp assets/data/translation-sahih.json public/data/
cp assets/data/page-map.json public/data/
cp assets/data/tajweed.json public/data/
cp assets/data/zilal.json public/data/
cp assets/data/wbw-arabic-meanings.json public/data/
cp assets/data/irab-per-word.json public/data/
cp assets/data/tajweed-rules-ar.json public/data/
cp assets/data/tajweed-rules-en.json public/data/
cp assets/data/al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json public/data/
cp assets/data/mutashabihat/nourquran_hafiz.json public/data/mutashabihat/

# Subdirectory data
cp assets/data/wbw/wbw.json public/data/wbw/
cp assets/data/masaq/masaq-aggregated.json public/data/masaq/
cp assets/data/layout/page-lines.json public/data/layout/
cp assets/data/layout/page-words.json public/data/layout/

# Tafseer (114 files)
cp assets/data/tafseer/*.json public/data/tafseer/
cp assets/data/tafsir-sources/tahrir-tanwir/*.json public/data/tafsir-sources/tahrir-tanwir/
cp assets/data/tafsir-sources/qurtubi/*.json public/data/tafsir-sources/qurtubi/
cp assets/data/tafsir-sources/kashshaf/*.json public/data/tafsir-sources/kashshaf/
cp assets/data/tafsir-sources/alusi/*.json public/data/tafsir-sources/alusi/
cp assets/data/tafsir-sources/nazam-durar/*.json public/data/tafsir-sources/nazam-durar/

# Translations (20 files)
cp assets/data/translations/*.json public/data/translations/

echo "Done. Web data files copied to public/data/"
