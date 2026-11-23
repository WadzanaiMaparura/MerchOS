/**
 * The MerchOS email layout (approved design): a plain white page, the M logo
 * and "MerchOS" wordmark top-left, black text, one blue button, and a small
 * grey footer. No coloured header/footer bands.
 *
 * Tables + inline styles only, which is what Gmail, Outlook and Apple Mail
 * render reliably. The logo is a hosted PNG because Gmail strips inline SVG.
 *
 * Used by the lifecycle emails (services/engagement) and the Cognito security
 * emails (services/auth/triggers/custom-message.ts).
 */

export const SITE_URL = 'https://merchos.co.za';
export const SUPPORT_EMAIL = 'info@merchos.co.za';
export const LOGO_URL = `${SITE_URL}/email/merchos-m.png`;

const BLUE = '#2563eb';
const BLUE_DARK = '#1e3a8a';
const TEXT = '#222222';
const FAINT = '#777777';
const FONT = 'Arial, Helvetica, sans-serif';

/** Escapes text for HTML (names and other user-supplied values). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Building blocks (arguments are trusted HTML unless noted) ──────────────

export const heading = (html: string): string =>
  `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:bold;color:${TEXT}">${html}</h1>`;

export const para = (html: string): string =>
  `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${TEXT}">${html}</p>`;

export const small = (html: string): string =>
  `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${FAINT}">${html}</p>`;

export const link = (href: string, label: string): string =>
  `<a href="${escapeHtml(href)}" style="color:${BLUE}">${label}</a>`;

export const bullets = (items: string[]): string =>
  `<ul style="margin:0 0 16px;padding-left:24px">${items
    .map((i) => `<li style="margin:0 0 8px;font-size:16px;line-height:1.6;color:${TEXT}">${i}</li>`)
    .join('')}</ul>`;

/** Numbered list with a bold lead-in per item ("1. Add your products. Upload…"). */
export const numbered = (items: Array<[title: string, text: string]>): string =>
  `<ol style="margin:0 0 16px;padding-left:24px">${items
    .map(
      ([title, text]) =>
        `<li style="margin:0 0 8px;font-size:16px;line-height:1.6;color:${TEXT}"><b>${title}</b> ${text}</li>`,
    )
    .join('')}</ol>`;

/** Plain black "1." numbering with a title line and a short explanation. */
export const steps = (items: Array<[title: string, text: string]>): string =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 6px">${items
    .map(
      ([title, text], i) =>
        `<tr><td style="vertical-align:top;padding:0 10px 16px 0;color:${TEXT};font-weight:bold;font-size:16px;width:20px">${i + 1}.</td><td style="padding-bottom:16px"><p style="margin:0;color:${TEXT};font-weight:bold;font-size:16px">${title}</p><p style="margin:2px 0 0;color:${TEXT};font-size:16px;line-height:1.6">${text}</p></td></tr>`,
    )
    .join('')}</table>`;

/** Three small bordered cards in a row (training options). */
export const cards = (items: Array<[title: string, text: string]>): string =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px"><tr>${items
    .map(
      ([title, text]) =>
        `<td style="vertical-align:top;width:${Math.floor(100 / items.length)}%;padding:4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="border:1px solid #e5e5e5;padding:14px"><p style="margin:0 0 6px;color:${TEXT};font-weight:bold;font-size:15px">${title}</p><p style="margin:0;color:${TEXT};font-size:14px;line-height:1.5">${text}</p></td></tr></table></td>`,
    )
    .join('')}</tr></table>`;

/** The one call to action: a full-width blue button. */
export const button = (label: string, href: string): string =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 22px"><tr><td align="center" style="background:${BLUE};padding:16px 18px"><a href="${escapeHtml(href)}" style="color:#ffffff;font-size:17px;font-weight:bold;text-decoration:none;display:block">${label}</a></td></tr></table>`;

/** Large spaced code (Cognito substitutes {####}). */
export const code = (value: string): string =>
  `<p style="margin:4px 0 18px;font-size:38px;font-weight:bold;letter-spacing:9px;color:${TEXT};font-family:${FONT}">${value}</p>`;

/** Five tappable star boxes, each a link (1 to 5). */
export const starRow = (hrefFor: (rating: number) => string): string =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px"><tr>${[1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<td style="padding:0 6px 0 0;text-align:center"><a href="${escapeHtml(hrefFor(n))}" aria-label="${n} star${n > 1 ? 's' : ''}" style="display:block;width:52px;height:52px;border:1px solid #e5e5e5;text-align:center;line-height:52px;font-size:28px;color:#f59e0b;text-decoration:none">&#9733;</a><p style="margin:4px 0 0;font-size:13px;color:${FAINT}">${n}</p></td>`,
    )
    .join('')}</tr></table>`;

/** Dashed box showing a value to copy (the referral link). */
export const copyBox = (label: string, value: string): string =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 10px"><tr><td style="border:1px dashed #93c5fd;background:#eff6ff;padding:14px 18px"><p style="margin:0 0 4px;color:${FAINT};font-size:14px">${label}</p><p style="margin:0;color:${TEXT};font-weight:bold;font-size:18px">${value}</p></td></tr></table>`;

// ─── Page ───────────────────────────────────────────────────────────────────

export interface PlainEmailOptions {
  /** Shown as the inbox preview line; hidden in the body. Plain text. */
  preheader?: string;
  /** Inner HTML between the logo and the signature. */
  body: string;
  /** Marketing emails carry an unsubscribe link (POPIA); transactional ones don't. */
  unsubscribeUrl?: string;
  /** Security emails (codes) leave out the "Kind regards" signature. */
  signature?: boolean;
}

export function plainEmail({ preheader = '', body, unsubscribeUrl, signature = true }: PlainEmailOptions): string {
  const footerReason = unsubscribeUrl
    ? `You are receiving this because you are a MerchOS customer. ${link(unsubscribeUrl, 'Unsubscribe')}`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>MerchOS</title>
</head>
<body style="margin:0;padding:0;background:#eeeeee;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eeeeee"><tr><td align="center" style="padding:24px 8px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff"><tr><td style="padding:32px 36px 16px;text-align:left;font-family:${FONT}">
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px"><tr><td style="vertical-align:middle;padding-right:10px"><img src="${LOGO_URL}" width="44" height="44" alt="" style="display:block;border:0"></td><td style="vertical-align:middle;font-size:30px;font-weight:bold;color:${BLUE_DARK};letter-spacing:-0.5px">MerchOS</td></tr></table>
${body}
${signature ? para('Kind regards,<br>The MerchOS team') : ''}
<hr style="border:0;border-top:1px solid #e5e5e5;margin:26px 0 14px">
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${FAINT}">Questions? Chat with us on ${link(SITE_URL, 'merchos.co.za')} (Monday to Friday, 9am to 4pm) or email ${link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}.</p>
${footerReason ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${FAINT}">${footerReason}</p>` : ''}
<p style="margin:0 0 20px;font-size:14px;color:${FAINT}">MerchOS, South Africa</p>
</td></tr></table>
</td></tr></table>
</body>
</html>`;
}

/** Plain-text alternative: strips tags from the HTML body (keeps links readable). */
export function htmlToText(html: string): string {
  return html
    .replace(/<head>.*?<\/head>/s, '')
    .replace(/<div style="display:none[^>]*>.*?<\/div>/s, '')
    .replace(/<img [^>]*>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return href.startsWith('mailto:') || text === href ? text : `${text} (${href.replace(/&amp;/g, '&')})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|tr|h\d|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<hr[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#9733;/g, '*')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
