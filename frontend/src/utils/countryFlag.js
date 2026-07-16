export function countryCodeToFlag(countryCode) {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';

  return String.fromCodePoint(
    ...code.split('').map(character => 127397 + character.charCodeAt(0))
  );
}
