import { resolveMx } from "dns/promises";

/**
 * Validates email domain by checking if it has valid MX records.
 * Returns null if valid, error message if invalid.
 */
export async function validateEmailDomain(email: string): Promise<string | null> {
  const emailRegex = /^[^\s@]+@([^\s@]+)$/
  const match = email.match(emailRegex)

  if (!match) {
    return "Invalid email format."
  }

  const domain = match[1]

  try {
    const mxRecords = await resolveMx(domain)

    // If no MX records found, domain doesn't accept email
    if (!mxRecords || mxRecords.length === 0) {
      return `Domain "${domain}" does not accept emails.`
    }

    return null // Email domain is valid
  } catch {
    // DNS resolution failed - domain doesn't exist or has no MX records
    return `Domain "${domain}" is not a valid email domain.`
  }
}
