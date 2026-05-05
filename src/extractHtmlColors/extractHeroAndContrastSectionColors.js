const colorsBySection = await page.evaluate(() => {
  const COLOR_PROPS = [
    "color",
    "backgroundColor",
    "borderColor",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "outlineColor",
    "boxShadow",
    "textShadow",
    "fill",
    "stroke"
  ];

  function isUsableColor(value) {
    if (!value) return false;
    if (value === "none") return false;
    if (value === "transparent") return false;
    if (value === "rgba(0, 0, 0, 0)") return false;
    return true;
  }

  function extractColorTokens(value) {
    if (!value) return [];

    // Captures rgb(), rgba(), hsl(), hsla(), color(), lab(), lch(), oklab(), oklch()
    const matches = value.match(
      /(rgba?\([^)]+\)|hsla?\([^)]+\)|oklch\([^)]+\)|oklab\([^)]+\)|lch\([^)]+\)|lab\([^)]+\)|color\([^)]+\)|#[0-9a-fA-F]{3,8})/g
    );

    return matches || [];
  }

  function getVisibleElements(root) {
    return [...root.querySelectorAll("*")].filter(el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0
      );
    });
  }

  function collectColorsFromSection(section) {
    if (!section) return [];

    const colors = [];
    const elements = [section, ...getVisibleElements(section)];

    for (const el of elements) {
      const style = getComputedStyle(el);

      for (const prop of COLOR_PROPS) {
        const value = style[prop];

        if (!isUsableColor(value)) continue;

        const tokens = extractColorTokens(value);

        for (const token of tokens) {
          if (isUsableColor(token)) {
            colors.push({
              color: token,
              property: prop,
              tag: el.tagName.toLowerCase(),
              className: el.className || "",
              id: el.id || ""
            });
          }
        }
      }
    }

    return colors;
  }

  function findHeroSection() {
    return (
      document.querySelector("section.hero") ||
      document.querySelector(".hero") ||
      document.querySelector("#hero") ||
      document.querySelector("[data-section='hero']") ||
      document.querySelector("header") ||
      document.querySelector("main section")
    );
  }

  function findInvertedContrastSection(heroSection) {
    const candidates = [
      ...document.querySelectorAll(
        [
          "section.inverted",
          ".inverted",
          "section.contrast",
          ".contrast",
          "section.dark",
          ".dark-section",
          ".inverse",
          "[data-section='inverted']",
          "[data-theme='dark']",
          "[data-theme='light']"
        ].join(",")
      )
    ];

    if (candidates.length) {
      return candidates[0];
    }

    // Fallback: find a section whose background contrast differs strongly from hero.
    const heroBg = heroSection
      ? getComputedStyle(heroSection).backgroundColor
      : null;

    const sections = [...document.querySelectorAll("section, main > div, article")];

    return (
      sections.find(section => {
        if (section === heroSection) return false;

        const bg = getComputedStyle(section).backgroundColor;
        return bg && bg !== heroBg && bg !== "rgba(0, 0, 0, 0)";
      }) || null
    );
  }

  const heroSection = findHeroSection();
  const invertedSection = findInvertedContrastSection(heroSection);

  return {
    hero: {
      selector:
        heroSection?.id
          ? `#${heroSection.id}`
          : heroSection?.className
            ? `.${String(heroSection.className).trim().split(/\s+/).join(".")}`
            : heroSection?.tagName?.toLowerCase() || null,
      colors: collectColorsFromSection(heroSection)
    },

    invertedContrast: {
      selector:
        invertedSection?.id
          ? `#${invertedSection.id}`
          : invertedSection?.className
            ? `.${String(invertedSection.className).trim().split(/\s+/).join(".")}`
            : invertedSection?.tagName?.toLowerCase() || null,
      colors: collectColorsFromSection(invertedSection)
    }
  };
});
