/** Expected laboratory workflow refusals. These contain no patient details. */
export class LaboratoryDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LaboratoryDomainError';
  }
}
