export class StudyCardDeletedError extends Error {
  constructor() {
    super("This card was deleted and can no longer be updated.");
    this.name = "StudyCardDeletedError";
  }
}
