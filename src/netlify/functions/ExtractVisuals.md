You are a web template designer and engineer.


──────────────────────────────────────────────
COLOR MAPPING
──────────────────────────────────────────────

Distill the example website's colors into at most five named `--color-*` CSS custom properties (use fewer if the palette genuinely has fewer distinct roles). Keep the original hex values exactly — do NOT substitute Mustache placeholder tokens. Then rewrite every hardcoded color value anywhere in the file (`:root`, other CSS rules, and HTML inline `style=""` attributes) to reference these variables using `var()` or `color-mix()`. The rendered page must look identical to the source.

The five core colors must be the five most visually important and mutually distinct colors in the design, ordered by prominence. Slot 1 should be the most dominant color in the masthead. Slot 2 should be the next most dominant masthead color and must not be merely a tint/shade/gradient-stop variant of slot 1. Slot 3 should be the next distinct color. Slots 4 and 5 are progressively less prominent but still must be meaningfully distinct from the earlier slots. Do NOT waste slots on duplicate blacks, duplicate grays, or barely-different neutrals when the source has salient accent hues that drive headings, CTA buttons, hero art, cards, or section dividers.

Structure the `:root` block in three groups:

  1. Five main theme colors — one declaration per row, original hex value, plus a role comment in the format:
       /* N. RoleName — brief phrase */
     where N is 1–5 and RoleName is a short label such as Dominant, Secondary, Tertiary, Quaternary, Quinary, or another brief descriptor that matches the slot's prominence. Make sure the five core color assignments are organized to provide sufficient contrast for all the text in various sections of the webpage to be easily viewed by humans.
     Constraints:
     - Never include the same hex twice in the five main colors.
     - Avoid near-duplicate neutrals; at most two of the five core colors should be neutral unless the source is genuinely monochrome.
     - If the source clearly uses multiple chromatic accents (for example blue, coral, and mint/green), keep those accents in the core five instead of replacing one with an extra gray.
     - Do not promote pure utility colors such as warning red, success green, or hardcoded black/white into the core five unless they are truly part of the website's main visual identity or domain.

  2. Theme-independent hard-coded neutrals — pure white, pure black, and any truly fixed utility colors (e.g. --white, --black, --success, --warning) that are not part of the palette and must never change with a theme swap.

  3. Derived tokens — all other colors expressed as `color-mix()` or `var()` computed from the five main colors and the neutrals. No bare hex values allowed here. Name these tokens by their semantic role in the UI (e.g. --card-surface, --tint-accent, --light-text).

============================================================================
Example:
<style>
    :root {
      /* Five main theme colors */
      --dominant:   #150b2d;   /* 1. Dominant    — deepest, most prominent masthead color */
      --secondary:  #072e3d;   /* 2. Secondary   — second prominent masthead/panel color  */
      --tertiary:   #2563eb;   /* 3. Tertiary    — third distinct CTA/highlight color      */
      --quaternary: #94a3b8;   /* 4. Quaternary  — lower-prominence supporting color       */
      --quinary:    #e5e7eb;   /* 5. Quinary     — least-prominent supporting contrast     */

      /* Theme-independent hard-coded neutrals */
      --white:   #ffffff;
      --black:   #000000;
      --success: #22c55e;
      --warning: #a3e635;

      /* Derived tokens */
      --bg-top:    color-mix(in srgb, var(--color-bg) 82%, var(--color-surface));
      --bg-bottom: color-mix(in srgb, var(--color-surface) 88%, var(--black));
      --card-top:  color-mix(in srgb, var(--color-surface) 92%, var(--color-bg));
      --card-btm:  color-mix(in srgb, var(--color-surface) 78%, var(--black));
      --tint-accent:  color-mix(in srgb, var(--color-accent) 35%, transparent);
      --light-text:   color-mix(in srgb, var(--color-muted) 60%, var(--white));
      ...
    }
</style>
=============================================================================

Establish the five core colors in order of prominence and distinctness. The numbered comment is the source of truth. Role labels may describe the slot's visual identity, but the slot number determines how the palette picker interprets the color.

Sanity check before finalizing the template:
- Ask whether each of the five core colors is doing genuinely different work in the composition.
- If two chosen core colors are both black/dark charcoal, or both light gray/off-white, replace one with a more distinctive accent from the source.
- If a visually important heading/CTA/accent color is missing from the five core colors, the palette is wrong and must be revised.

Potential Values for Color Theme Role Mapping
 1. Eg. Dominant, Hero, Brand, Background, Foreground
 2. Eg. Secondary, Panel, Signature, Headline, Surface
 3. Eg. Tertiary, Pop, Vibrant, CTA, Highlight
 4. Eg. Quaternary, Accent, Border, Label, Support
 5. Eg. Quinary, Divider, Text, Accent2, Contrast

  COLOR_ROLE_NAMING_CONVENTIONS TABLE
    Role-based (functional):
      Interactive / Action — anything clickable
      Destructive / Danger / Error — reds for delete/fail states
      Warning / Caution — yellows/oranges
      Success / Positive — greens for confirmation
      Info / Informational — blues for neutral notices
      Disabled / Subtle — de-emphasized UI elements

    Structural:
      Canvas — the base page background (broader than "background")
      Inverse — colors used on dark vs. light backgrounds
      Panel / Elevated / Overlay — layered surfaces at different depths
      Border / Outline / Divider / Separator
      Shadow / Scrim — depth and overlay tints
      Highlight / Selection — user-selected content

    Brand/Identity:
      Hero — the dominant brand color
      Signature — a distinctive ownable color
      Neutral — grays that anchor the palette
      Pop / Vibrant — a high-energy contrast color

    Material Design / token-style:
      On-[surface] — text/icons on top of a given surface (e.g. on-primary, on-surface)
      Container — a softer tinted fill version of a role color
      Tonal — a muted, same-hue variant

    Traditional print/brand:
      Spot color — a specific Pantone ink
      Corporate color — the official brand standard
      Complementary / Analogous / Triadic — relationship-based names

    
──────────────────────────────────────────────
INPUT
──────────────────────────────────────────────

example_html:
{{EXAMPLE_HTML}}
