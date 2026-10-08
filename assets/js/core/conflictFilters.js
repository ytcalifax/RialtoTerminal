const CONFLICT_TYPE_OPTIONS = [
  { id: 'ASSAULT', label: 'ASSAULT', defaultOn: true },
  { id: 'FIGHT', label: 'FIGHT', defaultOn: true },
  { id: 'MASS VIOLENCE', label: 'MASS VIOLENCE', defaultOn: true },
  { id: 'ARMED CONFLICT', label: 'ARMED CONFLICT', defaultOn: true },
  { id: 'INTERNET DISRUPTION', label: 'INTERNET DISRUPTION', defaultOn: true },
];

const COOKIE = 'rialto_conflict_types_v2';
const LEGACY_COOKIE = 'rialto_conflict_types_v1';
const DEFAULT_TYPES = CONFLICT_TYPE_OPTIONS.filter((item) => item.defaultOn).map((item) => item.id);

function loadConflictTypes() {
  try {
    const cookies = document.cookie.split('; ');
    const entry = cookies.find((value) => value.startsWith(`${COOKIE}=`));
    const legacy = !entry && cookies.find((value) => value.startsWith(`${LEGACY_COOKIE}=`));
    if (!entry && !legacy) return [...DEFAULT_TYPES];
    const selectedCookie = entry || legacy;
    const cookieName = entry ? COOKIE : LEGACY_COOKIE;
    const saved = JSON.parse(decodeURIComponent(selectedCookie.slice(cookieName.length + 1)));
    if (!Array.isArray(saved)) return [...DEFAULT_TYPES];
    if (!saved.length) return [];
    const allowed = new Set(CONFLICT_TYPE_OPTIONS.map((item) => item.id));
    const selected = [...new Set(saved.filter((value) => allowed.has(value)))];
    if (legacy) {
      for (const type of ['ARMED CONFLICT', 'INTERNET DISRUPTION']) {
        if (!selected.includes(type)) selected.push(type);
      }
    }
    return selected.length ? selected : [...DEFAULT_TYPES];
  } catch {
    return [...DEFAULT_TYPES];
  }
}

function saveConflictTypes(types) {
  try {
    const allowed = new Set(CONFLICT_TYPE_OPTIONS.map((item) => item.id));
    const selected = [...new Set(types.filter((value) => allowed.has(value)))];
    document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(selected))}; max-age=31536000; path=/; SameSite=Lax`;
  } catch {
    /* Ignore cookie write errors in restricted browser contexts. */
  }
}

export { CONFLICT_TYPE_OPTIONS, loadConflictTypes, saveConflictTypes };
