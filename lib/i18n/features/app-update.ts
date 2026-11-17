/**
 * Android in-app update: download progress, install prompt, failures and the automatic download
 * setting. Spread into lib/i18n/strings.ts. Keep English and Arabic keys in parity.
 */
export const appUpdateStrings = {
  en: {
    appUpdateSubtitleSize: "Hafiz {{version}} is available. Download size {{size}}.",
    appUpdateSizeMb: "{{size}} MB",
    appUpdatePercent: "{{percent}}%",
    appUpdateDownloadingTitle: "Downloading update",
    appUpdateDownloadingSubtitle: "Hafiz {{version}} is downloading.",
    appUpdateDownloadingProgress: "Hafiz {{version}} · {{progress}}",
    appUpdateReadyTitle: "Update ready",
    appUpdateReadySubtitle: "Hafiz {{version}} is downloaded and ready to install.",
    appUpdateInstallButton: "Install update",
    appUpdateInstallNow: "Install now",
    appUpdateLater: "Later",
    appUpdateReadyMessage: "Hafiz {{version}} is downloaded. Android will ask you to confirm the installation.",
    appUpdateFailedTitle: "Update failed",
    appUpdateFailedDownload: "The download stopped. Check your connection and try again.",
    appUpdateFailedVerify: "The downloaded file was incomplete or damaged, so it was deleted. Try again.",
    appUpdateFailedInstall: "The installer could not be opened. Try again.",
    appUpdateMeteredTitle: "Download the update?",
    appUpdateMeteredMessage:
      "Hafiz {{version}} is a {{size}} download. You are not on Wi-Fi without a data limit, so it may use your data.",
    appUpdateMeteredMessageNoSize:
      "Hafiz {{version}} is a large download. You are not on Wi-Fi without a data limit, so it may use your data.",
    appUpdateDownloadNow: "Download",
    appUpdateNotificationBody: "Hafiz {{version}} is ready to install. Tap to open Hafiz.",
    appUpdateChannelName: "App updates",
    autoDownloadUpdatesLabel: "Download updates automatically",
    autoDownloadUpdatesHint:
      "On Wi-Fi without a data limit, a new version downloads while Hafiz is open. Hafiz asks before installing it.",
  },
  ar: {
    appUpdateSubtitleSize: "الإصدار {{version}} من حافظ متاح. حجم التنزيل {{size}}.",
    appUpdateSizeMb: "{{size}} ميغابايت",
    appUpdatePercent: "{{percent}}٪",
    appUpdateDownloadingTitle: "جارٍ تنزيل التحديث",
    appUpdateDownloadingSubtitle: "يجري تنزيل الإصدار {{version}} من حافظ.",
    appUpdateDownloadingProgress: "الإصدار {{version}} · {{progress}}",
    appUpdateReadyTitle: "التحديث جاهز",
    appUpdateReadySubtitle: "نُزّل الإصدار {{version}} من حافظ وهو جاهز للتثبيت.",
    appUpdateInstallButton: "تثبيت التحديث",
    appUpdateInstallNow: "ثبّت الآن",
    appUpdateLater: "لاحقًا",
    appUpdateReadyMessage: "نُزّل الإصدار {{version}} من حافظ. سيطلب منك أندرويد تأكيد التثبيت.",
    appUpdateFailedTitle: "تعذّر التحديث",
    appUpdateFailedDownload: "توقف التنزيل. تحقق من اتصالك وحاول مجددًا.",
    appUpdateFailedVerify: "كان الملف المنزّل ناقصًا أو تالفًا فحُذف. حاول مجددًا.",
    appUpdateFailedInstall: "تعذّر فتح أداة التثبيت. حاول مجددًا.",
    appUpdateMeteredTitle: "تنزيل التحديث؟",
    appUpdateMeteredMessage:
      "حجم تنزيل الإصدار {{version}} من حافظ {{size}}. لست متصلًا بشبكة Wi-Fi بلا حد للبيانات، لذا قد يستهلك من باقتك.",
    appUpdateMeteredMessageNoSize:
      "تنزيل الإصدار {{version}} من حافظ كبير الحجم. لست متصلًا بشبكة Wi-Fi بلا حد للبيانات، لذا قد يستهلك من باقتك.",
    appUpdateDownloadNow: "تنزيل",
    appUpdateNotificationBody: "الإصدار {{version}} من حافظ جاهز للتثبيت. اضغط لفتح حافظ.",
    appUpdateChannelName: "تحديثات التطبيق",
    autoDownloadUpdatesLabel: "تنزيل التحديثات تلقائيًا",
    autoDownloadUpdatesHint:
      "على شبكة Wi-Fi بلا حد للبيانات يُنزَّل الإصدار الجديد أثناء فتح حافظ، ويسألك حافظ قبل تثبيته.",
  },
} as const;
