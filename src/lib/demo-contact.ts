// User-selected contact for the hackathon demo, also saved in Ambiguous.
export const demoContact = { name: "Tan", email: "ts5789@nyu.edu" };

export function defaultContactEmailAnswer(text: string): string | null {
  const question = text
    .trim()
    .replace(/[?.!]+$/, "")
    .replace(/[’]/g, "'");
  if (
    /^(?:(?:hey|okay|ok)[, ]+)?(?:what(?: is|'s|s)? (?:your|tan'?s) e-?mail(?: address)?|(?:can|could) you (?:tell|give) me (?:your|tan'?s) e-?mail(?: address)?)$/i.test(
      question,
    )
  )
    return `${demoContact.name}’s email is ${demoContact.email}.`;
  return null;
}
