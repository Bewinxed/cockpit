# Warm Functional — A Design Language

## A hybrid aesthetic merging Notion's calm productivity with nan.fyi's editorial soul.

---

## 🎯 Claude Code Prompt

```
Apply the "Warm Functional" design language to this project.

CORE AESTHETIC:
A digital space that feels like a well-designed book — functional yet warm, 
dense yet breathable, precise yet human. Software that respects its content.

VISUAL SIGNATURE:
- Serif headlines, sans-serif UI (dual-font hierarchy)
- Warm off-white backgrounds (never pure #fff)
- Dotted borders instead of solid lines
- Hand-drawn illustration style (imperfect, characterful)
- Arrow (→) as the universal interaction affordance
- Generous whitespace as a structural element
- Muted, semi-transparent color palette

FEEL:
Not a tool. A space. 
Not productivity software. A personal library.
Not generated. Crafted.

Read the full design language spec before implementing.
```

---

## 📜 Philosophy

### The Name: "Warm Functional"

**Functional** — Every element earns its place. No decoration without purpose. Information-dense when needed, minimal when not. Inspired by Notion's respect for utility.

**Warm** — But never cold. Never sterile. The digital equivalent of a well-worn notebook, a sunlit desk, a library with wooden shelves. Inspired by nan.fyi's editorial humanity.

### The Core Tension

Most software chooses a side:
- **Tool-first:** Dense, efficient, cold (Notion, Linear, GitHub)
- **Brand-first:** Warm, expressive, sparse (Editorial sites, portfolios)

Warm Functional refuses to choose. It asks: *What if functional software felt like something a person made for people?*

### Guiding Principles

#### 1. Content as Hero
The interface should disappear. Chrome recedes. Controls hide until needed. What you're looking at — text, images, data — that's what matters.

#### 2. The Hand of the Maker
Reject the generic. Small imperfections signal humanity. A slightly irregular illustration. A serif with character. These say "someone made this" rather than "software generated this."

#### 3. Warmth Through Restraint
Warm doesn't mean busy. The warmest spaces have room to breathe. Generous margins. Considered negative space. Warmth comes from *care*, not decoration.

#### 4. Quiet Confidence
No drop shadows screaming "I'm clickable!" No gradient buttons demanding attention. Elements know what they are. Hover states reveal, they don't perform.

#### 5. Typography as Architecture
When you limit yourself to two fonts — one serif, one sans — hierarchy must come from weight, size, and spacing. This constraint creates clarity.

#### 6. Interaction as Reward
Motion is earned. A subtle arrow slide on hover. A gentle fade on transition. Never animation for its own sake. Every movement should feel like the interface responding to you, not performing for you.

---

## 🎨 Color

### The Palette Philosophy

