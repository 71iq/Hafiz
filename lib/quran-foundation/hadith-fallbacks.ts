import type { QfHadithResponse } from "./content";

const AYAT_AL_KURSI_BUKHARI_2311_EN =
  `Allah's Messenger (ﷺ) deputed me to keep Sadaqat (al-Fitr) of Ramadan. A comer came and started taking handfuls of the foodstuff (of the Sadaqa) (stealthily). I took hold of him and said, "By Allah, I will take you to Allah's Messenger (ﷺ) ." He said, "I am needy and have many dependents, and I am in great need." I released him, and in the morning Allah's Messenger (ﷺ) asked me, "What did your prisoner do yesterday?" I said, "O Allah's Messenger! The person complained of being needy and of having many dependents, so, I pitied him and let him go." Allah's Messenger (ﷺ) said, "Indeed, he told you a lie and he will be coming again." I believed that he would show up again as Allah's Messenger (ﷺ) had told me that he would return. So, I waited for him watchfully. When he (showed up and) started stealing handfuls of foodstuff, I caught hold of him again and said, "I will definitely take you to Allah's Messenger. He said, "Leave me, for I am very needy and have many dependents. I promise I will not come back again." I pitied him and let him go.

In the morning Allah's Messenger (ﷺ) asked me, "What did your prisoner do." I replied, "O Allah's Messenger! He complained of his great need and of too many dependents, so I took pity on him and set him free." Allah's Apostle said, "Verily, he told you a lie and he will return." I waited for him attentively for the third time, and when he (came and) started stealing handfuls of the foodstuff, I caught hold of him and said, "I will surely take you to Allah's Messenger (ﷺ) as it is the third time you promise not to return, yet you break your promise and come." He said, "(Forgive me and) I will teach you some words with which Allah will benefit you." I asked, "What are they?" He replied, "Whenever you go to bed, recite "Ayat-al-Kursi"-- 'Allahu la ilaha illa huwa-l-Haiy-ul Qaiyum' till you finish the whole verse. (If you do so), Allah will appoint a guard for you who will stay with you and no satan will come near you till morning. " So, I released him. In the morning, Allah's Apostle asked, "What did your prisoner do yesterday?" I replied, "He claimed that he would teach me some words by which Allah will benefit me, so I let him go." Allah's Messenger (ﷺ) asked, "What are they?" I replied, "He said to me, 'Whenever you go to bed, recite Ayat-al-Kursi from the beginning to the end ---- Allahu la ilaha illa huwa-lHaiy-ul-Qaiyum----.' He further said to me, '(If you do so), Allah will appoint a guard for you who will stay with you, and no satan will come near you till morning.' (Abu Huraira or another sub-narrator) added that they (the companions) were very keen to do good deeds. The Prophet (ﷺ) said, "He really spoke the truth, although he is an absolute liar. Do you know whom you were talking to, these three nights, O Abu Huraira?" Abu Huraira said, "No." He said, "It was Satan."`;

