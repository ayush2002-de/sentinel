// /api/src/services/agents/RedactorAgent.ts

export class RedactorAgent {
  // Regex to find PAN-like numbers (13 to 19 digits)
  private static panRegex = /\b(\d{13,19})\b/g;
  private static emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  private static redacted = '****REDACTED****';

  /**
   * Redacts a single string value.
   */
  public static redactString(input: string | null | undefined): string {
    if (!input) return input ?? '';
    return input
      .replace(this.panRegex, this.redacted)
      .replace(this.emailRegex, this.redacted);
  }

  /**
   * Recursively traverses an object and redacts all string values.
   * This ensures logs, traces, and UI payloads are safe.
   */
  public static redactObject<T>(obj: T): T {
    if (!obj) return obj;

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item)) as T;
    }

    // Handle objects
    if (typeof obj === 'object' && obj !== null) {
      const newObj: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          if (typeof value === 'string') {
            newObj[key] = this.redactString(value);
          } else if (typeof value === 'object' && value !== null) {
            newObj[key] = this.redactObject(value);
          } else {
            newObj[key] = value;
          }
        }
      }
      return newObj as T;
    }
    
    // Handle strings passed directly
    if (typeof obj === 'string') {
      return this.redactString(obj) as T;
    }

    // Handle other primitives
    return obj;
  }
}