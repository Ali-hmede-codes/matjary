import { SUPPORT_WHATSAPP_DIGITS } from './contact.ts';

export interface PlanInquiryDetails {
  // The visitor's own details, typed in the dialog or prefilled from the session.
  name: string;
  email: string;
  // Present when the visitor asked about one plan; absent for general help.
  planName?: string | null;
  priceLabel?: string | null;
  billingLabel?: string | null;
  siteName?: string | null;
}

// The visitor sends this message to the platform's global WhatsApp number, so
// the team receives the lead with its name, address and chosen plan already in
// the first message instead of asking again.
export function planInquiryText(details: PlanInquiryDetails): string {
  const site = details.siteName?.trim();
  const plan = details.planName?.trim();
  const price = details.priceLabel?.trim();
  const billing = details.billingLabel?.trim();
  const priceNote = price ? ` (${price}${billing ? ` ${billing}` : ''})` : '';
  const lines = [
    'Hello team,',
    '',
    plan
      ? `I would like to subscribe to the ${plan} plan${priceNote}.`
      : 'I would like help choosing a plan.',
    '',
    `Name: ${details.name.trim()}`,
    `Email: ${details.email.trim()}`,
  ];
  if (site) lines.push('', `— ${site}`);
  return lines.join('\n');
}

export function planInquiryLink(details: PlanInquiryDetails): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_DIGITS}?text=${encodeURIComponent(
    planInquiryText(details),
  )}`;
}
