/**
 * AppError.gs - Custom error for user-visible messages
 */
class AppError extends Error {
  /**
   * @param {string} internalMessage - for logs
   * @param {string} userMessage - for UI alert
   */
  constructor(internalMessage, userMessage) {
    super(internalMessage);
    this.name = 'AppError';
    this.userMessage = userMessage || internalMessage;
  }
}