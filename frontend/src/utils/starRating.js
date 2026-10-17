// osu! star difficulty spectrum from osu.Game.Rulesets.Osu.Difficulty.OsuColour
// https://github.com/ppy/osu/blob/master/osu.Game/Graphics/OsuColour.cs
const STAR_DIFFICULTY_SPECTRUM = [
  { stars: 0.1, color: '#aaaaaa' },
  { stars: 0.1, color: '#4290fb' },
  { stars: 1.25, color: '#4fc0ff' },
  { stars: 2.0, color: '#4fffd5' },
  { stars: 2.5, color: '#7cff4f' },
  { stars: 3.3, color: '#f6f05c' },
  { stars: 4.2, color: '#ff8068' },
  { stars: 4.9, color: '#ff4e6f' },
  { stars: 5.8, color: '#c645b8' },
  { stars: 6.7, color: '#6563de' },
  { stars: 7.7, color: '#18158e' },
  { stars: 9.0, color: '#000000' },
];

// Text colour logic from StarRatingDisplay.cs: dark text below 6.5★,
// yellow up to 9★, then a gradient for the hardest maps.
const STAR_TEXT_SPECTRUM = [
  { stars: 9.0, color: '#f6f05c' },
  { stars: 9.9, color: '#ff8068' },
  { stars: 10.6, color: '#ff4e6f' },
  { stars: 11.5, color: '#c645b8' },
  { stars: 12.4, color: '#6563de' },
];

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
}

function interpolate(spectrum, stars) {
  if (stars <= spectrum[0].stars) return spectrum[0].color;
  for (let index = 0; index < spectrum.length - 1; index++) {
    const current = spectrum[index];
    const next = spectrum[index + 1];
    if (stars >= current.stars && stars <= next.stars) {
      const span = next.stars - current.stars;
      const ratio = span === 0 ? 1 : (stars - current.stars) / span;
      const [r1, g1, b1] = hexToRgb(current.color);
      const [r2, g2, b2] = hexToRgb(next.color);
      const mix = (a, b) => Math.round(a + (b - a) * ratio).toString(16).padStart(2, '0');
      return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`;
    }
  }
  return spectrum.at(-1).color;
}

export function starRatingColor(stars) {
  const value = Number(stars) || 0;
  if (value <= 0) return '#aaaaaa';
  return interpolate(STAR_DIFFICULTY_SPECTRUM, value);
}

export function starRatingTextColor(stars) {
  const value = Number(stars) || 0;
  if (value < 6.5) return 'rgba(0, 0, 0, 0.78)';
  if (value < 9) return '#f6f05c';
  return interpolate(STAR_TEXT_SPECTRUM, value);
}

export function starRatingStyle(stars, { muted = false } = {}) {
  const [r, g, b] = hexToRgb(starRatingColor(stars));
  return muted
    ? { background: `rgba(${r}, ${g}, ${b}, 0.16)`, color: `rgb(${r}, ${g}, ${b})`, borderColor: `rgba(${r}, ${g}, ${b}, 0.55)` }
    : { background: `rgb(${r}, ${g}, ${b})`, color: starRatingTextColor(stars), borderColor: `rgb(${r}, ${g}, ${b})` };
}