const AYAT_AL_KURSI_BUKHARI_2311_AR =
  `وَقَالَ عُثْمَانُ بْنُ الْهَيْثَمِ أَبُو عَمْرٍو حَدَّثَنَا عَوْفٌ، عَنْ مُحَمَّدِ بْنِ سِيرِينَ، عَنْ أَبِي هُرَيْرَةَ ـ رضى الله عنه ـ قَالَ وَكَّلَنِي رَسُولُ اللَّهِ صلى الله عليه وسلم بِحِفْظِ زَكَاةِ رَمَضَانَ، فَأَتَانِي آتٍ فَجَعَلَ يَحْثُو مِنَ الطَّعَامِ، فَأَخَذْتُهُ، وَقُلْتُ وَاللَّهِ لأَرْفَعَنَّكَ إِلَى رَسُولِ اللَّهِ صلى الله عليه وسلم. قَالَ إِنِّي مُحْتَاجٌ، وَعَلَىَّ عِيَالٌ، وَلِي حَاجَةٌ شَدِيدَةٌ. قَالَ فَخَلَّيْتُ عَنْهُ فَأَصْبَحْتُ فَقَالَ النَّبِيُّ صلى الله عليه وسلم " يَا أَبَا هُرَيْرَةَ مَا فَعَلَ أَسِيرُكَ الْبَارِحَةَ ". قَالَ قُلْتُ يَا رَسُولَ اللَّهِ شَكَا حَاجَةً شَدِيدَةً وَعِيَالاً فَرَحِمْتُهُ، فَخَلَّيْتُ سَبِيلَهُ. قَالَ " أَمَا إِنَّهُ قَدْ كَذَبَكَ وَسَيَعُودُ ". فَعَرَفْتُ أَنَّهُ سَيَعُودُ لِقَوْلِ رَسُولِ اللَّهِ صلى الله عليه وسلم إِنَّهُ سَيَعُودُ. فَرَصَدْتُهُ فَجَاءَ يَحْثُو مِنَ الطَّعَامِ فَأَخَذْتُهُ فَقُلْتُ لأَرْفَعَنَّكَ إِلَى رَسُولِ اللَّهِ صلى الله عليه وسلم. قَالَ دَعْنِي فَإِنِّي مُحْتَاجٌ، وَعَلَىَّ عِيَالٌ لاَ أَعُودُ، فَرَحِمْتُهُ، فَخَلَّيْتُ سَبِيلَهُ فَأَصْبَحْتُ، فَقَالَ لِي رَسُولُ اللَّهِ صلى الله عليه وسلم " يَا أَبَا هُرَيْرَةَ، مَا فَعَلَ أَسِيرُكَ ". قُلْتُ يَا رَسُولَ اللَّهِ شَكَا حَاجَةً شَدِيدَةً وَعِيَالاً، فَرَحِمْتُهُ فَخَلَّيْتُ سَبِيلَهُ. قَالَ " أَمَا إِنَّهُ قَدْ كَذَبَكَ وَسَيَعُودُ ". فَرَصَدْتُهُ الثَّالِثَةَ فَجَاءَ يَحْثُو مِنَ الطَّعَامِ، فَأَخَذْتُهُ فَقُلْتُ لأَرْفَعَنَّكَ إِلَى رَسُولِ اللَّهِ صلى الله عليه وسلم، وَهَذَا آخِرُ ثَلاَثِ مَرَّاتٍ أَنَّكَ تَزْعُمُ لاَ تَعُودُ ثُمَّ تَعُودُ. قَالَ دَعْنِي أُعَلِّمْكَ كَلِمَاتٍ يَنْفَعُكَ اللَّهُ بِهَا. قُلْتُ مَا هُوَ قَالَ إِذَا أَوَيْتَ إِلَى فِرَاشِكَ فَاقْرَأْ آيَةَ الْكُرْسِيِّ {اللَّهُ لاَ إِلَهَ إِلاَّ هُوَ الْحَىُّ الْقَيُّومُ} حَتَّى تَخْتِمَ الآيَةَ، فَإِنَّكَ لَنْ يَزَالَ عَلَيْكَ مِنَ اللَّهِ حَافِظٌ وَلاَ يَقْرَبَنَّكَ شَيْطَانٌ حَتَّى تُصْبِحَ. فَخَلَّيْتُ سَبِيلَهُ فَأَصْبَحْتُ، فَقَالَ لِي رَسُولُ اللَّهِ صلى الله عليه وسلم " مَا فَعَلَ أَسِيرُكَ الْبَارِحَةَ ". قُلْتُ يَا رَسُولَ اللَّهِ زَعَمَ أَنَّهُ يُعَلِّمُنِي كَلِمَاتٍ، يَنْفَعُنِي اللَّهُ بِهَا، فَخَلَّيْتُ سَبِيلَهُ. قَالَ " مَا هِيَ ". قُلْتُ قَالَ لِي إِذَا أَوَيْتَ إِلَى فِرَاشِكَ فَاقْرَأْ آيَةَ الْكُرْسِيِّ مِنْ أَوَّلِهَا حَتَّى تَخْتِمَ {اللَّهُ لاَ إِلَهَ إِلاَّ هُوَ الْحَىُّ الْقَيُّومُ} وَقَالَ لِي لَنْ يَزَالَ عَلَيْكَ مِنَ اللَّهِ حَافِظٌ وَلاَ يَقْرَبَكَ شَيْطَانٌ حَتَّى تُصْبِحَ، وَكَانُوا أَحْرَصَ شَىْءٍ عَلَى الْخَيْرِ. فَقَالَ النَّبِيُّ صلى الله عليه وسلم " أَمَا إِنَّهُ قَدْ صَدَقَكَ وَهُوَ كَذُوبٌ، تَعْلَمُ مَنْ تُخَاطِبُ مُنْذُ ثَلاَثِ لَيَالٍ يَا أَبَا هُرَيْرَةَ ". قَالَ لاَ. قَالَ " ذَاكَ شَيْطَانٌ ".`;

export function getVerifiedAyahHadithFallback(
  surah: number,
  ayah: number,
  language: "en" | "ar",
  page: number,
  limit: number
): QfHadithResponse | null {
  if (surah !== 2 || ayah !== 255 || page !== 1) return null;

  return {
    ok: true,
    verseKey: "2:255",
    language,
    direction: language === "ar" ? "rtl" : "ltr",
    page,
    limit,
    hasMore: false,
    hadiths: [
      {
        urn: 2311,
        collection: "Sahih al-Bukhari",
        bookNumber: "40",
        hadithNumber: "2311",
        name: language === "ar" ? "صحيح البخاري 2311" : "Sahih al-Bukhari 2311",
        hadith: [
          {
            lang: language,
            body: language === "ar" ? AYAT_AL_KURSI_BUKHARI_2311_AR : AYAT_AL_KURSI_BUKHARI_2311_EN,
            urn: 2311,
          },
        ],
      },
    ],
    fetchedAt: new Date().toISOString(),
  };
}
