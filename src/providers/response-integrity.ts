import { ProviderError } from "../utils/errors.js";

/** A malformed model response is not a transient transport failure. */
export class ResponseIntegrityError extends ProviderError {
  constructor(message: string, provider: string) {
    super(message, { provider, retryable: false });
    this.name = "ResponseIntegrityError";
  }
}
