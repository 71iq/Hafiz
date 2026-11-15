/**
 * W03 shared overlays, menus, notices, detail sheets and source pickers. Spread into lib/i18n/strings.ts. Keep English and Arabic keys in parity.
 */
export const sharedStrings = {
  en: {
    discardChangesTitle: "Discard changes?",
    discardChangesMessage: "Your unsaved changes will be lost.",
    discardChangesKeepEditing: "Keep editing",
    discardChangesConfirm: "Discard",
  },
  ar: {
    discardChangesTitle: "تجاهل التغييرات؟",
    discardChangesMessage: "ستفقد التغييرات غير المحفوظة.",
    discardChangesKeepEditing: "متابعة التعديل",
    discardChangesConfirm: "تجاهل",
  },
} as const;
