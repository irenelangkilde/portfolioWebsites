const culori = require("culori");

const toOklch = culori.converter("oklch");

const converted = colors
  .map(c => {
    try {
      return toOklch(c);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
