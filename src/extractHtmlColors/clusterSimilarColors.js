function distance(a, b) {
  return Math.sqrt(
    Math.pow((a.l || 0) - (b.l || 0), 2) +
    Math.pow((a.c || 0) - (b.c || 0), 2) +
    Math.pow(((a.h || 0) - (b.h || 0)) / 360, 2)
  );
}
