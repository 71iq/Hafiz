/** The card was deleted, for example by a sync pull or another tab, after the screen loaded it. */
export class StudyCardDeletedError extends Error {
  constructor() {
    super("This card was deleted and can no longer be updated.");
    this.name = "StudyCardDeletedError";
  }
}
