const clampMapZoom = (value) =>
  Math.max(2, Math.min(14, Math.round(Number(value) || 6)));
const mapProject = (lon, lat, z) => {
  const n = 2 ** z;
  const world = n * 256;
  const s = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return {
    x: (lon + 180) / 360 * world,
    y: (.5 - Math.log((1 + Math.sin(s)) / (1 - Math.sin(s))) / (4 * Math.PI)) * world,
  };
};
const mapUnproject = (x, y, z) => {
  const world = 256 * 2 ** z;
  const lon = x / world * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / world))) * 180 / Math.PI;
  return { lon, lat };
};

export { clampMapZoom, mapProject, mapUnproject };