**Warm neutrals** as the foundation. Never pure white (#ffffff) — it's too harsh, too digital. Never pure black (#000000) — it's too heavy. The sweet spot is warm grays with a hint of brown.

**Muted accents** for meaning. Tags, states, and highlights use color, but always softened. Semi-transparent backgrounds with more saturated text. Nothing should vibrate or compete for attention.

### Base Colors

```
Background (primary)    #fbfbfa     Warm off-white, like aged paper
Background (secondary)  #f7f6f3     Slightly darker, for panels/sidebars
Background (hover)      rgba(55, 53, 47, 0.04)    Barely there
Background (active)     rgba(55, 53, 47, 0.08)    Subtle acknowledgment
```

### Text Colors

```
Text (primary)          #37352f     Almost black, but warm (brown undertone)
Text (secondary)        #6b6b6b     For supporting content
Text (tertiary)         #9b9b9b     For metadata, timestamps
Text (muted)            #b4b4b4     For placeholders, disabled states
```

### Accent Colors

Used sparingly. Always as semi-transparent backgrounds with saturated text.

```
Red                     
  Background: rgba(235, 87, 87, 0.12)
  Text: #c4554d

Blue                    
  Background: rgba(35, 131, 226, 0.12)
  Text: #0b6bcb

Green                   
  Background: rgba(15, 123, 108, 0.12)
  Text: #0f7b6c

Purple                  
  Background: rgba(103, 36, 222, 0.12)
  Text: #6940a5

Orange                  
  Background: rgba(217, 115, 13, 0.12)
  Text: #d9730d

Gray                    
  Background: rgba(55, 53, 47, 0.08)
  Text: #6b6b6b
```

### Border Colors

```
Dotted borders          #d4d4d4     The signature — use for dividers
Solid borders           rgba(55, 53, 47, 0.09)    When structure is needed
```

### Primary Action

```
Action background       #37352f     Dark, confident
Action text             #ffffff     Clean contrast
Action hover            #2f2d29     Slightly darker
```

*Note: Blue (#2383e2) can be used for primary actions in contexts where dark feels too heavy, but prefer the warm dark.*

---

## 🔤 Typography

### The Dual-Font System

Two fonts. That's it. Constraint breeds clarity.

**Serif** — For headlines, titles, anything meant to be *read*. Brings warmth, editorial quality, and a sense of craft.

**Sans-serif** — For UI, labels, metadata, body text in functional contexts. Brings clarity, neutrality, and efficiency.

### Recommended Pairings

```
Serif options:
  Newsreader        — Classic editorial, great at large sizes
  Fraunces          — More playful, variable weight
  Lora              — Reliable, versatile
  Source Serif Pro  — Clean, professional
  
Sans-serif options:
  Inter             — Industry standard, highly legible
  system-ui         — Native feel, zero load time
  DM Sans           — Geometric, friendly
  IBM Plex Sans     — Technical, precise
```

### Type Scale

```
--text-xs       12px      Labels, captions
--text-sm       14px      UI elements, metadata
--text-base     16px      Body text
--text-lg       18px      Lead paragraphs
--text-xl       22px      Section headers
--text-2xl      28px      Page titles
--text-3xl      36px      Hero text
--text-4xl      48px      Display headlines
```

### Weight Usage

```
400 (Regular)     Body text, descriptions
500 (Medium)      UI labels, buttons, emphasis
600 (Semibold)    Subheadings, important items
700 (Bold)        Headlines, titles
```

### Line Height

```
--leading-tight     1.15    Headlines (large text needs tight leading)
--leading-snug      1.35    Subheadings
--leading-normal    1.6     Body text (generous for readability)
```

### Letter Spacing

```
Headlines (24px+)    -0.02em    Tighten large text
Body text            0          Natural spacing
All-caps labels      0.05em     Open up for legibility
```

### Hierarchy Example

```
Page Title      Serif, 48px, Bold, tight leading
Section Head    Serif, 22px, Semibold
Body            Sans, 16px, Regular, normal leading
UI Label        Sans, 14px, Medium
Caption         Sans, 12px, Regular, secondary color
```

---

## 📏 Spacing

### Philosophy

Generous whitespace is not wasted space — it's *breathing room*. Content needs space to be read, not just seen. When in doubt, add more margin.

### The Scale

```
--space-1       4px       Tight gaps (between related elements)
--space-2       8px       Default small gap
--space-3       12px      Component internal padding
--space-4       16px      Standard gap
--space-6       24px      Section spacing
--space-8       32px      Major section breaks
--space-12      48px      Page section padding
--space-16      64px      Generous content margins
--space-24      96px      Maximum content padding (nan.fyi signature)
```

### Content Margins

The signature of this design language: **generous horizontal padding**.

```
Minimum content padding     48px (--space-12)
Preferred content padding   96px (--space-24)
Maximum content width       720px (for readability)
```

### Component Spacing

```
Between related items       4-8px
Between list items          8-16px
Between sections            24-48px
Between major page areas    48-96px
```

---

## 📦 Borders & Dividers

### The Dotted Border Signature

Solid borders feel rigid, corporate. Dotted borders feel *hand-drawn*, like marks on paper. This is the signature element of Warm Functional.

```css
/* Signature divider */
border-bottom: 1px dotted #d4d4d4;

/* When solid is needed (structural containers) */
border: 1px solid rgba(55, 53, 47, 0.09);
```

### When to Use What

**Dotted:**
- Dividers between list items
- Separating content sections
- Decorative borders on cards
- Anywhere rhythm matters more than containment

**Solid:**
- Container boundaries (sidebars, panels)
- Input fields
- Structural elements that define regions

### Border Radius

```
--radius-sm     3px       Tags, small elements
--radius-md     6px       Buttons, inputs
--radius-lg     8px       Cards, containers
--radius-full   9999px    Pills, avatars
```

Minimal radius. This isn't a bubbly UI. Slight rounding softens without being cute.

---

## ✏️ Illustration Style

### Philosophy

Reject icon libraries. Reject generic symbols. The illustrations in Warm Functional should feel like someone *drew* them — in a notebook, on a whiteboard, in the margins of a book.

### Characteristics

**Line Quality**
- Slightly irregular strokes (not perfectly smooth)
- Visible endpoints where lines meet
- 1.5-2px stroke weight
- Stroke color matches text (#37352f)

**Fill & Shading**
- Mostly unfilled (line drawings)
- Crosshatch patterns for depth when needed
- Dot patterns as texture
- No gradients
- No drop shadows

**Subject Matter**
- Representational but simplified
- Objects, concepts, metaphors
- Small decorative flourishes (stars ✦, sparkles, arrows)
- Never photorealistic

**Personality**
- A little playful
- Slightly imperfect
- Clearly *made by a person*

### Size Guidelines

```
Inline icons          16-20px
List/row icons        40-60px
Feature illustrations 80-120px
Hero illustrations    200-400px
```

### SVG Guidelines

```svg
<svg 
  viewBox="0 0 24 24" 
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <!-- Draw with intentional imperfection -->
</svg>
```

---

## 🎬 Motion & Interaction

### Philosophy

Motion should feel like a *response*, not a performance. The interface acknowledging your presence, not demanding your attention.

### Timing

```
--duration-fast       75ms      Micro-feedback (button press)
--duration-normal     150ms     Standard transitions
--duration-slow       300ms     Page transitions, reveals
```

### Easing

```
--ease-out            cubic-bezier(0, 0, 0.2, 1)     For things entering
--ease-in             cubic-bezier(0.4, 0, 1, 1)     For things leaving
--ease-in-out         cubic-bezier(0.4, 0, 0.2, 1)   For transforms
```

### Hover States

**Backgrounds:** Subtle fill appears
```css
background-color: transparent;
transition: background-color 150ms ease-out;

&:hover {
  background-color: rgba(55, 53, 47, 0.04);
}
```

**The Arrow Slide:** Signature interaction
```css
.arrow {
  transform: translateX(0);
  transition: transform 150ms ease-out;
}

&:hover .arrow {
  transform: translateX(4px);
}
```

**Text Links:** Underline, not color change
```css
a {
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: currentColor;
}
```

### What NOT to Do

- No bounce effects
- No scale transforms on hover (except subtle, <1.02)
- No color shifts on interactive elements
- No loading spinners that spin forever (use progress)
- No tooltips that appear instantly (150ms delay minimum)

---

## 🔲 Component Principles

*These are principles, not specific components. Apply to whatever you're building.*

### Containers

- Prefer open space over boxes
- When containers are needed, use subtle borders or background shifts
- Never nest more than 2 levels of containers

### Lists

- Dotted dividers between items
- Generous vertical padding (12-16px per item)
- Arrow (→) as the "this goes somewhere" indicator
- Hover reveals full-row highlight

### Inputs

- Simple, understated
- 1px solid border, muted color
- No inner shadows
- Focus state: slightly darker border, no glow

### Buttons

- Primary: Dark background (#37352f), white text
- Secondary: Transparent, text only, underline on hover
- Pill shape for prominent actions, rectangular for inline

### Tags/Badges

- Small (18-22px height)
- Minimal radius (3px)
- Semi-transparent background
- Never uppercase

### Cards

- Optional dotted border
- No shadow (or very subtle on hover only)
- Generous internal padding

---

## 🌓 Dark Mode Considerations

*If implementing dark mode, maintain warmth.*

```
Background (primary)    #191919     Warm dark, not pure black
Background (secondary)  #212121     
Text (primary)          #ebebeb     Not pure white
Text (secondary)        #9b9b9b
Text (tertiary)         #6b6b6b

Accent backgrounds      Increase opacity slightly (0.15 → 0.2)
Borders                 rgba(255, 255, 255, 0.1)
```

The goal: a dark mode that feels like *evening*, not *void*.

---

## ✅ Checklist: Is This Warm Functional?

Use this to audit your implementation:

**Color & Tone**
- [ ] Background is warm off-white, not pure #fff
- [ ] Text is warm dark (#37352f), not pure #000
- [ ] Accents use semi-transparent backgrounds
- [ ] Nothing vibrates or competes for attention

**Typography**
- [ ] Headlines use a serif font
- [ ] UI uses a sans-serif font
- [ ] Hierarchy comes from weight/size, not color
- [ ] Large text has tight letter-spacing

**Spacing**
- [ ] Content has generous horizontal padding (48-96px)
- [ ] Elements have room to breathe
- [ ] Whitespace feels intentional, not accidental

**Borders & Dividers**
- [ ] Dotted borders are used for dividers
- [ ] Solid borders are minimal and subtle
- [ ] Border radius is small (3-8px)

**Illustration & Icons**
- [ ] Icons feel hand-drawn or custom
- [ ] No generic icon library aesthetic
- [ ] Stroke weight is consistent (1.5-2px)

**Interaction**
- [ ] Hover states are subtle (background shift only)
- [ ] Arrows slide on hover for navigation
- [ ] Motion timing is 75-150ms
- [ ] Nothing bounces or scales dramatically

**Overall Feel**
- [ ] Feels like a space, not a tool
- [ ] Feels crafted, not generated
- [ ] Feels warm, not cold
- [ ] Content is the hero

---

## 📖 Reference

### Inspiration Sources

**Notion** — Information density, functional layouts, calm UI
**nan.fyi** — Editorial warmth, serif typography, illustration style
**Linear** — Restrained motion, keyboard-first confidence
**Vercel** — Typography hierarchy, generous whitespace
**Stripe Docs** — Clarity through constraint

### Keywords

Warm. Functional. Editorial. Crafted. Calm. Dense-but-breathable. Human. Intentional.

---

*This is not a component library. It's a way of seeing. Apply these principles to whatever you build, and it will feel like it belongs to the same family — the family of things made with care.* ✨