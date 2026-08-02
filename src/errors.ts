/** Raised when the Argorix control plane rejects or fails a request. */
export class ArgorixError extends Error {
  readonly statusCode?: number;
  readonly responseBody?: string;

  constructor(message: string, options: { statusCode?: number; responseBody?: string } = {}) {
    super(message);
    this.name = "ArgorixError";
    this.statusCode = options.statusCode;
    this.responseBody = options.responseBody;
  }
}

/** @deprecated Pre-0.2 name for {@link ArgorixError}. */
export const GovernanceAIError = ArgorixError;
