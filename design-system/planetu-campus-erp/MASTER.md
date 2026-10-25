# PlanetU Campus ERP: design system ("Campus Navy & Brass")

The one source of truth for how every screen looks and reads. Chosen on Day 1 with the
ui-ux-pro-max skill. Tokens live in `client/src/styles/global.css` (`:root`). Never put raw hex in a component.

## Style
Minimal / Swiss: flat white cards on a light slate page, thin borders, soft shadows, clear heading order,
150–200 ms hovers, Lucide SVG icons (never emoji). Motion is subtle and respects reduced-motion.

## Colour: one meaning each
| Token | Value | Use |
|---|---|---|
| `--brand` | `#1E3A5F` navy | main buttons, selected menu item, done steps. An institute's own colour replaces it. |
| `--accent` | `#B45309` brass | **the next step only**: the "Next:" line and the step bar's Next button (`.btn--next`) |
| `--link`, `--focus` | `#2563EB` | links and the keyboard focus ring |
| `--bg` / `--surface` | `#F8FAFC` / `#FFFFFF` | page / cards |
| `--text` / `--muted` | `#0F172A` / `#475569` | body text / secondary text |
| `--border` / `--border-strong` | `#E2E8F0` / `#CBD5E1` | cards and tables / inputs |
| `--success` `--warning` `--danger` `--info` | green / amber / red / blue | status, always with a word too |

PlanetU purple (`--planetu`) only on the login page and the vendor screens.
Contrast: white on navy 11:1, white on brass 5:1, muted on white 7:1.

## Type
- Headings and numbers: **Lexend** 500–700 (`--font-head`)
- Body: **Source Sans 3** 400–700 (`--font`), 15 px, line height 1.5
- Inputs are 16 px on phones (no iPhone zoom).

## Shared pieces (use these, do not hand-build)
| Need | Component |
|---|---|
| Page title, "what next", buttons | `PageHeader` (`components/ui/Ui.jsx`). `PageBanner` is the old name. |
| Where a process stands | `StepBar` (`components/ui/StepBar.jsx`) with a process from `config/processes.js` |
| A list of records | `DataTable` (`components/ui/DataTable.jsx`) |
| A form field | `FormField`, with `FormError` at the top and `FormActions` at the foot |
| Nothing to show | `EmptyState` (`compact` inside cards); always a hint, and an action when possible |
| Failed load | `ErrorState` / `DataBoundary`: adds "how to fix" from the HTTP status |

## Screen rules
1. **One primary button per screen.** In `PageHeader` it is `primary`. When the page has a step bar with `next`,
   that brass button is the primary and `primary` is not shown.
2. **Every screen answers "what next?"**: a `next` line in the header, a step bar, or an empty state with an action.
3. **No empty boxes.** An empty list says what fills it and offers the step.
4. **Every error says how to fix it.** Field errors sit under the field; save errors use `FormError`.
5. **Same words everywhere.** Step names come only from `config/processes.js`; the institute's own terms come from `t()`.
6. **Forms:** label above the field, hint under it, Cancel on the left and the primary on the right (stacked on phones, primary on top).
7. **Tables:** figures right-aligned (`num`), the buttons column last, cards on phones, scroll after four rows.
8. **Touch:** at least 44 px targets on phones; focus ring always visible.
